# Plan: YouTube transcripts on save, and idea groups

Status: proposed, not built. Branch `research-command-centre`.

## What Mits asked for

1. When a **YouTube** idea is saved, fetch its full transcript automatically. Instagram and TikTok stay as they are
   (no automatic fetch; the paste box remains).
2. Group similar YouTube ideas, **at most 3 per group**, and see each group's titles, transcripts and details side
   by side.
3. Under each group, a **blank box** to write the script or brief that combines them.

## What exists today (checked 2026-11-20)

- `Save idea` (`dashboard/lib/ideas.mjs`, `save-idea`) only records the post id and angle in
  `reels-data/research/ideas.json`. It fetches nothing.
- `.claude/skills/research-signals/yt-subtitles.py` fetches full YouTube subtitles with last30free's own reader
  (no audio, no Whisper). Tested on `ZzDRSxx3zgY`: 4,893 words, full transcript.
- Runs backfilled from saved last30free folders carry no transcripts, so most YouTube posts have none.
- A pasted transcript is stored on the idea (`idea.transcript`, origin `manual`), because research imports
  rewrite the post store.
- Baseline tests: `tests/dashboard.test.mjs:454` already fails (a date assertion, 15 Nov vs 17 Nov), before any
  change. Not caused by this work.

## Part A: fetch the transcript on save (YouTube only)

- New `dashboard/lib/transcripts.mjs`: a small in-process queue. One video at a time with a few seconds between
  them, so several saves in a row don't get rate-limited by YouTube. Runs
  `<LAST30FREE_DIR>/.venv/Scripts/python.exe -I yt-subtitles.py <tmp.json> <videoId>` (paths in `lib/config.mjs`,
  overridable by env, same pattern as `linkCommand`).
- `save-idea` for a YouTube post with no transcript adds it to the queue. The save itself returns at once.
- The result goes on the idea as `idea.fetched = { status: 'pending' | 'ok' | 'failed', text, fetchedAt, error }`,
  separate from a pasted `idea.transcript`. Nothing is written to `research.sqlite`.
- Which transcript is used: one already in the research store, then fetched subtitles, then a pasted one. Each is
  labelled for what it is ("YouTube subtitles, fetched when saved" vs "pasted by you").
- The page shows *Fetching transcript…*, *Transcript fetched (N words)*, or *No subtitles available* (the paste
  box stays as the fallback). A **Retry** button on a failed one, and **Fetch missing transcripts** on the Ideas tab
  for YouTube ideas saved before this change.
- A fetch left `pending` by a server restart counts as failed after 5 minutes, so it can be retried.
- Instagram and TikTok: no change.

## Part B: idea groups (YouTube only, max 3)

- Stored in the same `ideas.json` as `groups: [{ id, name, ideaIds, draft, createdAt, updatedAt }]`.
  **Important:** `writeIdeas` today writes only `{ ideas }`, which would wipe groups. It changes to keep the
  whole file. A copy of `ideas.json` goes to `reels-data/research/archive/` before the first write in the new shape.
- Rules, enforced on the server: 1 to 3 ideas per group, YouTube ideas only, an idea in at most one group. Removing
  an idea takes it out of its group. Deleting a group keeps its ideas.
- Actions (all repeat-safe, like the existing ones): `create-group`, `add-to-group`, `remove-from-group`,
  `rename-group`, `set-group-draft`, `delete-group`.
- Ideas tab: a **Groups** section at the top. YouTube idea cards get a "Select" checkbox and a
  **Group selected (n/3)** button, plus "Add to group" on a card.
- Group page: up to 3 columns side by side (stacked on a phone), each with the title, creator, views, published
  date, link, your angle, and the full transcript (scrollable, with Copy). Below them, a large empty **Your script**
  box with Save and Copy, plus **Copy all transcripts** (labelled per video) for pasting into Claude.
- The phone (remote) view can read groups but not change them, the same as ideas today.
- Not in this change: automatic "these titles look similar" suggestions, or exporting a group into a workflow.
  Grouping is by hand. Suggestions could come later.

## Not touched

The research importer and `research.sqlite`, the backfill script, the short-form export to `Instagram_transcript/`,
Signals, Searches, Pipeline, and the skills.

## Checks

- New tests in `tests/research-ideas.test.mjs`: group rules (max 3, YouTube only, one group per idea, repeat-safe),
  groups surviving every existing idea action, the transcript precedence and labels, and the queue with a fake runner
  (no network in tests).
- Run the research tests plus `tests/dashboard.test.mjs`. The only allowed failure is the existing one at line 454.
- A headless browser check of the Ideas tab and a group page, in the style of `dashboard/dev/check-ideas.mjs`.
- Update `dashboard/README.md` (Research section).

## Order

1. Checkpoint commit of the existing uncommitted work, then this plan. Push, so Codex can review.
2. Wait for the go-ahead.
3. Part A, tests, commit.
4. Part B, tests, browser check, commit, push.
