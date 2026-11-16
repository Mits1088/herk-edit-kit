# Content dashboard: investigation, design and plan

Written 2026-11-16 in answer to `docs/plans/2026-11-16-content-dashboard-brief.md`. Planning only; nothing in the
workflow was changed. Revised the same day after review: sections 3, 4 and 6 to 9. Clickable prototype: `docs/plans/content-dashboard/prototype.html`
(published privately at https://claude.ai/artifact/JeZswBeSbQdMVKZrRJbVpS).

## 1. What the investigation found

### Confirmed from the brief's section 3

| Area | Evidence |
| --- | --- |
| Transcripts and batches | `Instagram_transcript/`, `reels-data/inputs/<batch>/`, `.claude/skills/rewrite-reels/SKILL.md` |
| Version A/B, captions, review status | `instagram_scripts_output/<batch>/NN-<title>.txt`, `combined.txt` |
| Script approval | `instagram_scripts_output/approved/<batch>/<file>-version-<a\|b>.txt`, sections `SCRIPT`, `INSTAGRAM CAPTION`, `TIKTOK CAPTION`, `YOUTUBE SHORTS`, `CTA` |
| PDF and Gumroad | `approve-reel/guide_to_pdf.mjs`, `gumroad_upload.mjs`, `reels-data/gumroad.json`, `reels-data/resources.md` |
| Hook gate and final approval | `create-reel/scripts/preflight-reel.mjs`, `render-reel.mjs`, `qa-reel.mjs`, `approve-reel.mjs` |
| Uploads | `D:\Uploads`: 5 MP4s at the root, 14 in `All social media`, nothing else |

### Corrections and additions

1. **All video state is already in `reel.json`.** Each project's `reel.json` holds `preflight` (status, approver,
   time, fingerprint), `renders[]` (file, kind, version, SHA-256, source hash, time) and `approvals[]` (candidate,
   status, approver, time, SHA-256). The dashboard can read hook, draft, candidate and final state from this one
   file with no new tracking.
