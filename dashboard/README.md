# Content dashboard (phases 1 to 4)

One local page showing every reel from source transcript to publication, read live from the files the
workflow already writes.

Phase 1 is read-only towards the workflow, not read-only overall: it never changes a workflow file, but ticking
a task, linking a file or hiding a project saves a tracking note of the dashboard's own.

## Run it

```
node dashboard/server.mjs
```

Then open http://localhost:4319. It answers only on this PC. Stop it with Ctrl+C.

Tests: `node --test tests/dashboard.test.mjs` (also part of `npm test`). `node dashboard/dev/e2e-reel.mjs` runs the
whole video path on synthetic data in `tmp/`: hook approval through the dashboard, a real HyperFrames render,
full QA, then candidate approval through the dashboard. It takes a few minutes.

## What it reads

`Instagram_transcript/`, `reels-data/inputs/`, `instagram_scripts_output/` and its `approved/` folder,
`reels-data/resources.md`, `reels-data/resource-sources/*.pdf.json`, `video-projects/*/reel.json` and each
candidate's `qa.json`, `reels-data/insights/links.json`, file names in `raw-media/` and the Uploads folder, and
the ClaudeClaw mission list when ClaudeClaw is running.

## What it writes

Only `reels-data/content/`: one `<id>.json` per project you act on, and `history.jsonl`. Both are gitignored.
(The separate importer command writes `reels-data/research/`; see "Research store" below.)
A manifest is created the first time you tick a task, link a file or project, or hide a project.

Phase 1 actions never write to scripts, video projects, `raw-media/`, Uploads, `resources.md` or `links.json`.
A test checks this by hashing every file in a sample folder tree before and after, which also covers gitignored
data that `git status` cannot see. Phases 2 and 3 add the few workflow changes listed under their headings; each
happens only when you press the button that names it. Nothing ever writes to `raw-media/` or Uploads.

## What you can do in phase 1

- Mark the voiceover and the HeyGen avatar as done or not done.
- Link an audio file, an avatar video, an Uploads file or a video project to a script. Linking records the
  association; no file is moved.
- Hide a project, and show it again from Pipeline, All.
- In Pipeline, use "Move to All" to set a project aside when you are not interested or not currently working on it. It stays in All, stops appearing in Active and Needs me, and can be restored with "Move to Active". The choice is saved across restarts.
- Play the latest candidate or final video, open a PDF, and copy captions.
- Play an audio or avatar file from `raw-media/`, but only one you have linked to a project. Nothing else in
  `raw-media/` can be opened through the dashboard.

Hook and reel approvals are described under phase 4 below.

## Approvals (phase 2)

- **Script choice.** Approve Version A or B on the Scripts tab. The choice is recorded and the work goes to the
  approve-reel skill: as a ClaudeClaw job when ClaudeClaw is running, otherwise as a command to paste into
  Claude Code. The stage moves only when the approved file exists.
- **PDF gate.** The Resource tab shows the PDF and its SHA-256. Approval and upload are two separate steps.
  "Approve this file" records the approval in `reels-data/content/pdf-approvals.json` and uploads nothing.
  "Upload to Gumroad" then appears, and runs `gumroad_upload.mjs` for that keyword. That script refuses any PDF
  without a matching approval (exit code 4), whoever runs it. A rebuilt PDF has a new hash, so it asks again.
  A guide built before the approval step shows "Record approval of this file" and works the same way.
- **Request changes.** Records your note against that exact version and does nothing else. "Start revision" is
  a separate button. You cannot approve a version while a note on it is waiting.
- **Uploads.** The result is shown on the Resource tab with the script's log. If Gumroad is not logged in, run
  `gumroad auth login` and use "Try the upload again".
  A file Gumroad is still processing is shown as uploaded but processing. Use "Check upload status" to read
  its current size and content-page listing without uploading again. Verification compares the filename and
  size with the approved PDF; Gumroad does not supply a checksum for this check.

Phase 2 changed two workflow files: `approve-reel/gumroad_upload.mjs` (the gate) and step 9 of
`approve-reel/SKILL.md` (the skill no longer uploads). Both have a matching copy under `.agents/skills/`.

## Publishing (phase 3)

- **Instagram.** When ig-insights has found the post, the Publish tab shows it with "Yes, this is the post".
  That runs `link.py confirm <id> --project <slug>`, so `links.json` stays the single record. When ig-insights
  has not collected the post yet, "Mark as published on Instagram" saves the time and link in the dashboard's
  own manifest, marked "entered by you". A post confirmed later in ig-insights takes over.
