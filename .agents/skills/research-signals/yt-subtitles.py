"""Fetch YouTube subtitles (spoken words) for a few video ids, using last30free's own subtitle reader.

A plain last30free search does not return transcripts: without --enrich it keeps only short quotes for its
top five results, and --enrich itself adds none for YouTube. This is the working route. No audio is downloaded
and Whisper is not used. A video with no subtitles, or one YouTube rate-limits, is reported as failed.

Run with last30free's Python, from the last30free folder:
  .venv/Scripts/python.exe <this file> <out.json> <videoId> [<videoId> ...]
"""
import json
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from last30free.video_fetch import _try_subtitles

out, ids = sys.argv[1], sys.argv[2:]
transcripts, failed = {}, {}
with tempfile.TemporaryDirectory() as tmp:
    for vid in ids:
        text = _try_subtitles(f"https://www.youtube.com/watch?v={vid}", vid, Path(tmp), None)
        if text.strip():
            transcripts[vid] = text.strip()
        else:
            failed[vid] = "no subtitles returned (none exist, or YouTube refused the request)"
fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
Path(out).write_text(json.dumps({"fetchedAt": fetched_at, "transcripts": transcripts, "failed": failed}, indent=2), encoding="utf-8")
print(f"subtitles: {len(transcripts)} fetched, {len(failed)} failed -> {out}")
for vid, why in failed.items():
    print(f"  {vid}: {why}")