2. **`ig-insights` is not in the repo.** It lives in `C:\Users\no_1_\.claude\skills\ig-insights\` and collects
   through `D:\meta-ig-connector`. It is read-only. Its `link.py` only *proposes* a link between a post and a
   project; a link is confirmed only when you say so. So it cannot confirm publication on its own, but your
   "Mark as published" click can be the confirmation it needs.
3. **Every resource is still `draft`.** All 13 lines in `resources.md` are `draft` with delivery `to confirm`,
   including reels already published. The new rule "a keyword reel cannot be posted until its resource is live"
   would have blocked every one of them. See decision 2.
4. **Used footage moves.** `raw-media/Processed/` holds footage from finished reels; the current reel's file sits
   in the `raw-media/` root. Footage filenames are HeyGen export names and do not match slugs.
5. **Google Drive for desktop is not installed** on this PC (only OneDrive is present). No Drive code exists in
   the repo.
6. **Zernio is not installed anywhere I could find** (repo, PATH, app folders, Downloads). It is a hosted
   service, so there may be nothing to install. See section 5.
7. **ClaudeClaw has a usable job queue.** `node D:/claudeclaw-os/dist/mission-cli.js` supports `create`,
   `list --status`, `result <id>` and `cancel`. That gives the dashboard both "rewriting in progress" status and
   a way to start agent work. Missions purge after 7 days, so it is a queue, not a record.
8. **Uploads appears to be two piles:** root files look like "not yet on every platform" and `All social media`
   like "posted everywhere". This is my reading of the dates, not something recorded. See decision 4.

### What is missing

- One ID per piece of content, and the links between its transcript, approved script, keyword, video project,
  footage file, Uploads file and Instagram post.
- Any record of voiceover, HeyGen, Google Drive, YouTube Shorts or TikTok.
- A PDF approval step before Gumroad.
- Any way to act without typing a command to an agent.

## 2. Data model

**One manifest per piece of content**, in `reels-data/content/<content-id>.json`. The ID is the batch and reel
number, for example `2026-11-12-002-01`, because that exists from the first moment and never changes.

```json
{
  "id": "2026-11-12-002-01",
  "title": "Four privacy switches",
  "format": "reel",
  "links": {
    "source": "reels-data/inputs/batch-2026-11-12-002/reel-01.md",
    "generated": "instagram_scripts_output/batch-2026-11-12-002/01-....txt",
    "approved": "instagram_scripts_output/approved/batch-2026-11-12-002/01-...-version-a.txt",
    "keyword": null,
    "project": "video-projects/privacy-four-changes",
    "voiceover": null,
    "footage": "raw-media/Processed/4 Settings to Keep Your AI Chats Private_1080p.mp4",
    "uploadsFile": null,
    "igMediaId": null
  },
  "linkStatus": { "project": "confirmed", "footage": "needs-linking" },
  "resource": { "approvedSha": null, "approvedAt": null },
  "publishing": {
    "handoff": { "state": "none", "at": null },
    "instagram": { "status": "ready", "publishedAt": null, "url": null },
    "youtube":   { "status": "not-yet", "publishedAt": null, "url": null },
    "tiktok":    { "status": "not-yet", "publishedAt": null, "url": null }
  },
  "feedback": []
}
```

Rules:

- **Derive, do not duplicate.** Script, review, hook, render, QA and final status are read live from the files
  the workflow already writes (`approved/`, `reel.json`, `.qa/qa.json`, `resources.md`, `links.json`). The
  manifest stores only links and the things nothing else records: manual tasks, handoff, publishing, feedback.
- **`format`** is `reel` today. A later `longform` value gets its own stage list; nothing else changes.
- **Links carry a status**: `confirmed` or `needs-linking`. Only `links.json` entries with `status: confirmed`
  and the `reel` block of a `.pdf.json` count as confirmed without you.
- **Approvals bind to a hash.** Hook: existing fingerprint. Candidate: existing SHA-256. PDF: new, SHA-256 of
  the PDF, stored in the manifest. A different hash means "awaiting approval" again.
- **Feedback** entries hold the asset type, the exact version, your text, the time and whether a revision has
  been started.
- **Restarts.** Everything is files, written atomically (temp file then rename), with an append-only
  `reels-data/content/history.jsonl` of every action. No database.
- **Privacy.** `reels-data/`, `instagram_scripts_output/` and `raw-media/` are gitignored (`.gitignore` lines
  9, 59, 60), so manifests stay out of the public fork. `docs/plans/` is not ignored.

## 3. Architecture

| Part | Recommendation | Why |
| --- | --- | --- |
| Location | New top-level `dashboard/` folder | Isolated from skills and scripts; removable |
| Server | One small Node 22 script using built-in `node:http` | No new dependencies; the repo already requires Node 22 |
| Frontend | Plain HTML, CSS and JavaScript, as in the prototype | No build step; nothing to install or keep updated |
| State | Read on request from the files above; a file watcher refreshes open pages | Always reflects the real workflow |
| Video and PDF | Served by the local server with HTTP Range support | Needed to scrub MP4s; nothing leaves the PC |
| Schedule | Calculated on each page load from the confirmed Instagram time | No scheduler to run or break |

**How a button triggers work.** Two kinds of action:

- *Deterministic scripts*, run directly by the server: `preflight-reel --approve`, `approve-reel --candidate
  --sha`, `guide_to_pdf.mjs`, `gumroad_upload.mjs`, `render-reel`, `qa-reel`. The server passes the hash you
  were looking at, so an approval can never land on a newer file.
- *Agent work* (choosing a script through `/approve-reel`, building or revising a PDF, `/create-reel`, video
  revisions): the server never runs an agent itself. It hands the work to one of two runners, below.

**ClaudeClaw assessment.** Checked on 2026-11-16:

| Question | Finding |
| --- | --- |
| Can work be queued? | Yes. `mission-cli.js create --agent <id> --title ...`, and `POST /api/mission/tasks` on its dashboard server |
| Can status be read? | Yes. `mission-cli.js list --status`, `result <id>`, and `GET /api/mission/tasks` |
| Can it be cancelled? | Yes, while queued |
| Is the right agent there? | `instagram-script-writer` and `main` exist in `~/.claudeclaw/agents` |
| Is it always available? | No. Nothing answered on its default port 3141 when I checked, and the queue was empty. The dashboard must show "queue not running" and fall back |
| Limits | `rewrite-reels` notes a mission stops after 30 tool rounds. Results purge after 7 days, so the manifest keeps the record |

Fit by kind of work:

- **Good fit:** rewrite status, script approval, PDF build and PDF revision. These are short, text-only and
  already run this way for rewriting. The dashboard queues the mission and shows queued, running, done or failed.
- **Poor fit:** building or revising a reel. It is far longer than 30 tool rounds, needs HyperFrames Studio open
  and stops for you at Gate B. For these the dashboard gives the exact command to run in Claude Code and then
  tracks progress from `reel.json`. Whether the round limit can be raised is not verified.
- **Fallback:** whenever ClaudeClaw is not running, every agent action shows its copyable command instead.

**Failures.** Every script action records its command, exit code and last lines of output in `history.jsonl`.
A failed action shows as Failed with a Retry button; retries are refused while the same action is running.
Uploads are idempotent already (`gumroad_upload.mjs` skips a file that is there).

**Phone access and the Drive handoff.** Three options, simplest first:

1. **Open the dashboard on your phone over home Wi-Fi** (recommended). The Publish page has a Download video
   button and Copy caption buttons. This removes both Google Drive and WhatsApp from the routine. Access needs a
   long random token in the link; the server refuses everything else.
2. **Drive for desktop sync folder.** Install Google Drive for desktop and copy `final.mp4` plus a `caption.txt`
   into a synced folder. States: "Copied to sync folder", then "Unverified", because a local copy cannot prove
   the upload finished.
3. **Drive API.** The only option that can show "Confirmed available in Drive". Needs a Google Cloud project and
   OAuth. I would only build this if options 1 and 2 are not enough.

**Credentials.** The server holds no publishing credentials in phases 1 to 4. The Gumroad CLI keeps its own
login. Any later Zernio key lives in a gitignored `.env`, is read only by the server, and is never sent to the
browser.

**ClaudeClaw.** Do not build inside its dashboard: it is a separate product that updates on its own schedule.
Use its mission queue as an optional job runner only.

## 4. Workflow rules the dashboard enforces

- The opening preview may be built before Gate B. Everything after waits for approval of the current
  fingerprint (already enforced by `render-reel`).
- A candidate is approved only after QA, by SHA; that file becomes `final.mp4` (already enforced).
- A PDF is uploaded only when its SHA matches your approval (new).
- "Request changes" stores feedback only. "Start revision" is a second, separate action.
- A new keyword reel is "ready to post" only when its resource is live.
- Shorts and TikTok fall due on the second calendar day after the Instagram time you confirm, at a fixed time
  and timezone. They are tracked separately.
- No guessed links; uncertain matches appear under "Needs linking".

## 5. Zernio

Verified from Zernio's own published API summary and pricing page on 2026-11-16. Not tested with an account.

| Question | Finding |
| --- | --- |
| Integration | REST API at `https://zernio.com/api/v1`, bearer API key. Also a hosted MCP server and an open-source Claude Code plugin. No CLI or SDK mentioned |
| TikTok video | Supported |
| YouTube video | Supported. Shorts are not named; YouTube itself classes short vertical videos as Shorts, which needs a test |
| Caption per platform | Yes, `customContent` on each platform entry of one post |
| Schedule for a time | Yes, `scheduledFor` with a `timezone` |
| Upload a local file | Yes, a presigned upload, up to 5 GB |
| Status and errors | Per-platform `status` on `GET /v1/posts/{id}`; `POST /v1/posts/{id}/retry`. No post-status webhook documented, so the dashboard would poll |
| Cost | First 2 connected accounts free, unlimited posts. One YouTube channel plus one TikTok account is exactly 2 |

