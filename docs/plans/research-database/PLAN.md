# Research database: SQLite plan

Status: agreed (revision 2, after review). Steps 1 to 4 built; step 5 (Research page) next. Older-run backfill (step 2) not yet run.
Date: 2026-11-17

## Goal

One local library of every short-form (and later long-form) post we collect from TikTok, Instagram and YouTube,
from every provider (last30free via Apify and yt-dlp, Signal Room MCP), across every topic we research. The
Command Centre Research page shows an evolving shortlist from that library with its metrics.

## What the page does

- **Short form first**, long-form on its own tab.
- **Filters at the top:** platform, published in the last 7 / 30 / 90 days, topic (default **All**), saved search,
  words, sort.
- **Top 50** = the first 50 posts after filtering and sorting, drawn from the whole library. "Show more" for the rest.
  Posts that leave the window or drop below 50 leave the view; they stay stored.
- A post missing from the latest search is **not** removed. Searches vary; it leaves the list only through the
  filters or the ranking.
- **Metrics up front:** original score, views, likes, comments, shares, engagement rate, share rate,
  **average views/day**, published, **last checked**. Growth only as a bonus column (below).
- Expected use: searches about twice a week, across several topics.

## Where we are today

| Piece | Location | State |
| --- | --- | --- |
| Command Centre (Node server + static HTML) | `dashboard/` | Research page reads the JSON store |
| Research store | `reels-data/research/` (gitignored) | One JSON file per post (41 posts), `searches.jsonl`, `ideas.json` |
| Importer | `dashboard/research-import.mjs` → `lib/research.mjs` `importBatch()` | Validates a whole batch, then merges |
| Batch builder | `.claude/skills/research-signals/build-batch.mjs` | Signal Room responses + last30free JSON → one batch |
| last30free | `research-assitant` repo (Python) | Fetches; drops old and undated posts before output |
| Signal Room | MCP over HTTP, login held by Claude Code | Instagram + YouTube for its tracked creators |

The JSON store's data rules are kept. **Only the storage underneath changes.**

## Decisions

1. **SQLite** at `reels-data/research/research.sqlite` (gitignored). No path override: the importer and the dashboard
   both live in this repo and find it through `cfg.researchDir`, and tests can never point at the real file.
