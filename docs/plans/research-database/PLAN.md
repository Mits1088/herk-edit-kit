# Research database: SQLite plan

Status: proposal for review. Nothing here is built yet.
Date: 2026-11-17

## Goal

One local database that holds every short-form (and later long-form) post we collect from TikTok, Instagram and
YouTube, from every provider (Apify via last30free, yt-dlp via last30free, Signal Room MCP), with repeated
measurements over time so the Command Centre Research page can show recent posts, their metrics and how fast those
metrics are growing.

## Where we are today

| Piece | Location | State |
| --- | --- | --- |
| Command Centre (Node server + static HTML) | `D:/herk-edit-kit/dashboard/` | Research page reads the JSON store |
| Research store | `D:/herk-edit-kit/reels-data/research/` (gitignored) | One JSON file per post (41 posts), `searches.jsonl`, `ideas.json` |
| Importer | `dashboard/research-import.mjs` → `lib/research.mjs` `importBatch()` | Validates a whole batch, then merges. Rules in `dashboard/README.md`, "Research store" |
| Batch builder | `.claude/skills/research-signals/build-batch.mjs` | Turns Signal Room responses + last30free JSON into one batch |
| last30free | `D:/Mits AI OS/Research-Assitant - Copy/last30free/` (Python) | Fetches; **drops old and undated posts before output** |
| Signal Room | MCP over HTTP, login held by Claude Code | Instagram + YouTube for its tracked creators |

The JSON store already gets the data rules right (one post per platform + native id, measurements kept per source,
`measuredAt` never guessed, unknown stays `null`, growth only from two dated measurements by one source, scores
from different providers never combined). **This plan keeps those rules and the batch format and replaces only the
storage underneath.**

## Decisions

1. **SQLite**, file `reels-data/research/research.sqlite` (gitignored, durable, beside the current store). Path set
   by `RESEARCH_DB_PATH` (absolute) so the dashboard and any tool share one file.
2. **Node's built-in `node:sqlite`** (Node 24.22 installed): no new dependency. WAL mode on.
3. **One writer: the batch importer.** last30free and Signal Room never write the database directly. They produce
   output, `build-batch.mjs` turns it into a batch, the importer validates and writes it in one transaction. One
   validation path, one place for the rules.
4. **Paid providers are allowed.** Apify for TikTok and Instagram through last30free is now an accepted source.
   The "Paid calls: none" rule in the `research-signals` skill becomes a per-run cap (see Cost).
5. **Store everything fetched, filter when displaying.** "Last 30 days" is a dashboard filter, not a reason to
   discard data we paid for.
6. **The existing score is kept exactly as last30free computes it**, stored with the measurement it was computed
   from, with a formula version. No cross-platform percentile in the default ranking.

## Schema

All times UTC ISO-8601 text. All metric columns nullable: `NULL` = unknown, never 0 for "missing".