Limits to know before deciding:

- Your video is uploaded to Zernio's storage, a third party.
- New TikTok connections can post videos as public only. Other audiences go to TikTok as a draft you finish in
  the app, which may suit you as a half-automated step.
- TikTok requires comment, duet and stitch settings on every post.
- The Instagram comment-keyword delivery does not carry over; that is already marked `to confirm`.

**Proposed fit:** when you confirm Instagram, the dashboard offers "Schedule Shorts and TikTok for <date>". You
press it; nothing is scheduled automatically. The post ID is stored in the manifest and the two platform
statuses update from polling. Manual posting keeps working unchanged.

## 6. What each phase reads, creates and changes

"Changes no existing file" in the first version of this plan was too loose. This table is the precise version.
"Creates" means new files only the dashboard owns. "Updates" means files or services the workflow already owns.

| Phase | Reads | Creates | Updates existing records |
| --- | --- | --- | --- |
| 1. Foundation | `reels-data/inputs/`, `instagram_scripts_output/`, `approved/`, `resources.md`, `resource-sources/`, `video-projects/*/reel.json` and `.qa/qa.json`, `links.json`, ClaudeClaw mission list, file listings of `raw-media/` and `D:\Uploads` | `dashboard/`; `reels-data/content/<id>.json`; `reels-data/content/history.jsonl` | None |
| 2. Script approval and PDF gate | As phase 1, plus the PDF file to hash it | PDF approval and feedback entries in the manifest; ClaudeClaw missions | `approved/<batch>/` (new approved file, via `/approve-reel`); `resource-sources/`, `resources/` and `resources.md` (via `/approve-reel`); the Gumroad product, `gumroad-uploads.md`, `gumroad-backups/` (via `gumroad_upload.mjs`, only after approval); **`approve-reel/SKILL.md` step 9 and its `.agents` copy** |
| 3. Publishing | Approved file sections, `final.mp4` | Publishing and handoff fields in the manifest | `links.json` and `links-history.jsonl`, through `link.py confirm`, only when you confirm a specific post; one `resources.md` line when you mark a resource `live` |
| 4. Hook and reel approvals | `reel.json`, `.qa/` sheets, Studio preview | Feedback entries in the manifest | `reel.json` (`preflight`, `approvals`), the project's `QA.md`, `renders/final.mp4` and the archived previous final, all through the existing `preflight-reel` and `approve-reel` scripts |
| 5. Zernio (optional) | Manifest, `final.mp4` | Zernio post IDs in the manifest | Your YouTube and TikTok accounts, through Zernio, on your click only |

