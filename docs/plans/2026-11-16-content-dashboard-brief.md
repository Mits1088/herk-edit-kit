# Project brief: content production, approval and publishing dashboard

Repository: `D:\herk-edit-kit`. Written 2026-11-16. Facts under "How the system works today" were checked
against the repo on that date; re-check anything you rely on.

## 1. What I want

One visual, interactive dashboard that shows every piece of content from source transcript to published on
Instagram, YouTube Shorts and TikTok. I want to open it and see:

- every content project and where it is;
- what the automated system is doing;
- everything that is waiting on me, in one place;
- the scripts, PDF, hook preview and finished video for each project, with the action I need to take;
- the finished video and the right caption for each platform, with a copy button;
- what is due to be published where, and when.

It must reflect real workflow state read from the files the workflow already writes. I do not want a separate
tracker that I have to keep up to date by hand.

**This first task is investigation, design and mock-ups only. See section 9.**

## 2. Platforms

- **Short-form (priority).** One video, made for Instagram Reels, published to Instagram first, then to YouTube
  Shorts and TikTok about two days later. Same video, different caption per platform. Model this as one project
  with three independent publishing tasks, not three projects.
- **YouTube long-form (future).** The data model should allow a second content format later without redesigning
  the Reel pipeline. Do not build it now.

## 3. How the system works today

Use this as the starting map. Reuse these mechanisms; do not rebuild them.

### 3.1 Research and source transcripts

- I drop transcripts of high-performing Reels in `Instagram_transcript/`. `/rewrite-reels` batches them into
  `reels-data/inputs/<batch-id>/` and moves the originals to `Instagram_transcript/processed/<batch-id>/`.
- Batch IDs look like `batch-2026-11-15-003`. A batch holds one or more numbered Reels.
- Transcript files can carry a `Duration:` line, a `Stats:` line and an Instagram URL.

### 3.2 Rewriting and review

- `/rewrite-reels` (skills `rewrite-reels`, `reel-workflow`, `reel-review`; agents `reel-rewriter`,
  `reel-reviewer`) writes Version A and Version B of each Reel, plus one Instagram, one TikTok and one YouTube
  Shorts caption shared by both versions.
- Output: `instagram_scripts_output/<batch-id>/NN-<title>.txt` and `combined.txt`.
- An independent review pass gives each Reel a status: `READY TO RECORD` or `REVIEW REQUIRED`.
- It can also run as queued missions through ClaudeClaw (`D:\claudeclaw-os`, outside this repo). Investigate
  whether mission status there is readable, so the dashboard can show "rewriting in progress".

### 3.3 Script approval

- `/approve-reel` (for example "approve reel 2 version A") saves the chosen script to
  `instagram_scripts_output/approved/<batch-id>/<reel-file-name>-version-<a|b>.txt`.
- That one file holds everything for publishing, in sections named exactly `SCRIPT`, `INSTAGRAM CAPTION`,
  `TIKTOK CAPTION`, `YOUTUBE SHORTS` and `CTA`. **There are no separate per-platform TXT files, and captions are
  written at this stage, not at the end of production.**
- A `REVIEW REQUIRED` Reel is not approved unless I say so.

### 3.4 PDF resource and Gumroad

- Only Reels whose CTA is "Comment KEYWORD" get a resource. `reels-data/resources.md` lists keywords and whether
  each is `draft` or `live`.
- Source: `reels-data/resource-sources/<keyword>.md` and `<keyword>.pdf.json`. Built by
  `.claude/skills/approve-reel/guide_to_pdf.mjs` into `instagram_scripts_output/resources/`, with a cover preview
  in `resources/previews/`.
- **Today the upload is automatic.** Step 9 of `/approve-reel` runs `gumroad_upload.mjs` as soon as the PDF
  passes its checks, for Claude-related resources only, into one existing product (`reels-data/gumroad.json`).
  It logs to `reels-data/gumroad-uploads.md`. The script only adds files; it never replaces or deletes one, so a
  rebuilt PDF with the same name has to be swapped by hand in Gumroad.

### 3.5 Voiceover and avatar (manual, untracked)

- I record the voiceover by hand in Audacity, then make the avatar video by hand in HeyGen, download it, and put
  it in the root of `raw-media/`. That root file is the footage for the Reel.
- **Nothing in the repo tracks either step, and there is no agreed place for the audio file.**

### 3.6 Reel creation (`/create-reel`, "Reel Studio")