```sql
-- One imported batch = one search.
CREATE TABLE searches (
  batch_id      TEXT PRIMARY KEY,           -- e.g. 2026-11-17-claude
  query         TEXT NOT NULL,
  window_days   INTEGER,
  retrieved_at  TEXT NOT NULL,              -- when we fetched
  imported_at   TEXT NOT NULL,
  batch_sha256  TEXT NOT NULL               -- same id + different content is refused
);

-- One provider/lane inside a search, including failures and drop counts.
CREATE TABLE runs (
  id               INTEGER PRIMARY KEY,
  batch_id         TEXT NOT NULL REFERENCES searches(batch_id),
  provider         TEXT NOT NULL,           -- signal-room | last30free
  lane             TEXT NOT NULL,           -- see Lanes
  status           TEXT NOT NULL,           -- ok | error
  error            TEXT,
  note             TEXT,                    -- e.g. "#claudecode"
  fetched_count    INTEGER,                 -- returned by the provider
  in_window_count  INTEGER,
  outside_window_count INTEGER,
  undated_count    INTEGER,
  duplicate_count  INTEGER
);

-- Ordered results of a run (what that search returned, best first).
CREATE TABLE run_results (
  run_id     INTEGER NOT NULL REFERENCES runs(id),
  post_id    INTEGER NOT NULL REFERENCES posts(id),
  position   INTEGER NOT NULL,
  in_window  INTEGER,                       -- 1/0/NULL (undated)
  was_new    INTEGER NOT NULL,              -- first time this post was stored
  PRIMARY KEY (run_id, post_id)
);

CREATE TABLE creators (
  id        INTEGER PRIMARY KEY,
  platform  TEXT NOT NULL,
  handle    TEXT NOT NULL,
  name      TEXT,
  UNIQUE (platform, handle)
);

CREATE TABLE posts (
  id                 INTEGER PRIMARY KEY,
  platform           TEXT NOT NULL,         -- tiktok | instagram | youtube
  native_id          TEXT NOT NULL,         -- TikTok video id, IG numeric media id, YouTube 11-char id
  url                TEXT NOT NULL,
  platform_type      TEXT,                  -- as the platform says: reel, short, video, carousel, photo... or NULL
  format             TEXT NOT NULL,         -- short | long | unknown (our grouping)
  creator_id         INTEGER REFERENCES creators(id),
  title              TEXT,
  caption            TEXT,
  published_at       TEXT,
  duration_seconds   REAL,
  transcript_text    TEXT,
  transcript_origin  TEXT,                  -- signal-room | subtitles | whisper
  transcript_captured_at TEXT,
  first_retrieved_at TEXT NOT NULL,
  last_retrieved_at  TEXT NOT NULL,
  UNIQUE (platform, native_id)
);

-- Which providers have returned this post (provenance).
CREATE TABLE post_sources (
  post_id            INTEGER NOT NULL REFERENCES posts(id),
  provider           TEXT NOT NULL,
  first_retrieved_at TEXT NOT NULL,
  last_retrieved_at  TEXT NOT NULL,
  PRIMARY KEY (post_id, provider)
);

-- One measurement: one provider, one measured time (known or NULL), one set of values. Append-only.
CREATE TABLE observations (
  id               INTEGER PRIMARY KEY,
  post_id          INTEGER NOT NULL REFERENCES posts(id),
  provider         TEXT NOT NULL,
  provider_detail  TEXT,                    -- apify:clockworks~tiktok-scraper, yt-dlp, signal-room
  batch_id         TEXT NOT NULL REFERENCES searches(batch_id),
  measured_at      TEXT,                    -- when the source measured; NULL if it does not say
  retrieved_at     TEXT NOT NULL,           -- when we fetched
  imported_at      TEXT NOT NULL,
  views INTEGER, plays INTEGER, reach INTEGER, likes INTEGER, comments INTEGER,
  shares INTEGER, saves INTEGER, followers INTEGER,
  discovery_score  REAL,                    -- last30free score at measurement (last30free only)
  score_formula    TEXT,                    -- e.g. l30-tiktok-v1
  outlier_metric   TEXT,                    -- Signal Room only
  outlier_value    REAL,
  raw_json         TEXT                     -- the provider record as received
);
-- Exact repeats add nothing (current importer rule). Undated observations dedupe on their values.
CREATE UNIQUE INDEX obs_dedupe ON observations (
  post_id, provider, IFNULL(measured_at, ''), IFNULL(views,-1), IFNULL(plays,-1), IFNULL(likes,-1),
  IFNULL(comments,-1), IFNULL(shares,-1), IFNULL(saves,-1)
);

CREATE TABLE excerpts (
  id        INTEGER PRIMARY KEY,
  post_id   INTEGER NOT NULL REFERENCES posts(id),
  provider  TEXT NOT NULL,
  batch_id  TEXT NOT NULL,
  kind      TEXT NOT NULL,                  -- hook | snippet
  text      TEXT NOT NULL,
  complete  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE schema_version (version INTEGER NOT NULL);
```

`ideas.json` stays a file in the first version (the dashboard is its only writer). It can move to a table later.

### Metrics view (what the Research page reads)

Computed at read time, never stored as fake observations:

| Metric | Formula | Needs |
| --- | --- | --- |
| Age (days) | now − published_at | published_at |
| Views/day, lifetime | latest views ÷ age | 1 dated observation |
| Engagement rate | (likes + comments + shares) ÷ views | 1 observation |
| Share rate | shares ÷ views | 1 observation |
| Reach vs followers | views ÷ followers | 1 observation with followers |
| **Growth per day** | Δ metric ÷ Δ days between the two latest **dated** observations of that metric **from one provider** | 2 dated observations |
| Score now (optional) | last30free formula re-applied to the latest metrics with today's recency, labelled as recalculated | 1 observation |

If an input is `NULL` the metric is `NULL` ("unavailable"), never 0.

## Lanes

| Lane | Provider | Notes |
| --- | --- | --- |
| `instagram_short_form` | signal-room | existing |
| `youtube_short_form`, `youtube_long_form` | signal-room | existing |
| `youtube_discovery` | last30free (yt-dlp search) | existing |
| `tiktok_hashtag` | last30free (Apify or browser) | existing; now usually Apify |
| `instagram_search` | last30free (Apify) | **new**: today the importer rejects Instagram from last30free |
| `youtube_shorts_feed` | last30free (`--youtube-shorts`, yt-dlp hashtag Shorts feed) | **new** |
| `refresh` | any | **new**: re-measuring known posts by id (see Refresh) |