- **A keyword reel is held.** It cannot be recorded as posted while its keyword is not `live`.
- **Mark keyword set up and live.** On the Resource tab, after ticking that it is set up and tested. It changes
  the status word on that keyword's line in `reels-data/resources.md` and nothing else. The PDF must be approved
  first, unless the reel was published before the approval step existed. "Set back to draft" reverses it.
- **A verified Gumroad upload makes the keyword live.** Mits decided this on 2026-11-16: every keyword delivers
  the same Gumroad pack, so once the upload or "Check status" verifies the approved PDF on Gumroad, the dashboard
  flips that keyword's line to `live` by itself and logs it in `history.jsonl` as `by: verified Gumroad upload`.
  A PDF rebuilt after approval still asks for review, even when its keyword is live.
- **New projects link themselves.** `new-reel.mjs --script <id>` (for example `2026-11-15-003-01`) writes the
  project link into that script's manifest. Without it the project shows as a second, unlinked card.
- **Shorts and TikTok.** Each has its own record, time and link in the manifest (`publishing.youtube`,
  `publishing.tiktok`). One never marks the other. They are "waiting" until the due time, then "due", and the
  reel is "done" when both are recorded. "Due" means no post is recorded here, not that none exists.
- **Earlier posts.** A reel that went on Instagram before `DASH_TRACK_FROM` reads "Not recorded" for Shorts
  and TikTok and raises no task. You can still record them.
- **Uploads folder.** Mits defined it on 2026-11-16: a file in the Uploads root is live on Instagram but not yet
  on Shorts or TikTok; a file in `All social media` is on every platform. Once you link a file to a reel on its
  Publish tab, the page reads its position that way: root makes Shorts and TikTok due, `All social media` marks
  the reel done. Moving the file is enough, but the link stores the path, so re-link after a move. An unlinked
  file says nothing. The folder is only read, never written.
- **Confirmed by project.** A post confirmed in ig-insights for a video project counts for the script that
  holds that project, even when the ig-insights entry names no approved file.
- **Schedule.** Overdue, due today and upcoming, by calendar day in the due timezone.
- **Withdraw.** Each record you entered has "Withdraw this record". It removes the dashboard's note only.

### Phone access

Off by default. Start with `DASH_LAN=1` and the server also answers on your home network, then prints a link
containing a long random token. Open that link once on the phone; it stores a cookie and drops the token from
the address. The token is kept in `reels-data/content/phone-token.txt`; delete that file to issue a new one.

- The phone can copy captions, download `final.mp4` and record or confirm what was published. Every other
  action is refused there and stays on the PC. Linked `raw-media/` files are not served to the phone.
- The PC must be on with the server running. Windows may ask once to allow Node through the firewall.
- It is plain http, so the token is readable by other devices on the same Wi-Fi. Use it on your home network
  only. Requests from outside private network ranges are refused.

## Hook and reel approvals (phase 4)

Both are on the Video tab, on the PC only. Each runs the Reel Studio script that already owns the rule, then
reads the saved record back; the page moves on only if the record is there.

- **Hook.** Shown while a reel waits at Gate B. The page gets the plan's fingerprint from `preflight-reel.mjs`
  itself, links to the Studio preview that was recorded, and lists the scenes. "Approve this hook" runs
  `preflight-reel.mjs --approve` with that full fingerprint. If the plan changed since the page loaded, it is
  refused. It never approves paid generation; that still needs a provider and spending limit in Claude Code.
  The preview plays in HyperFrames Studio. The page checks whether Studio is answering and says "Preview
  available" or "Preview unavailable"; it cannot know whether you watched it, so you tick "I have watched this
  opening" before the button works. `preflight-reel.mjs --record-opening` now saves the plan fingerprint the
  opening was shown for; if that is not the plan on screen, approval is refused until the opening is recorded
  again. A preview recorded before this existed is checked by order instead (was the plan edited afterwards?).
- **Candidate.** Shown when the latest candidate passed QA. The player shows that candidate, not an older
  final. "Approve as the final video" runs `approve-reel.mjs` with the candidate's full SHA-256. The script
  re-hashes the file, so a file changed after QA is refused. The approved file becomes `renders/final.mp4`
  byte for byte; nothing is rendered again. A candidate that failed QA has no approve button.
- **Request changes.** Records your note against that exact plan or file and does nothing else. "Start
  revision" is separate. Video work runs in Claude Code, never as a queued job, so it gives you a command to
  paste, and the reel stays marked "revision started, nothing new yet" until a new preview or candidate exists.
- The name written into approvals is `DASH_APPROVER` (default `Mits`).