2. **Built-in `node:sqlite`.** Its API is a release candidate, not fully stable: `engines` requires Node 22.13+
   (unflagged), tested on 24.22. Default rollback journal (WAL left read-only views' `-wal`/`-shm` files behind),
   busy timeout 5 s, every import one transaction, dashboard reads read-only.
3. **One writer: the batch importer.** last30free and Signal Room never write the database. Overlapping manual and
   scheduled imports are serialised by the transaction and busy timeout.
4. **Import contract unchanged.** Same batch format, same validation, same public post keys
   (`postKey(platform, id)`) so saved ideas and links keep resolving. `ideas.json` stays a file.
5. **Store everything fetched; filter when displaying.**
6. **Original score kept exactly**, with its formula version, compared within its platform only. No
   cross-platform percentile in the default ranking.
7. **Paid providers allowed, with a money cap** (see Cost).
8. **No paid refresh jobs for now.** Growth appears only when a post naturally comes back in a later search.

## Schema

UTC ISO-8601 text for times. Every metric nullable: `NULL` = unknown, never 0.

```sql
CREATE TABLE searches (                    -- one imported batch = one search
  batch_id      TEXT PRIMARY KEY,
  query         TEXT NOT NULL,             -- the topic
  window_days   INTEGER,
  retrieved_at  TEXT NOT NULL,
  imported_at   TEXT NOT NULL,
  sha256        TEXT NOT NULL,             -- same id + different content is refused
  post_count    INTEGER NOT NULL,
  record_json   TEXT NOT NULL              -- the searches.jsonl line, kept verbatim
);

CREATE TABLE runs (
  batch_id   TEXT NOT NULL REFERENCES searches(batch_id),
  seq        INTEGER NOT NULL,             -- order within the batch
  provider   TEXT NOT NULL,
  lane       TEXT NOT NULL,
  status     TEXT NOT NULL,                -- ok | error
  error      TEXT,
  note       TEXT,
  counts_json TEXT,                        -- fetched / in_window / outside_window / undated / duplicate (step 3)
  cost_json   TEXT,                        -- Apify run id, charge (step 3)
  PRIMARY KEY (batch_id, seq)
);

CREATE TABLE run_results (                 -- what each search returned, in order
  batch_id  TEXT NOT NULL,
  seq       INTEGER NOT NULL,
  position  INTEGER NOT NULL,
  post_key  TEXT NOT NULL REFERENCES posts(key),
  PRIMARY KEY (batch_id, seq, position)
);

CREATE TABLE posts (
  key                TEXT PRIMARY KEY,     -- postKey(platform, id): the existing public key
  platform           TEXT NOT NULL,
  native_id          TEXT NOT NULL,
  url                TEXT,
  format             TEXT NOT NULL,        -- short | long | unknown
  creator_handle     TEXT,                 -- either may be missing (YouTube channel name only, etc.)
  creator_name       TEXT,
  title              TEXT,
  caption            TEXT,
  published_at       TEXT,                 -- NULL when unknown, never "now"
  duration_seconds   REAL,
  transcript_text    TEXT,
  transcript_origin  TEXT,
  transcript_captured_at TEXT,
  transcript_provider TEXT,
  first_retrieved_at TEXT NOT NULL,
  last_retrieved_at  TEXT NOT NULL,
  UNIQUE (platform, native_id)
);

CREATE TABLE post_sources (                -- provenance
  post_key           TEXT NOT NULL REFERENCES posts(key),
  provider           TEXT NOT NULL,
  first_retrieved_at TEXT NOT NULL,
  last_retrieved_at  TEXT NOT NULL,
  PRIMARY KEY (post_key, provider)
);
CREATE TABLE post_source_batches (
  post_key TEXT NOT NULL, provider TEXT NOT NULL, batch_id TEXT NOT NULL, seq INTEGER NOT NULL,
  PRIMARY KEY (post_key, provider, batch_id)
);

-- One measurement: one provider, one measured time (known or NULL), one set of evidence. Append-only.
CREATE TABLE observations (
  id                 INTEGER PRIMARY KEY,
  post_key           TEXT NOT NULL REFERENCES posts(key),
  provider           TEXT NOT NULL,
  measured_at        TEXT,                 -- NULL when the source does not say
  measured_basis     TEXT,                 -- source | collection | file-mtime | backfill-run-time
  fingerprint        TEXT NOT NULL,        -- canonical hash: provider, measured_at, every metric, score,
                                           -- score formula, every outlier field
  views INTEGER, plays INTEGER, reach INTEGER, likes INTEGER, comments INTEGER,
  shares INTEGER, saves INTEGER, followers INTEGER,
  discovery_score    REAL,                 -- last30free only
  score_formula      TEXT,
  outlier_metric     TEXT,                 -- Signal Room only
  outlier_value      REAL,
  outlier_percentile REAL,
  outlier_cohort_size INTEGER,
  first_retrieved_at TEXT NOT NULL,
  last_retrieved_at  TEXT NOT NULL,
  UNIQUE (post_key, fingerprint)
);
-- Which batches saw each observation (a repeat sighting links here instead of adding a row).
CREATE TABLE observation_sightings (
  observation_id INTEGER NOT NULL REFERENCES observations(id),
  batch_id       TEXT NOT NULL,
  PRIMARY KEY (observation_id, batch_id)
);

CREATE TABLE excerpts (
  post_key  TEXT NOT NULL REFERENCES posts(key),
  seq       INTEGER NOT NULL,
  provider  TEXT NOT NULL,
  batch_id  TEXT NOT NULL,
  kind      TEXT NOT NULL,                 -- hook | snippet
  text      TEXT NOT NULL,
  complete  INTEGER,                       -- 0 = only part was copied; NULL = complete
  PRIMARY KEY (post_key, seq)
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);   -- schema version
```

Raw provider records stay in `sources/<batchId>/` (already kept by the builder), not in the database.

### Metrics (computed at read time, never stored as observations)

| Metric | Definition | Needs |
| --- | --- | --- |
| **Average views/day** | views ÷ (post's age **at measurement** = measured_at − published_at, in days). Average performance up to that measurement, not current speed. Shown with **Last checked**. | 1 dated observation + published_at |
| Engagement rate | (likes + comments + shares) ÷ views | 1 observation |
| Share rate | shares ÷ views | 1 observation |
| Original score | last30free's score as recorded, labelled per platform | 1 last30free observation |
| **Growth (bonus)** | change between the **two latest distinct measured times** of one metric from one provider, shown with both dates ("+40K views, 14 → 17 Nov") | 2 dated observations |

Any missing input → "unavailable", never 0. Growth moves from earliest→latest (today's `growth()`) to
latest-pair: a deliberate change, covered by tests. Observations whose `measured_basis` is `file-mtime` or
`backfill-run-time` are shown but never used for growth.

## Lanes

| Lane | Provider | |
| --- | --- | --- |
| `instagram_short_form`, `youtube_short_form`, `youtube_long_form` | signal-room | existing |
| `youtube_discovery`, `tiktok_hashtag` | last30free | existing (TikTok now usually Apify) |
| `instagram_search` | last30free (Apify) | new in step 4 |
| `youtube_shorts_feed` | last30free (`--youtube-shorts`) | new in step 4 |

## Build order

### 1. Database and importer (herk-edit-kit)
- `dashboard/lib/research-db.mjs`: open, schema, `meta.schema_version`.
- `importBatch()` writes SQLite in one transaction with the canonical observation fingerprint. Every existing rule
  and test in `tests/research.test.mjs` still passes. `--dry-run` writes nothing.
- `readPosts` / `readSearches` return the same object shapes as today, so `research-view.mjs`, the API routes and
  the page work unchanged.

### 2. Migrate the existing store
- `dashboard/dev/migrate-json-to-sqlite.mjs`: load every `posts/*.json` and `searches.jsonl` into SQLite as they are
  (no re-derivation), then compare: post count, observation count, and every post re-read from SQLite equals its
  JSON file. Only then move `posts/` and `searches.jsonl` to `archive/<date>-before-sqlite/`. `ideas.json`,
  `sources/` and `inbox/` stay where they are.
- Backfill older last30free runs from `outputs/*/`: `measured_basis = backfill-run-time`, so they never produce
  growth. Repeat-safe.

### 3. last30free keeps what it fetches (research-assitant)
- New `fetched` collection in the JSON output: every record each source returned, with
  `in_window: true|false|null`. `merged.items` stays the in-window, report-eligible list.
- Per-source counts: `fetched`, `in_window`, `outside_window`, `undated`, `duplicate`.
- `created_at` becomes nullable (today missing dates default to "now").
- Missing counts output as `null`, not 0. Map Instagram `share_count` and TikTok saves (`collectCount`).
- Each item carries `collected_at` (its own collection time) and its score formula version.
- Apify: `maxTotalChargeUsd` on every run, a cumulative per-search budget, and the Apify run id and actual charge
  recorded per run.

### 4. Builder and skill
- `build-batch.mjs`: read `fetched`, use `collected_at` instead of file modification time (file time only as a
  fallback, marked `file-mtime`), add the new lanes and counts.
- `research-signals` skill: Instagram and TikTok via last30free Apify allowed; YouTube Shorts via
  `--youtube-shorts`; "Paid calls: none" replaced by the money cap.

### 5. Research page
- The page described above, plus CSV/Excel export of the current table.

### Later
- Paid refreshes of known posts by id (`apify/instagram-scraper` direct URLs, TikTok post URLs, yt-dlp by id) if
  natural repeat sightings prove too sparse for growth.

## Cost

- Collection limit: 50 results per lane per search.
- Money limit: `maxTotalChargeUsd` per Apify run plus a cumulative budget per search. The TikTok actor bills per
  event, so a result count is not a spending limit.
- Each run records its Apify run id and actual charge. "Results × price" is only an estimate.
- Costs scale with topics × searches per week.

## Review answers (2026-11-17)

| Question | Answer |
| --- | --- |
| `node:sqlite` or `better-sqlite3` | Built-in; pin Node 24.22 |
| Undated dedupe | Canonical evidence fingerprint + `observation_sightings` |
| Move `ideas.json` | No, keep the file |
| Instagram refresh actor | `apify/instagram-scraper` (later) |
| Refresh writing directly | No, single importer |

## Not in scope

X, Reddit, Hacker News. Long-form analysis beyond storing and listing. Changes to how last30free ranks results.
