"""Fetch YouTube subtitles (spoken words) for a few video ids, with last30free's yt-dlp and its own VTT reader.

A plain last30free search does not return transcripts: without --enrich it keeps only short quotes for its
top five results, and --enrich itself adds none for YouTube. This is the working route. No audio is downloaded
and Whisper is not used.

One subtitle request per video: the video's own English track if it has one, otherwise YouTube's automatic
English captions. YouTube's JavaScript challenge is solved with Node (needs the yt-dlp-ejs package in the same
Python). When YouTube answers 429 (too many requests), the id is listed under "rateLimited" so the caller can back
off; any other miss is listed under "failed".

Run with last30free's Python, from the last30free folder:
  .venv/Scripts/python.exe -I <this file> <out.json> <videoId> [<videoId> ...]
Output: {"fetchedAt", "transcripts": {id: text}, "failed": {id: reason}, "rateLimited": {id: reason}}
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError

import yt_dlp
from last30free.video_fetch import _parse_vtt

MANUAL = ["en", "en-GB", "en-US"]
AUTO = ["en", "en-orig"]


def pick(tracks, langs):
    """The VTT url of the first language in langs that the video has."""
    for lang in langs:
        for t in tracks.get(lang) or []:
            if t.get("ext") == "vtt" and t.get("url"):
                return t["url"]
    return None


def is_429(e):
    return (isinstance(e, HTTPError) and e.code == 429) or "429" in str(e) or "Too Many Requests" in str(e)


def fetch(ydl, vid):
    info = ydl.extract_info(f"https://www.youtube.com/watch?v={vid}", download=False)
    url = pick(info.get("subtitles") or {}, MANUAL) or pick(info.get("automatic_captions") or {}, AUTO)
    if not url:
        return None, "the video has no English subtitles or automatic captions"
    with ydl.urlopen(url) as r:
        text = _parse_vtt(r.read().decode("utf-8", errors="ignore"))
    return (text, None) if text.strip() else (None, "the subtitle track was empty")


out, ids = sys.argv[1], sys.argv[2:]
transcripts, failed, limited = {}, {}, {}
opts = {"skip_download": True, "quiet": True, "no_warnings": True, "js_runtimes": {"node": {}, "deno": {}}}
with yt_dlp.YoutubeDL(opts) as ydl:
    for vid in ids:
        try:
            text, why = fetch(ydl, vid)
            if text:
                transcripts[vid] = text.strip()
            else:
                failed[vid] = why
        except Exception as e:  # one video's problem never stops the others
            if is_429(e):
                limited[vid] = "YouTube answered 429 (too many requests)"
            else:
                failed[vid] = str(e).replace("\n", " ")[:300]
fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
Path(out).write_text(json.dumps({"fetchedAt": fetched_at, "transcripts": transcripts, "failed": failed, "rateLimited": limited}, indent=2), encoding="utf-8")
print(f"subtitles: {len(transcripts)} fetched, {len(failed)} failed, {len(limited)} rate-limited -> {out}")
for vid, why in {**failed, **limited}.items():
    print(f"  {vid}: {why}")
