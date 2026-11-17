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

## Zernio publishing

Completed implementation, naming changes, current reel status and continuation notes:
[publishing handover](../docs/HANDOVER-command-centre-publishing.md).

The existing Publish tab now previews the exact approved final MP4, account handles and IDs, editable text
for Instagram, Facebook, TikTok and YouTube, hashtags, YouTube title/keyword tags/visibility, TikTok delivery,
privacy, interactions and consent. Facebook starts with a separate copy of the Instagram caption and can be
edited independently. Subtitles stay in the approved render.

Configure the two server-side credentials in the ignored root `.env`, or environment variables:

```dotenv
ZERNIO_KEY_TIKTOK_YOUTUBE=
ZERNIO_KEY_INSTAGRAM_FACEBOOK=
```

The first setting routes TikTok and YouTube through login A; the second routes Instagram and Facebook through
login B. Keys are never returned to the browser. Check accounts uses only account, health and TikTok creator-info
GETs. It verifies Instagram professional-account permissions and the selected Facebook Page. Several matching
accounts block that destination rather than silently picking a different handle.

For the first deliberate live submission:

1. Restart the Command Centre (`node dashboard/server.mjs`) and open the reel's **Publish** tab on this PC.
2. Watch the approved final video. Review the handle, platform text, hashtags and settings. The script, matching
   video approval/QA, creative preflight and any promised PDF/resource must already be approved and live.
   A PENDING REVIEW trial cannot pass these gates.
3. Select the intended destinations. For TikTok choose Direct Post or Creator Inbox, choose privacy and confirm
   both consent boxes. Choose YouTube visibility explicitly.
4. Click **Publish selected**, or enter a time in **Europe/London** and click **Schedule selected**. These actions
   start a real upload and submission. Opening the page, Save text, Check accounts and Check status never do.
5. Read each saved submission's result. **Scheduled in Zernio** means its hosted scheduler accepted it; the PC
   can then be off. **Published** is recorded separately and includes the public link when one is available.

Each destination has a persisted identity/idempotency key, video SHA, exact caption, account, settings and
schedule before its upload starts. A partial failure never hides successful destinations. Retry publish or
Retry schedule uses the failed destination's saved snapshot; it does not repost successes. A known failed
provider post uses its retry endpoint, after a read-only reconciliation. An unconfirmed creation reuses its
original identity and media URL, and is blocked after the conservative 23-hour safe retry window. Interrupted
uploads remain on disk for explicit recovery. Status checks never resume work automatically.

Status refresh runs every 30 seconds while this reel's Publish tab is open on the PC, or through Check status.
No webhooks or local scheduled publishing jobs are required. Scheduled work remains in Zernio after dashboard
shutdown. Preserve `reels-data/content/`; its manifests hold both historical records and submission identities.

Limits: Facebook Reels use the documented 3–60 second format; Instagram needs a professional account and Facebook
needs a Page. TikTok Business Direct Post currently exposes public privacy; Creator Inbox needs a final Post tap
in TikTok and is tracked as manual action until a public link resolves. YouTube determines Shorts from video
shape/duration; this composer declares content not made for children. Provider quotas and processing still apply.
Past or ambiguous/skipped UK clock-change times are refused. Scheduling requires 10 minutes to 180 days ahead.
Retries preserve the submitted video/text. A known failed remote post uses **Retry publish now** after its due
time; future schedules cannot be published early by retry. Editing or cancelling an accepted post stays in Zernio.
Publishing actions remain on the PC; the authenticated phone view can review/download and retain its existing
manual publication-record actions.