HyperFrames is the HTML-to-video rendering framework the whole kit uses. It is not a hook feature.

- `npm run new-reel` creates `video-projects/<slug>/` with `reel.json`.
- **Gate B, the hook preview.** The first ~5 seconds are built at final quality and played in HyperFrames Studio.
  Recorded with `npm run preflight-reel -- <project> --record-opening`, approved with `--approve --fingerprint`.
  Nothing else is built or rendered until this is approved. A change to the plan or script invalidates it.
- Drafts: `renders/<slug>-draft-vNNN.mp4`, each with a `.qa` folder of review sheets.
- **Candidate and final.** `npm run render-reel -- <project> --final` renders
  `renders/<slug>-candidate-vNNN.mp4` and runs full QA on it. Only then do I watch it. I approve that exact file
  with `npm run approve-reel -- <project> --candidate <file> --sha <12 hex>`, which re-hashes it, refuses anything
  QA did not verify, and copies it to `renders/final.mp4`.
- So the real order is: hook approval, build, drafts, candidate render, full QA, **my approval of the candidate**,
  final. Approvals are already tied to the asset version by fingerprint and SHA-256.
- Per-project evidence: `QA.md`, `ENTERTAINMENT-REVIEW.md`, `RETROSPECTIVE.md`.

### 3.7 Publishing (manual)

- I copy the final video to `D:\Uploads`, which is outside the repo. It is flat: a few MP4s at the root and an
  `All social media` subfolder of MP4s. No captions, no per-project folders, and filenames are free text that
  does not match project slugs (`founder-100-buyers` is `100 simulated buyer.mp4`).
- Instagram: I upload the video to Google Drive, download it on my phone, send myself the caption over WhatsApp,
  and post by hand.
- YouTube Shorts and TikTok: by hand, about two days later.
- **Instagram publication is already recorded.** `/ig-insights` writes `reels-data/insights/links.json`, with
  each Reel's `permalink`, `published_at`, project slug, render file and approved script file. Check how quickly
  a new post appears there and whether that can confirm publication without me clicking anything.
- There is no Google Drive code, no YouTube or TikTok record, and no Zernio code or configuration in the repo.

### 3.8 The main gap

There is no single ID for a piece of content. It is a batch and Reel number at the script stage, a keyword for
the PDF, a slug in `video-projects/`, a free-text filename in Uploads, and an Instagram media ID once posted.
Only `links.json` joins some of these, and only after publishing. The dashboard needs one manifest per content
project that links them from the start. Propose where it lives and which step creates it.

## 4. Pipeline the dashboard should show

Not strictly linear: the PDF runs alongside recording, and each platform has its own status.

| # | Stage | Who | State comes from |
| --- | --- | --- | --- |
| 1 | Source transcript added | Me | `Instagram_transcript/`, `reels-data/inputs/` |
| 2 | Rewriting and review | Automated | Batch output folder, review status |
| 3 | Choose Version A or B | **Me** | `approved/<batch-id>/` |
| 4 | PDF resource (optional) | Automated, then **me** | `resource-sources/`, `resources/`, `resources.md` |
| 5 | Record voiceover | **Me, manual** | New, see 5.3 |
| 6 | Create HeyGen avatar | **Me, manual** | New, see 5.3; footage in `raw-media/` |
| 7 | Hook preview (Gate B) | Automated, then **me** | Preflight record in the project |
| 8 | Build and drafts | Automated | `renders/*-draft-*` |
| 9 | Candidate render and QA | Automated | `renders/*-candidate-*`, `.qa` |
| 10 | Approve the candidate | **Me** | `renders/final.mp4`, approval record |
| 11 | Instagram | **Me, manual** | `links.json`, plus my confirmation |
| 12 | YouTube Shorts | Me, later maybe automated | New |
| 13 | TikTok | Me, later maybe automated | New |

## 5. What is new

### 5.1 Script comparison and approval in the dashboard

Show the source transcript, Version A and Version B side by side with the review status, and let me approve one.
Approval must go through the existing `/approve-reel` logic and write the same approved file. Recommend how a
dashboard button triggers that (it is an agent skill today, not a script).

### 5.2 PDF approval gate before Gumroad (changes current behaviour)

I want to see the PDF and approve it before it is uploaded. This replaces the automatic upload in step 9 of
`/approve-reel`, so it needs my sign-off as a change to that skill.