Nothing in any phase writes to `raw-media/`, `D:\Uploads` or `Instagram_transcript/`.

## 7. Phases, in the revised order

The next approval is for this revised design, not for a build phase.

| Phase | What is built | Reuses | Test | Risk |
| --- | --- | --- | --- | --- |
| 1. Foundation | Local server; Needs me, stage-track Pipeline, Schedule and project page showing every stage; manifests; backfill of existing projects; voiceover and avatar tasks with an explicit "link this file" action and a manual tick | `reel.json`, `approved/`, `resources.md`, `links.json` | State-reader tests against copies of 3 real projects; you check the board against what you know | Older projects have gaps. They show "Unknown" or "Needs linking", never a guessed completion |
| 2. Script approval and PDF gate | A/B comparison and approve; PDF preview, approve by hash, then upload; feedback and "Start revision"; ClaudeClaw mission status | `/approve-reel`, `guide_to_pdf.mjs`, `gumroad_upload.mjs`, ClaudeClaw mission queue | Dry-run upload; a rebuilt or unapproved PDF is refused; one real mission end to end | Withdraws your standing auto-upload authorisation. Built together so no route to Gumroad skips review |
| 3. Publishing | Captions with Copy; phone page with video download; Instagram confirmation; due dates; separate Shorts and TikTok confirmation; resource `live` check | Approved file sections; `link.py confirm` | Parser tests on every approved file; date tests across midnight and the clock change; one real post | Older approved files have a different layout |
| 4. Hook and reel approvals | Play hook and candidate; approve by fingerprint or SHA; QA results; feedback and revision loop | `preflight-reel`, `approve-reel`, `.qa` sheets | Scratch project from `npm run test:reel-smoke`; a stale hash is refused | Video revisions run in Claude Code, not ClaudeClaw (see section 3) |
| 5. Zernio | Optional later investigation with a real account | Manifest, schedule | One private or draft test post per platform | Published capabilities and pricing are not account-tested |