Contract references: [quickstart](https://docs.zernio.com/quickstart),
[create post](https://docs.zernio.com/posts/create-post), [uploads](https://docs.zernio.com/guides/media-uploads),
[timezones and scheduling](https://docs.zernio.com/guides/timezones),
[idempotency](https://docs.zernio.com/guides/idempotency),
[TikTok](https://docs.zernio.com/platforms/tiktok/posts),
[YouTube](https://docs.zernio.com/platforms/youtube),
[Instagram](https://docs.zernio.com/platforms/instagram),
[Facebook](https://docs.zernio.com/platforms/facebook/posts).
The requested `/products/scheduler` URL was unavailable during verification; the current create-post and
timezone references supply the scheduler contract.

Verification: `node --test tests/zernio.test.mjs` and `node dashboard/dev/check-publishing.mjs` use isolated fixture
data and mocked API calls for every upload, publish, schedule and retry. The browser check is headless Edge,
disables Pointer Lock, blocks external browser requests, and writes desktop/phone screenshots and a report to
`tmp/command-centre/publishing/` (ignored). Live verification is limited to read-only connected-account checks.

## Manual publishing records (phase 3)

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
  re-hashes the file, so a file changed after QA is refused. The approved file becomes `renders/<reel-slug>-final.mp4`
  byte for byte; nothing is rendered again. A candidate that failed QA has no approve button.
- **Request changes.** Records your note against that exact plan or file and does nothing else. "Start
  revision" is separate. Video work runs in Claude Code, never as a queued job, so it gives you a command to
  paste, and the reel stays marked "revision started, nothing new yet" until a new preview or candidate exists.
- The name written into approvals is `DASH_APPROVER` (default `Mits`).

These write to the project's `reel.json`, the candidate's `qa.json` and `QA.md`, and the named final MP4 (the
previous final is archived by the script), all through the two scripts.

New projects record their named output in `reel.json.finalFile`; approval records name it in `promotedTo`.
The dashboard preview, download and publisher follow that recorded path. Older approvals using `final.mp4`
remain readable. If the approved final is missing, **Restore approved final video** re-checks the candidate's
hash and restores it without creating a second approval. A final renamed to the new convention is reconciled
through the approval script, preserving the original approval date and archiving a different existing file.

**Outside edits (for example Canva).** After a candidate is approved, the Renders panel has **Use an outside
edit**: a dropdown of MP4s in `renders/` that Reel Studio did not render and that are not an approved version
(including the named final when its bytes changed after approval, as when a Canva download is saved over it).
Choosing one plays it and shows its length and size against the approved final, with warnings such as Facebook's
60-second limit. After ticking "I watched and listened to this exact file", **Approve as final** runs
`approve-external.mjs` with its full SHA-256. The script approves it only as a finish of the approved, QA-passed
candidate (`basedOn`), checks it (decodes, H.264, vertical 9:16, audio, at least 3 s), keeps a copy in
`renders/approved/external-<sha12>.mp4` with a check report beside it, and makes it the named final. Publishing
then follows the new approval. Approval is refused while a Zernio post for the reel is prepared, in flight,
unconfirmed or scheduled, so a scheduled post can't send the old cut. A missing outside-edit final is restored
from its kept copy.

## Research (store, importer, page and saved ideas)

Research on Instagram, YouTube and TikTok is kept in `reels-data/research/` (gitignored), in one SQLite database,
`research.sqlite` (built-in `node:sqlite`; Node 22.13 or later, tested on 24.22). The dashboard server opens it
read-only and writes one file there, `ideas.json` (your saved ideas), and cannot call Signal Room, whose login lives in Claude Code. Claude runs the research
(the `research-signals` skill, which builds the batch from raw results with `build-batch.mjs`),
writes one batch file, and this command merges it:

```
node dashboard/research-import.mjs reels-data/research/inbox/<batch>.json [--dry-run]
```

The whole batch is checked first. If anything is wrong it lists every problem, exits 1 and changes nothing.

| File | Holds |
| --- | --- |
| `research.sqlite` | Every post (one per platform and native id: link, format, duration, creator, caption, transcript), its sources, every measurement, excerpts, and one record per imported search with each run's status, error and ordered results. Written only by the importer, one transaction per batch. Schema: `dashboard/lib/research-db.mjs`; plan: `docs/plans/research-database/PLAN.md`. Post keys are `<platform>-<id>`, with YouTube ids in hex because they are case-sensitive. |
| `ideas.json` | Saved ideas: the post, your angle, and any export record. Written by the Research page only. The importer never writes to it. |
| `inbox/` | Where batch files are put. The importer reads the file it is given and leaves it in place. |
| `sources/<batchId>/` | What `build-batch.mjs` built the batch from: the draft and the last30free output files. Kept so a copied number can be checked. |
| `archive/` | Earlier stores set aside, including the JSON store from before SQLite (`<date>-before-sqlite/`). Nothing reads it. |

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
- One measurement is one source, one measured time (known or unknown) and one set of values: every metric,
  the score and every outlier field (its fingerprint). An exact repeat adds nothing, and the batch that saw it again
  is linked to it, so repeating an undated result creates no history. Equal counts at two known times stay two
  measurements. An undated measurement is never merged into a dated one, and its date is never filled in from a
  later result. Stored measurements are never edited apart from their "last retrieved" time.
- The same batch again changes nothing. The same `batchId` with different contents is refused.
- A failed run is logged with its error. Posts a batch does not mention are not opened, so a failure or an
  omission leaves them as they were.
- `growth(post, provider, metric)` in `lib/research.mjs` compares the latest measurement with the latest earlier
  one of that metric by that one source; otherwise it returns nothing.
- The whole batch is written in one transaction. A dry run opens the database read-only and never creates it.
- `node dashboard/research-import.mjs --status` prints how many searches are stored and the latest one, as JSON.
- `matchText` / `matchPost` filter retrieved text. Bare words are whole words and must all appear ("AI" is not in
  "said"; "MCP" is not "MCP50"), and a bare word also accepts one plural s ("MCP" finds "MCPs"). `"Quoted words"`
  are exact: together, in order, with no plural added. Case is ignored, and the result says whether the
  transcript, title or caption matched.

### The Research page

Research in the main navigation, with three views: Signals, Ideas and Searches. The read routes are
`GET /api/research`, `/api/research/searches`, `/api/research/post` and `/api/research/ideas`. Saved ideas and the
short-form export go through `POST /api/research/action`, on this PC only.

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
- **Growth** is since the previous measurement: the latest two distinct measured times of one count by one source,
  shown with both dates; otherwise "Growth unavailable". A time taken from a file date or a backfilled run never
  counts.
- **A post's page** shows where it was found (search, run, source, position), every measurement, the matched
  words in place, and the saved text by kind: search excerpt, caption, full transcript. "Copy transcript" exists
  only when a transcript does. "Original records" shows the kept builder inputs for that post.
- **Searches.** Every imported search with each run's result, failure text and notes.

### Saved ideas, Copy brief and the short-form export

- **Save idea** is on every post's page, with or without a transcript. One idea per post: a second click changes
  nothing. Your angle (up to 2,000 characters) can be edited at any time and is shown in its own panel, above a
  "Source evidence" heading. An idea can be removed until it has been exported.
- **Copy brief** works for every saved idea, long-form included. It carries the source link, platform and format,
  your angle under its own heading, the measurements, and each text under what it is: search excerpt, caption or
  description, transcript (the first 250 words when longer). Long-form has no production workflow connected yet,
  so the brief is its only handoff.
- **Export to the script workflow** appears only when the post is verified short-form and has a real full
  transcript, a source link and a duration. A caption or a search excerpt is not a transcript. Otherwise the page
  lists what is missing.
- The export writes `Instagram_transcript/research-<platform>-<id>.md`: a `## Reel:` heading, `Source:`,
  `Duration: Ns`, one `Stats:` line, your angle on a `Note from Mits:` line, a blank line, then the spoken words.
  `rewrite-reels` and `check_reel.py` treat the note as your direction, never as source speech.
- It never overwrites. A different file with that name is refused; an identical one (an interrupted export) is
  adopted. A second export of the same idea writes nothing. The idea records the file, time, post and source link.
- After export the page shows the file, the `/rewrite-reels` command, and a Pipeline link when a pipeline item
  actually holds that file. Changing your angle afterwards is flagged; the exported file is left as it was.
- A phone on the home network can read ideas but cannot save, edit or export them. Production approvals and the
  phone's existing permissions are unchanged.

Tests: `node --test tests/research.test.mjs tests/research-view.test.mjs tests/research-signals.test.mjs tests/research-ideas.test.mjs`.
Browser checks with screenshots (headless): `node dashboard/dev/check-research.mjs` reads the real store and sends
no actions; `node dashboard/dev/check-ideas.mjs` saves and exports inside a throwaway folder only.

## Rules it follows

- A stage is shown as done only when a file proves it. Anything else is "Not recorded".
- Files show outputs, not whether an agent is running now. If ClaudeClaw's queue does not answer, the page says
  "Job status unavailable".
- A link proposed by ig-insights is offered, never applied. A proposed Instagram post is not "published".
- A video project with no linked script is listed separately until you link or hide it.
- Scripts never approved after 14 days, and batches never exported, are shown under All, not Needs me.
- Working drafts in `reels-data/outputs/<batch>/reel-NN-*.md` are read as drafts, never as exported scripts. While
  their `Publication status` is PENDING REVIEW the item reads "Drafts awaiting review" under Needs me, for 14 days.
  Drafts cannot be approved; choosing Version A or B starts once the review exports to `instagram_scripts_output/`.
- A source file moved to `Instagram_transcript/processed/`, or a batch with no export, is never described as
  abandoned. The page says what the files show and that they cannot show why.

### Navigation

- The view a project was opened from stays marked in the navigation. Back returns to the same filter, scroll
  position and row, on Needs me, Pipeline, Schedule and Research alike.
- A project whose source came from a saved research idea links back to that idea; the idea and the Ideas list show
  its Pipeline status and link forward to the project.
- On a phone every control is at least 44px tall and the four views sit on one row.

Browser checks (headless): `node dashboard/dev/check-nav.mjs` runs the above in a throwaway folder;
`node dashboard/dev/shots.mjs <label>` photographs every view on the real data without sending an action.

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