These write to the project's `reel.json`, the candidate's `qa.json` and `QA.md`, and `renders/final.mp4` (the
previous final is archived by the script), all through the two scripts.

## Research (store, importer and read-only page)

Research on Instagram, YouTube and TikTok is kept in `reels-data/research/` (gitignored). The dashboard server
does not write there and cannot call Signal Room, whose login lives in Claude Code. Claude runs the research
(the `research-signals` skill, which builds the batch from raw results with `build-batch.mjs`),
writes one batch file, and this command merges it:

```
node dashboard/research-import.mjs reels-data/research/inbox/<batch>.json [--dry-run]
```

The whole batch is checked first. If anything is wrong it lists every problem, exits 1 and changes nothing.

| File | Holds |
| --- | --- |
| `posts/<platform>-<id>.json` | One post per platform and native id: link, format, duration, creator, caption, transcript, provenance, measurements. YouTube file names carry the id in hex, because YouTube ids are case-sensitive and Windows file names are not; the real id is `nativeId` inside. |
| `searches.jsonl` | One line per imported batch: the query, each source run with its status, error and ordered results. |
| `ideas.json` | Saved ideas and notes (stage 4). The importer never writes to it. |
| `inbox/` | Where batch files are put. The importer reads the file it is given and leaves it in place. |
| `sources/<batchId>/` | What `build-batch.mjs` built the batch from: the draft and the last30free output files. Kept so a copied number can be checked. |
| `archive/` | Earlier stores set aside by hand. Nothing reads it. |

### Batch format

```json
{
  "schema": 1,
  "batchId": "2026-11-17-n8n",
  "retrievedAt": "2026-11-17T09:00:00Z",
  "search": { "query": "n8n", "windowDays": 30 },
  "runs": [
    { "provider": "signal-room", "lane": "instagram_short_form", "status": "ok", "results": ["instagram:3968528610867647341"] },
    { "provider": "last30free", "lane": "tiktok_hashtag", "status": "error", "error": "TikTok search failed: timeout", "note": "#n8n", "results": [] }
  ],
  "posts": [
    {
      "platform": "instagram", "id": "3968528610867647341", "provider": "signal-room",
      "url": "https://www.instagram.com/p/DcTC77TvZNt/", "format": "short",
      "creator": { "handle": "creator", "name": "Creator" },
      "title": "…", "caption": "…", "publishedAt": "2026-08-21T10:00:00Z", "durationSeconds": 51.4,
      "transcript": { "text": "spoken words", "origin": "signal-room", "capturedAt": "2026-08-23T00:00:00Z" },
      "observation": {
        "measuredAt": "2026-08-22T10:17:39Z",
        "metrics": { "plays": 24090, "likes": 469, "saves": null },
        "outlier": { "metric": "reach_per_follower", "value": 1.05, "percentile": 100, "cohortSize": 20 }
      }
    }
  ]
}
```

- **Lanes:** `instagram_short_form`, `youtube_short_form`, `youtube_long_form` (Signal Room), `youtube_discovery`,
  `tiktok_hashtag` (last30free). Instagram is accepted from Signal Room only and TikTok from last30free only.
  Nothing else has a lane, so X, Hacker News and Reddit cannot be imported.
- **Ids** are the platform's own: Instagram numeric media id (not the link shortcode), YouTube 11-character video
  id, TikTok numeric video id. `results` are `platform:id`, best match first; they are the top matches from that
  search, not everything that exists. Every post must appear in a run of its own provider.
- **Times** are UTC, `YYYY-MM-DDTHH:MM:SSZ`. `retrievedAt` is when we fetched. `observation.measuredAt` is when the
  source measured, `null` when it does not say; it is never guessed from the retrieval time. For a last30free live
  fetch the two are the same moment, so the batch may set `measuredAt` equal to `retrievedAt`.
- **Unknown stays unknown:** use `null` (or leave the key out) for a metric, date, duration or transcript you do not
  have. `format` is `short`, `long` or `unknown`. Metrics allowed: views, plays, reach, likes, comments, shares,
  saves, followers.
- **Excerpts** (optional `excerpts: [{ kind: "hook" or "snippet", text, complete? }]`) are the text a search returned
  around its match, word for word. They are kept with their source and batch, and are never a transcript. Set
  `complete: false` when only part of the returned text was copied.
- **Transcript** means spoken words; `origin` is `signal-room`, `subtitles` or `whisper`. A caption goes in
  `caption`. A transcript identical to the caption is rejected.
- **Evidence stays separate:** `outlier` (performance relative to the creator or cohort) is accepted from Signal
  Room only, `discoveryScore` (engagement at fetch) from last30free only. They are stored as different fields on
  different measurements and are never combined.