## 8. Decisions

### Adopted in this revision

| Topic | Decision |
| --- | --- |
| Two-day delay | Second calendar day after the confirmed Instagram post, at a fixed due time in a fixed timezone. The prototype uses 09:00 Europe/London |
| Resource readiness | New keyword reels are blocked from "ready to post" until the resource is `live`. The 13 existing `draft` lines are a reconciliation task, shown as "Unknown: confirm", not a reason to relax the rule |
| Phone handoff | Dashboard on your phone over home Wi-Fi first. It needs the PC on and the server running |
| `D:\Uploads` | Left untouched. Shown as a file listing only. Folder placement is never read as "published" |
| Voiceover and avatar | Tracked from phase 1, with each file linked to its project by an explicit action. No folder is moved or renamed |
| Backfill | Existing projects are included. Anything not recorded shows as "Unknown" or "Needs linking" |
| PDF gate | Built with script approval, in phase 2 |
| Zernio | Optional, last, investigation only |
| Agent actions | ClaudeClaw missions for script and PDF work; a copyable Claude Code command for video work and as the fallback whenever ClaudeClaw is not running |

### Still needed from you

1. **Due time and timezone.** Is 09:00 UK time right, or another time?
2. **Withdraw the automatic Gumroad upload.** Confirm, because it changes a standing instruction of yours.
3. **What `D:\Uploads` means.** What do the root and `All social media` each hold?
4. **The 13 draft resources.** Which keywords can viewers actually receive today?
5. **PC on for phone access.** Is that acceptable, or do you need the video reachable when the PC is off?

## 9. Evidence for this revision

- **Rendered and inspected.** The prototype was rendered headlessly in Edge at 1280 px and 390 px, light and
  dark, 41 screenshots: Needs me, Pipeline (tracks and board), Schedule, and 13 walkthrough steps across all
  five project tabs. No console errors and no horizontal overflow in any of them. I looked at the Pipeline,
  Needs me, the PDF review step, the failed-QA step and the phone Instagram step. One wording fault found and
  fixed ("due 49 h ago" now reads "overdue by 2 d 1 h"). Real video and PDF playback is not exercised: the
  prototype has placeholders.
- **Walkthrough.** The Walkthrough view takes one sample reel through 16 steps: rewriting, script choice, PDF
  built in parallel with the voiceover task, a requested PDF change and its re-approval, voiceover, avatar,
  hook approval, a failed QA and retry, final approval, Instagram blocked by the resource, Instagram posted,
  waiting for the date, both platforms due, YouTube published while TikTok is still due, and complete. Each
  step states what you see, what you click, and what is on your Needs me list.
- **Controls checked (version 3).** A headless run drove the prototype's real buttons, not the walkthrough's
  Next step, and all 15 checks passed: request changes records feedback only; a revised and a rebuilt PDF each
  need a new approval; a failed-QA candidate has no approve button and sits at QA; a resource-blocked reel
  cannot be marked published; sending to the phone folder does not publish; Instagram leaves Shorts and TikTok
  unpublished; Shorts leaves TikTok unpublished. This proves the prototype's page logic only. The production
  rules are enforced by the existing scripts and need their own tests in each phase.
- **Version 3 changes.** Stages now run Source, Rewrite, Script, Voice, Avatar, Hook, Build, Render, QA,
  Approve candidate, Instagram, Shorts, TikTok, with a "Final ready" marker. Each stage carries a symbol as
  well as a colour, with a key; "Not required" is drawn differently from "Not started". Needs me uses named
  actions. "PDF uploaded, not live" opens a list of what remains.