## Changes, in build order

### 1. Database and importer (herk-edit-kit)
- `dashboard/lib/research-db.mjs`: open DB, create schema, migrations by `schema_version`.
- `importBatch()` writes to SQLite in one transaction, keeping every existing rule and test in
  `tests/research.test.mjs`. `--dry-run` reports what would change and writes nothing.
- Same batch twice changes nothing; same `batchId` with different content is refused (`batch_sha256`).
- `readPosts`, `readSearches`, `growth` and `lib/research-view.mjs` read from SQLite. Page and API routes unchanged.

### 2. Migrate what exists
- One-off `dashboard/dev/migrate-json-to-sqlite.mjs`: re-import every batch in `searches.jsonl` order from
  `reels-data/research/sources/` and `inbox/`, then compare post count, observation count and every stored
  field against the JSON files. JSON store moved to `archive/` only after the comparison passes.
- Backfill the ~20 saved last30free runs under `.../last30free/outputs/*/` as last30free-only batches
  (counts were live at save time, so `measured_at = retrieved_at = run time`). Repeat-safe.

### 3. last30free keeps what it fetches (Python, `D:/Mits AI OS/Research-Assitant - Copy/last30free`)
- Adapters (TikTok, Instagram, YouTube) stop discarding items outside the window or without a date. Each item
  gets `in_window: true|false|null`; the report and terminal output still show only in-window items.
- Each source result gets counts: `fetched`, `in_window`, `outside_window`, `undated`, `duplicate`.
- Each item gets the provider record as received (`raw`, full Apify/yt-dlp row, not a selection).
- Missing counts are output as `null`, not 0 (today `EngagementMetrics` defaults to 0; `build-batch.mjs`
  currently converts 0 to unknown as a workaround).
- Each score is output with its formula version.
- Storing old posts does not make the search return more recent ones. If recent coverage is thin, fetch more
  pages with a hard cap (`--max-fetch`), not unbounded paging.

### 4. Batch builder and skill
- `build-batch.mjs`: accept the new lanes, `in_window`, counts, `raw`, `null` metrics, score formula.
- `research-signals` skill: allow Instagram and TikTok via last30free Apify; add YouTube Shorts via
  `--youtube-shorts`; replace "Paid calls: none" with the cost cap below.

### 5. Research page
- One table per platform and format (short-form first; long-form tab present). Columns: post, creator,
  published, measured, views, likes, comments, shares, views/day, engagement rate, share rate, growth/day,
  discovery score (labelled per platform), Signal Room outlier, sources.
- Filters: platform, format, date window (default 30 days), saved search, words. Sort by any column.
- Excel/CSV export of the current table.

### 6. Refresh known posts (real growth)
Repeating a topic search does not guarantee the same posts come back, so growth needs re-measuring by id.
- `last30free refresh --ids <file>`: YouTube by video id via yt-dlp (free); TikTok by URL via Apify
  (`clockworks~tiktok-scraper` accepts post URLs); Instagram by URL via an Apify actor that accepts direct URLs
  (the current search actor may not; to confirm), or Signal Room `get_instagram_content` for tracked creators.
- Selection rule, e.g. short-form published in the last 14 days, top N by views/day. Output imported as a
  `refresh` batch.
- Optional schedule (daily or every few days) once cost is known.

### 7. Signal Room
Already integrated through `research-signals` + `build-batch.mjs`. No new importer needed. Its observations land
in the same tables with `provider = signal-room`; a post found by both sources stays one post with two sources.

## Cost

Apify bills per result. Each run records `fetched_count` per lane, so cost per run = results × actor price.
Default cap per search: 50 results per lane. Refresh jobs state their result count before running.

## Using the YouTube Shorts option now

```
cd "D:/Mits AI OS/Research-Assitant - Copy/last30free"
.venv/Scripts/python -m last30free "claude code" --source youtube --youtube-shorts --json > yt-shorts.json
```

It reads `youtube.com/hashtag/<topic-as-hashtag>/shorts` through yt-dlp, keeps vertical videos up to
`shorts_max_seconds` (120 by default; YouTube allows up to 180), and links them as `/shorts/<id>`.

## Questions for review

1. `node:sqlite` vs `better-sqlite3`: built-in avoids a dependency; is its API stable enough on Node 24 for this?
2. Observation dedupe for undated measurements: unique index on values (above) or a hash column?
3. Should `ideas.json` move into the database in step 1 or stay a file?
4. Which Apify actor should refresh Instagram posts by URL?
5. Is a single writer (the batch importer) acceptable for scheduled refreshes, or should refresh write directly?

## Not in scope

X, Reddit, Hacker News. Long-form analysis beyond storing and listing. Any change to how last30free ranks results.
