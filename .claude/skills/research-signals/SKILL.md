---
name: research-signals
description: Research a topic across Instagram, YouTube Shorts, YouTube long-form and TikTok, then save the findings into the Command Centre's research store. Use for /research-signals, "research <topic>", "what is working on <topic>", or when asked to refresh research for a topic. Signal Room first; last30free for TikTok and as the YouTube fallback.
---

# Research signals

Claude runs the research, because only Claude Code holds the Signal Room login. The result is one batch file,
checked and merged by `dashboard/research-import.mjs`. Store rules and batch format: `dashboard/README.md`,
"Research store".

## Scope

| Platform | Source | Notes |
| --- | --- | --- |
| Instagram | Signal Room only | Never last30free: its Instagram path is paid (Apify) and stays off. |
| YouTube Shorts, long-form | Signal Room, then last30free when the fallback rule says so | |
| TikTok | last30free only | Hashtag search. No transcripts. |

X, Hacker News and Reddit are outside this workflow. Never pass `--source x`, `hn`, `reddit` or `instagram` to
last30free here. The importer rejects them anyway.

Paid calls: none. If a step would cost money, stop and ask.

## Steps

Work in the session scratchpad. `<L30>` is the last30free folder (`LAST30FREE_DIR`, default
`D:/Mits AI OS/Research-Assitant - Copy/last30free`). Run its commands from that folder with
`.venv/Scripts/python.exe` and `PYTHONIOENCODING=utf-8`.

1. **Signal Room search.** Call `research_content_topic` with the topic, `limit` 5 to 8, and the lanes wanted
   (default all three). If a lane or the whole call fails, keep the exact error text; do not retry more than once.
2. **Detail for the top results.** For the top 3 Instagram results by balanced score, call
   `get_instagram_content` (this is the only place a measurement time comes from) and
   `get_instagram_transcript`. For the top 2 or 3 YouTube results per lane, call `get_transcript`; call
   `get_video` when the description is wanted. Results without a fetched transcript are still saved, without one.
3. **Write the draft** (format below). Copy Signal Room objects exactly as returned; do not convert times or
   rename fields. `build-batch.mjs` does that. Copy each match's `hook` and `relevantSnippet` in full: they are
   stored as the search excerpt and shown as evidence. If you shorten them, keep the words exact and set
   `"excerptsShortened": true` in `signalRoom`, so the page says only part was copied.
4. **Fallback check.** `node .claude/skills/research-signals/build-batch.mjs <draft.json> --check-fallback`.
   The rule: run last30free YouTube when Signal Room returned fewer than five relevant YouTube matches, or its
   measurements are stale or undated. Signal Room gives no measurement time for YouTube, and a recent
   publication date is not one, so today this means: whenever a YouTube lane was searched.
5. **last30free.** Save each output to its own file:
   - TikTok: `python -m last30free "<topic>" --source tiktok --quick --days 30 --json > tt.json`
     A browser window may open briefly. The topic is collapsed into one hashtag ("claude code skills" becomes
     `#claudecodeskills`), so prefer a single word or an existing tag.
   - YouTube, when step 4 says so: `python -m last30free "<topic>" --source youtube --quick --days 30 --json > yt.json`
   - Subtitles for the YouTube results worth reading (at most 3):
     `python <repo>/.claude/skills/research-signals/yt-subtitles.py subs.json <id> <id>`
   If a command fails, put its error in the draft instead of a file. Do not drop the lane.
6. **Stamp the time.** `date -u +%Y-%m-%dT%H:%M:%SZ` after the last fetch; that is the draft's `retrievedAt`.
7. **Build, dry-run, import.**
   ```
   node .claude/skills/research-signals/build-batch.mjs <draft.json>
   node dashboard/research-import.mjs reels-data/research/inbox/<batchId>.json --dry-run
   node dashboard/research-import.mjs reels-data/research/inbox/<batchId>.json
   ```
   Import only after the dry run is clean. A rejected batch changes nothing; fix the draft and rebuild.
   The builder copies the draft and the last30free files to `reels-data/research/sources/<batchId>/`; the
   Research page reads them back so copied numbers can be checked. Do not edit them afterwards.
8. **Report.** Per lane: how many posts, how many match the query in the retrieved text, which have real
   transcripts, which measurements are dated, and every failure with its exact error.

## Draft format

```json
{
  "batchId": "2026-11-17-n8n",
  "query": "n8n",
  "windowDays": 30,
  "retrievedAt": "2026-11-17T09:12:00Z",
  "signalRoom": {
    "lanes": ["instagram_short_form", "youtube_short_form", "youtube_long_form"],
    "matches": [ "…each object from the response's matches array, unchanged…" ],
    "instagramDetails": [ "…each get_instagram_content response, unchanged…" ],
    "videoDetails": [ "…each get_video response, unchanged…" ],
    "transcripts": [ { "platform": "instagram", "id": "3968528610867647341", "text": "…full transcript text…" } ],
    "errors": [ { "lane": "youtube_long_form", "error": "exact error text" } ]
  },
  "last30free": {
    "tiktok": { "file": "C:/…/tt.json" },
    "youtube": { "error": "exact error text" },
    "subtitles": { "file": "C:/…/subs.json" }
  }
}
```

One batch id per search: date plus a short topic slug, with a suffix (`-b`) for a second run the same day.
From a match, the builder needs: `source`, `externalId`, `url`, `title`, `creator` or `channel`, `publishedAt`,
`durationSeconds`, `metrics`, `performanceMetric`, `performanceValue`, `balancedScore`, `hook`,
`relevantSnippet`. Other fields may be left out.

## What the builder decides

- **Times.** Signal Room times are Unix milliseconds; the builder converts them and refuses anything else.
  An Instagram measurement time is the newest `observations[].observedAt` from the item detail. With no detail
  it is unknown. YouTube from Signal Room is always unknown: `lastSeenAt` on a video is when the tracker last
  saw the upload, not a stated measurement time. last30free counts are live, so their measurement time is the
  output file's time.
- **Evidence.** Signal Room's creator-relative signal (`reach_per_follower`, `age_adjusted_channel_outlier`,
  `bounded_velocity_signal`) goes in `outlier`. last30free's score goes in `discoveryScore`. Percentiles are
  left out: they describe one search's cohort, not the post.
- **Unknowns.** last30free writes 0 for a missing count, so 0 views, likes and followers are stored as unknown.
- **Format.** last30free YouTube is `short` only with a `/shorts/` link, `long` when over three minutes,
  otherwise `unknown`.
- **Transcripts.** Only fetched spoken text: Signal Room transcripts or YouTube subtitles. A hook, excerpt,
  caption or description is never stored as a transcript. Hooks and snippets are stored as excerpts instead.

## Say this honestly

- Results are the **top matches from this search**, not everything that exists. Signal Room searches a sample
  of its transcripts per lane and covers only its tracked creators.
- Signal Room's own matching is loose ("MCP" has matched "MCP50"). Each run's note gives the count that match
  the query as whole words in the retrieved text; quote that count, not Signal Room's `exactPhrase`.
- TikTok is hashtag discovery: off-topic posts that carry the tag appear, and there is no spoken text.
- Public metrics show association, never that a hook or format caused a result.
