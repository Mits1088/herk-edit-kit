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