- A post found by both sources is listed once per provider; it becomes one stored post with two provenance entries.

### What an import does

- One stored post per platform and native id. A later retrieval can correct a field; a missing field never blanks one.
- One measurement is one source, one measured time (known or unknown) and one set of values. An exact repeat adds
  nothing, so repeating an undated result creates no history. Equal counts at two known times stay two
  measurements. An undated measurement is never merged into a dated one, and its date is never filled in from a
  later result. Stored measurements are never edited apart from their "last retrieved" time.
- The same batch again changes nothing. The same `batchId` with different contents is refused.
- A failed run is logged with its error. Posts a batch does not mention are not opened, so a failure or an
  omission leaves them as they were.
- `growth(post, provider, metric)` in `lib/research.mjs` returns a figure only from two dated measurements of that
  metric by that one source; otherwise it returns nothing.
- `matchText` / `matchPost` filter retrieved text. Bare words are whole words and must all appear ("AI" is not in
  "said"; "MCP" is not "MCP50"), and a bare word also accepts one plural s ("MCP" finds "MCPs"). `"Quoted words"`
  are exact: together, in order, with no plural added. Case is ignored, and the result says whether the
  transcript, title or caption matched.

### The Research page

Research in the main navigation, with two views. It only reads; the routes are `GET /api/research`,
`/api/research/searches` and `/api/research/post`. Saving ideas and handing off to production are not built yet.

- **Signals.** Filters search what is already saved (saved search, words in the saved text, platform, format,
  publication date, sort). They never run a new search; the page shows the Claude Code command for that.
- **Date window.** Enforced on the stored publication date, 30 days by default. Older posts sit under each list
  as collapsed "historical references". A post with no publication date is listed apart and never counts as recent.
- **One list per platform and format,** never merged. Each row carries source badges (Signal Room: tracked
  creators; last30free: discovery).
- **Freshness.** "Measured N days ago" comes from the source's measurement time and is marked stale after 7 days;
  "Measurement time unknown" when the source gave none. Publication and import dates are shown separately.
- **Raw engagement and creator outlier are separate columns.** `bounded_velocity_signal` is shown as "Not ranked":
  it changed between two calls for the same video, so it is left out of sorting and growth.
- **Growth** appears only from two dated measurements of one count by one source; otherwise "Growth unavailable".
- **A post's page** shows where it was found (search, run, source, position), every measurement, the matched
  words in place, and the saved text by kind: search excerpt, caption, full transcript. "Copy transcript" exists
  only when a transcript does. "Original records" shows the kept builder inputs for that post.
- **Searches.** Every imported search with each run's result, failure text and notes.

Tests: `node --test tests/research.test.mjs tests/research-view.test.mjs tests/research-signals.test.mjs`.
Browser check with screenshots (headless, sends no actions): `node dashboard/dev/check-research.mjs`.

## Rules it follows

- A stage is shown as done only when a file proves it. Anything else is "Not recorded".
- Files show outputs, not whether an agent is running now. If ClaudeClaw's queue does not answer, the page says
  "Job status unavailable".
- A link proposed by ig-insights is offered, never applied. A proposed Instagram post is not "published".
- A video project with no linked script is listed separately until you link or hide it.
- Scripts never approved after 14 days, and batches never exported, are shown under All, not Needs me.

## Settings (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `DASH_PORT` | `4319` | Port |
| `DASH_DUE_HOUR` | `9` | Hour when Shorts and TikTok fall due on the second calendar day |
| `DASH_TZ` | `Europe/London` | Timezone for that hour and for every time shown. Not taken from the PC clock |
| `DASH_DUE_CONFIRMED` | unset | Set to `1` once you have confirmed the hour and timezone. Until then due dates say "provisional" |
| `DASH_TRACK_FROM` | `2026-11-16` | Instagram posts before this date read "Not recorded" for Shorts and TikTok |
| `DASH_LAN` | unset | Set to `1` to allow phone access over home Wi-Fi |
| `DASH_LINK_SCRIPT` | ig-insights `link.py` | Script used to confirm an Instagram post |
| `DASH_APPROVER` | `Mits` | Name recorded on hook and candidate approvals |
| `DASH_UPLOADS_ALL` | `All social media` | Subfolder of Uploads that means "on every platform" |
| `DASH_UPLOADS` | `D:/Uploads` | Uploads folder, read only |
| `DASH_MISSION_AGENT` | `main` | ClaudeClaw agent that receives approval and revision jobs |
| `DASH_MISSION_CLI` | `D:/claudeclaw-os/dist/mission-cli.js` | ClaudeClaw mission CLI |