- **Overview.** The Pipeline now defaults to stage tracks: one row per project with all ten stages, the current
  one highlighted by who it is waiting on, the next action in words, the PDF on its own line, and one chip per
  platform. The board remains as a second view.

## 10. Build status

- **Phase 1, built 2026-11-16.** `dashboard/`, `tests/dashboard.test.mjs`. Reads workflow files; writes only
  `reels-data/content/`.
- **Phase 2, built 2026-11-16.** Script choice, PDF gate, feedback and revision, job hand-off. Changed
  `approve-reel/gumroad_upload.mjs` (refuses a PDF without a matching approval) and step 9 of
  `approve-reel/SKILL.md`, in both `.claude/skills` and `.agents/skills`.
- **Phase 3, built 2026-11-16.** Instagram confirmation (through `link.py confirm`, or a manual record when
  ig-insights has not collected the post), separate Shorts and TikTok records, the `done` stage, "mark keyword
  live" (one line of `resources.md`), schedule buckets, and opt-in phone access (`DASH_LAN=1`, token, download).
  New file `dashboard/lib/workflow.mjs` holds the two workflow writes.
- **Not yet exercised for real:** an actual Gumroad upload from the dashboard, a ClaudeClaw job (ClaudeClaw
  was not running), a real `link.py confirm`, a real change to `resources.md`, and a real phone. All are covered
  by tests with stand-in scripts or fixture files only; phone access was checked from this PC through its own
  home-network address in headless Edge.
- **Answers received 2026-11-16, after phase 3.** Due time stays provisional. The Uploads root means "live on
  Instagram, not yet on Shorts or TikTok"; `All social media` means "on every platform". This replaces the
  earlier decision that folder placement is never read as published: a linked file's position is now read
  that way (see `dashboard/README.md`). Every keyword delivers the same Gumroad skills pack, so a resource
  being available early is not a problem for him.
- **Done on his yes, 2026-11-16.** All 20 Uploads files linked; the five proposed ig-insights posts confirmed
  (first real `link.py confirm` runs); all 13 keywords marked live (first real `resources.md` change).
- **Phase 4, built 2026-11-16.** Hook and candidate approvals on the Video tab, through `preflight-reel.mjs
  --approve` and `approve-reel.mjs`, each verified by re-reading the saved record; feedback and a separate
  "Start revision" for both, with a Claude Code command instead of a queued job. Tested with the real scripts
  on a scratch project (synthetic video bytes, QA record built with the real `evaluate()`), and by clicking the
  real buttons in headless Edge against scratch data. Not run on a real reel: none is waiting (the two
  "candidate" projects are unlinked October experiments, caveman-v4 and mythos-glasswing; the "hook" project,
  reverse-engineer-feature, has no plan). `npm run test:reel-smoke` (real render and QA) was not run.
- **End to end on synthetic data, 2026-11-16.** `node dashboard/dev/e2e-reel.mjs` passed: render refused before
  the hook is approved, hook approved over the dashboard's HTTP route, real draft render, real final render
  with full QA (VERIFIED, 42 checks), candidate approved over HTTP, `final.mp4` byte-identical to the candidate.
  Hook approval now also needs an "I have watched this opening" tick and is refused when the plan was edited
  after the preview was recorded. The "Preview available" branch (Studio running) has not been seen rendered.
- **Done later on 2026-11-16, on ChatGPT's recommendation relayed by him** (he asked my view; I took it as go and
  said so). (a) `scripts/smoke-reel.mjs` records the opening before approving; `npm run test:reel-smoke` now
  passes, 18 steps. (b) PDF approval and upload are separate buttons; older guides can be approved by hash.
  (c) `preflight-reel.mjs --record-opening` saves `planFingerprint` in `openingPreview` (edited in both
  `.claude/skills` and `.agents/skills`, by hand, copies identical); the dashboard refuses a hook approval
  when that is not the current plan. The script's own `--approve` is unchanged and does not check it.