- Statuses: not required, generating, awaiting approval, changes requested, approved, uploading, uploaded,
  failed, and "not Claude-related, not uploaded".
- Approval is tied to the PDF's hash. A rebuilt PDF needs a new approval.
- **Never upload an unapproved PDF.**
- Say how "changes requested" works after an upload, given the script never replaces a file.
- **The resource blocks publishing.** A comment-keyword Reel does not become "ready to publish" until its
  approved resource is deliverable: uploaded where it applies, the keyword set up in the delivery tool, and its
  line in `resources.md` changed from `draft` to `live`. Recording and video production are not blocked by it.

### 5.3 Manual task tracking: voiceover and HeyGen

Track these; do not automate Audacity or HeyGen.

- "Record voiceover" shows the approved script (it is already one sentence per line for reading) and where to
  save the audio.
- "Create HeyGen avatar" shows the script, the audio file and where to put the finished video.
- Recommend a folder convention for the audio and the avatar video that fits `raw-media/` and `new-reel`, and
  whether the dashboard can detect the files appearing instead of asking me to tick a box.
- Reel creation must not start until the footage exists.

### 5.4 Hook and candidate review in the dashboard

- Play the Gate B opening preview and approve it or request changes, using the existing `preflight-reel`
  fingerprint approval. The preview itself is built before approval; everything after it waits.
- Play the QA-verified candidate and approve it or request changes, using the existing `approve-reel` SHA
  approval. Show the QA verdict and review sheets next to the player.
- **Keep the existing order: I approve the candidate after QA, and that file becomes final.** Do not add another
  render or a QA pass after my approval.
- Requesting changes sends the project back to the build stage and the next version number.

### 5.5 Requesting changes

This applies to scripts, PDFs, hooks and candidates. "Request changes" records my feedback against the exact
asset version; it does not start any work on its own. Starting the revision is a separate, visible step. In the
proposal, show the whole loop for each asset type: where the feedback is stored, what starts the revision (me, or
an agent I launch from the dashboard), how the new version appears for review, how a failed revision is retried,
and how I can see the history of versions and feedback.

### 5.6 Existing projects and linking

Filenames do not match across stages, so links between a transcript, an approved script, a PDF, a video project,
an Uploads file and an Instagram post must be explicit. Use links already recorded (`links.json`, the `reel`
block in a `.pdf.json`) as confirmed. Show any guessed match as "Needs linking" with the candidates, and let me
confirm or correct it. Never attach a script, PDF or video to a project on a filename guess.

### 5.7 Publishing

- **Captions.** Read the `INSTAGRAM CAPTION`, `TIKTOK CAPTION` and `YOUTUBE SHORTS` sections from the approved
  file and give each a Copy button. YouTube Shorts has a title, description and tags; copy them separately. Do
  not generate new captions.
- **Uploads folder.** Recommend one of: move it into the repo (gitignored), keep it outside and reference it
  through a configurable path, or give each project a publishing folder with the final video and captions.
  Do not move, rename or delete anything in `D:\Uploads` without my permission.
- **Google Drive handoff.** Investigate the simplest way to get `final.mp4` into a Drive folder I can open on my
  phone (for example the Drive desktop app syncing a local folder, before any API work). A file in a local sync
  folder is not proof it reached Drive, so use separate states: "Copied to sync folder", "Confirmed available in
  Drive", and "Unverified" when confirmation is not possible. Reaching Drive is not publishing.
- **Caption on my phone.** Replace the WhatsApp step. Options to assess: a phone-friendly dashboard page on my
  home network, or a caption text file placed beside the video in Drive.
- **Instagram stays manual.** Let me mark it published with the date, time and post URL, and reconcile that with
  `links.json` so there is one record, not two.
- **YouTube Shorts and TikTok.** Due two days after the confirmed Instagram publication time, never after render
  time. Each has its own status: waiting, due, in progress, published, failed. Each has its own post URL.
  Recommend whether "two days" means exactly 48 hours or two calendar days, and ask me.
- Comment-keyword delivery on YouTube and TikTok is marked `to confirm` in the approved files. Surface it as an
  open item per project.

### 5.8 Zernio (future, investigate only)

I want to explore Zernio for posting to YouTube Shorts and TikTok. It is not in the repo and I have not told you
where it is installed; ask me. Verify from its own documentation, not from its name:

