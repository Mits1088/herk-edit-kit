---
name: research-signals
description: Research a topic across Instagram, YouTube Shorts, YouTube long-form and TikTok, then save the findings into the Command Centre's research store. Use for /research-signals, "research <topic>", "what is working on <topic>", or when asked to refresh research for a topic. Signal Room first; last30free (Apify) for TikTok and Instagram search, YouTube Shorts feed, and the YouTube fallback.
---

# Research signals

Claude runs the research, because only Claude Code holds the Signal Room login. The result is one batch file,
checked and merged by `dashboard/research-import.mjs`. Store rules and batch format: `dashboard/README.md`,
"Research store".

## Scope

| Platform | Source | Notes |
| --- | --- | --- |
| Instagram | Signal Room (tracked creators) and last30free Apify search (`instagram_search`) | Paid. No transcripts from last30free. |
| YouTube Shorts | Signal Room, and last30free's hashtag Shorts feed (`--youtube-shorts`, free) | |
| YouTube long-form | Signal Room, then last30free when the fallback rule says so | |
| TikTok | last30free only, via Apify | Paid. Hashtag-style search. No transcripts. |

X, Hacker News and Reddit are outside this workflow. Never pass `--source x`, `hn` or `reddit` to last30free here.
The importer rejects them anyway.

**Paid calls.** TikTok and Instagram through last30free use Apify. Each run is capped at 50 results and $0.50
(`APIFY_MAX_CHARGE_USD` in last30free's `.env`); a normal run costs about $0.10 to $0.20. One run per platform per
search: do not repeat a paid command for the same topic in one session. Each run's actual charge is recorded in the
batch automatically. Anything else that would cost money: stop and ask.

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
   - TikTok (paid): `python -m last30free "<topic>" --source tiktok --days 30 --json > tt.json`
   - Instagram (paid): `python -m last30free "<topic>" --source instagram --days 30 --json > ig.json`
     The topic is collapsed into one hashtag ("claude code skills" becomes `#claudecodeskills`), so prefer a single
     word or an existing tag.
   - YouTube Shorts (free): `python -m last30free "<topic>" --source youtube --youtube-shorts --days 30 --json > ys.json`
   - YouTube, when step 4 says so: `python -m last30free "<topic>" --source youtube --quick --days 30 --json > yt.json`
   last30free keeps every post a source returned, not only the ones inside 30 days; the builder imports them all
   (`fetchedOnly`) so nothing paid for is lost. The Research page filters by date.
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
8. **Report.** Per lane: how many posts were reported and how many more were fetched and kept (older, undated, past
   the limit), how many match the query in the retrieved text, which have real transcripts, which measurements are
   dated, each paid run's actual charge (`cost.charged_usd`, or why it is unknown), and every failure with its
   exact error.

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
    "instagram": { "file": "C:/…/ig.json" },
    "youtubeShorts": { "file": "C:/…/ys.json" },
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
  saw the upload, not a stated measurement time. last30free stamps each post with its own collection time
  (`collected_at`, rounded down to the second; `measuredBasis: "collection"`). Output from before that change has
  none, so the file's modification time stands in (`measuredBasis: "file-mtime"`), shown but never used for growth.
- **Evidence.** Signal Room's creator-relative signal (`reach_per_follower`, `age_adjusted_channel_outlier`,
  `bounded_velocity_signal`) goes in `outlier`. last30free's score goes in `discoveryScore`. Percentiles are
  left out: they describe one search's cohort, not the post.
- **Unknowns.** last30free now writes `null` for a missing count and a real 0 stays 0. Older output wrote 0 for
  missing, so there a 0 view, like or follower count is stored as unknown.
- **Kept, not reported.** Posts last30free fetched but did not report go in the run's `fetchedOnly`, so they are
  stored too. Each run also carries last30free's `counts` (fetched, in window, outside, undated, duplicate) and,
  for Apify, `cost` (run id, status, actual charge).
- **Format.** last30free YouTube is `short` only with a `/shorts/` link, `long` when over three minutes,
  otherwise `unknown`. A last30free Instagram post is `short` when it is a video (a reel), otherwise `unknown`.
- **Transcripts.** Only fetched spoken text: Signal Room transcripts or YouTube subtitles. A hook, excerpt,
  caption or description is never stored as a transcript. Hooks and snippets are stored as excerpts instead.

## Say this honestly

- Results are the **top matches from this search**, not everything that exists. Signal Room searches a sample
  of its transcripts per lane and covers only its tracked creators.
- Signal Room's own matching is loose ("MCP" has matched "MCP50"). Each run's note gives the count that match
  the query as whole words in the retrieved text; quote that count, not Signal Room's `exactPhrase`.
- TikTok and Instagram search are discovery: off-topic posts that carry the tag appear, and last30free gives no
  spoken text for them.
- Public metrics show association, never that a hook or format caused a result.