- **Waiting on him:** which script and version to approve as the first real run of the fallback path.
- **Still to verify for real (agreed with him):** one Gumroad run from the dashboard, with his explicit yes;
  one ClaudeClaw job; one real script approval, which is his A or B decision.
- **Next:** that integration check, then optional Zernio. Each needs his go-ahead.

## 11. Picking this up in a new session

Read this file, `dashboard/README.md`, then `dashboard/lib/state.mjs` (how every stage is derived) and
`dashboard/server.mjs` (`handleAction` is where page actions become records, uploads and jobs).

**How to check work**

- `node --test tests/dashboard.test.mjs` (26 tests; fixtures only, never real projects). `npm test` runs all 128.
- `node dashboard/dev/check-live.mjs` starts the real server on port 4399, renders it in headless Edge at desktop
  and phone width, checks console errors, overflow, video loading and the file-route guards, and sends no actions.
  Screenshots land in the system temp folder under `content-dashboard-check`; look at them, do not rely on the
  pass lines alone. The repo's Playwright has no bundled browser, so it uses installed Edge (`channel: 'msedge'`).
- Never press approve, upload or queue buttons against real data without Mits asking: they upload to Gumroad or
  start agent jobs.

**Phase 3 (publishing): built.** The list below is what was asked for; see section 10 and `dashboard/README.md`
for what exists. Two choices made while building, for him to confirm: Instagram posts from before 2026-11-16
show Shorts and TikTok as "Not recorded" with no task (`DASH_TRACK_FROM`), and the phone may only record
publication, copy and download.

1. "Mark as published to Instagram" with time and URL, reconciled with ig-insights through
   `python -I -X utf8 C:/Users/no_1_/.claude/skills/ig-insights/scripts/link.py confirm <key> --project <slug>`,
   so `links.json` stays the single record. A proposed link is confirmed only on his click.
2. Separate YouTube Shorts and TikTok records in the manifest (`publishing.youtube`, `publishing.tiktok`):
   waiting, due, published, each with its own time and URL. One never marks the other. Add the `done` stage.
3. "Mark keyword set up and live": changes that keyword's line in `reels-data/resources.md` from `draft` to
   `live`. This is the first dashboard write to a workflow file other than the Gumroad gate; test it with the
   file-hash approach and change only that one line.
4. Phone access over home Wi-Fi: the server binds to `127.0.0.1` and rejects other hosts today. Needs a LAN bind
   option, a long random token, a download button for `final.mp4`, and the same Copy buttons.
5. Schedule view: move "Published on Instagram" rows into due today, overdue and upcoming once Shorts and TikTok
   are recorded.

**Blocking questions for phase 3**

- Due hour and timezone (placeholder 09:00 Europe/London; set `DASH_DUE_CONFIRMED=1` once he confirms).
- Whether needing the PC on for phone access is acceptable. Built that way, off by default.
- Which of the 13 draft resources viewers can actually receive (for the backlog of `draft` lines).
- Answered: `D:\Uploads` root is Instagram only, `All social media` is every platform. Read only for linked files.

**Known loose ends**

- No real Gumroad upload and no real ClaudeClaw job has been run from the dashboard; the first real use is the
  test. Six PDFs (FOLDER, ARENA, DESIGN, TOKENS, FOUNDER, SHEETS) show "awaiting approval" though all 13 were
  uploaded on 2026-11-13; approving should make the script skip them as already there.
- The inline PDF preview has not been seen drawing (headless Edge shows an empty frame).
- Five scripts have a video project that ig-insights only proposed; he confirms each on its Video tab.
- `npm run check:skills` reported four other skills out of sync before this work began (reel-review,
  reel-workflow x2, rewrite-reels). They are his in-progress edits; do not run `npm run sync:skills` to "fix" them.
- Nothing is committed. `docs/plans/` describes his private workflow; the fork is public.
- Phase 4 (hook and reel approvals from the page) and optional Zernio follow phase 3; each needs his go-ahead.

## Sources

- https://zernio.com/llms.txt
- https://zernio.com/pricing.md