1. whether it has an API, CLI, SDK or MCP server;
2. whether it can publish or schedule YouTube Shorts and TikTok videos with a caption per platform;
3. whether a post can be scheduled for a specific time, and status and errors read back;
4. accounts, authentication, pricing and limits.

Then propose how it would slot in after Instagram is confirmed. Do not connect it, post with it, or add any paid
service without my approval. The dashboard must work fully with manual publishing.

## 6. Dashboard views

1. **Pipeline board.** Project cards by stage, showing progress, what is running, what is blocked or failed, and
   a status chip per platform. Recommend Kanban, a stage timeline or another layout.
2. **Needs my attention.** The most important view. Every item waiting on me, grouped into production (choose a
   script, review a PDF, record, make the avatar, approve a hook, approve a candidate, fix a failure) and
   publishing (post to Instagram, confirm it, post to Shorts, post to TikTok). Each item opens the project at
   that step.
3. **Project workspace.** Tabs or sections for scripts, resource, manual production, video and publishing. Do not
   show every technical detail at once.
4. **Publishing schedule.** What is ready for Instagram, what is due today on Shorts and TikTok, what is overdue,
   and what is fully distributed. Dates come from confirmed events only.

## 7. Safeguards

- No Gumroad upload before PDF approval.
- The opening preview may be built before Gate B approval. Building the rest of the video requires approval of
  the current opening fingerprint.
- No `final.mp4` before my approval of the QA-verified candidate.
- A comment-keyword Reel is not ready to publish until its resource is `live`.
- No guessed links between assets; uncertain matches show as "Needs linking".
- An approval never carries over to a regenerated asset.
- Never assume the voiceover or avatar is done.
- Reaching Google Drive does not mean published on Instagram.
- The two-day countdown starts only at confirmed Instagram publication.
- One platform being published never marks another as published.
- No automatic posting through an unverified integration.
- No duplicate uploads or repeated jobs.
- The repo is a public fork. Keep private content (scripts, footage, renders) and credentials out of Git and
  out of public access. The dashboard may display project assets through controlled local access; credentials
  must never reach the frontend. Never print secrets.

## 8. What to deliver

1. **Evidence-based analysis** of the current system, confirming or correcting section 3, with file paths.
2. **Proposed data model**: the per-project manifest, where state is derived from existing files and where new
   state is stored, and how it survives restarts.
3. **Architecture recommendation**: frontend, any local backend, how dashboard actions trigger existing scripts
   and agent skills, scheduling of the two-day reminder, phone access, failure and retry handling, credential
   handling. Reuse what the repo has (Node 22, the existing npm scripts); say whether ClaudeClaw's interface is
   worth building on.
4. **Visual mock-ups or an isolated prototype** with sample data, covering: pipeline board, Needs my attention,
   project workspace, script A/B comparison, PDF review, hook review, candidate review, Instagram handoff with
   Drive and captions, Shorts and TikTok status, publishing schedule. Modern, clean, obvious actions, usable on
   a phone.
5. **Phased plan** in the order the dependencies require. For each phase: what is built, what is reused, which
   files change, how it is tested, risks. My suggested order: read-only dashboard and manifest; publishing
   (captions, Uploads, Drive, Instagram confirmation, two-day schedule); approvals in the dashboard; manual task
   tracking; Zernio only if it qualifies and I approve it.
6. **Questions for me**, including: 48 hours or two calendar days; where audio and avatar files should live;
   what to do with `D:\Uploads`; which Drive folder; where Zernio is; whether to backfill already-published
   Reels into the dashboard; whether a resource must be `live` before Instagram or only before the CTA matters
   to you.

Do not let small unknowns stop the proposal. State the assumption and carry on.

## 9. Stop before implementation

Investigate, design, mock up and plan. Then stop and wait for my explicit approval.

Until then, do not:

- build the production dashboard;
- change any existing skill, script, agent or integration, including the Gumroad step;
- move, rename or delete anything in `D:\Uploads`, `raw-media/` or any project folder;
- install dependencies in this repo or create databases;
- connect Google Drive, Zernio or any publishing service;
- publish, upload or push anything.

Any prototype lives in its own folder with sample data and touches nothing the workflow reads.

## 10. Success

I open one application and know, without searching: which scripts need choosing, which PDFs need reviewing, what
I need to record or create, which hooks and candidates need approving, what is rendering, what is ready to post,
where the video and caption are, what has gone out on Instagram, and when Shorts and TikTok are due. I click a
project, do my part, and it moves on.
