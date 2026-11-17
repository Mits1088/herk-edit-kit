# Command Centre publishing and named finals: handover

Saved 2026-11-16. Branch: `research-command-centre`. Workspace: `D:\herk-edit-kit`.
This is a completed-work snapshot. Re-read the workflow files before acting on a reel; its status may change.

## What was completed

Continued the unfinished Zernio integration left by Claude, preserved the existing Research/Ideas/navigation
work, completed the Publish-tab workflow and verification, then fixed final-file naming and approval recovery.
The user confirmed that future final videos must be named after their reel: `<reel-slug>-final.mp4`.

No commits or pushes were made during this work. New source files are still untracked and existing files are
modified locally. Inspect `git status` before editing, committing or moving work. Preserve the inherited
`dashboard/dev/research-scheduled.ps1`; it was already present and was not changed here. Earlier local research
commits (`86800d7`, `24a6f33`, `07010a2`) belong to the prior work, not this implementation. If a later user
authorizes pushing, the supplied handover specified the `origin` Mits1088 fork, never upstream.

## Publishing workflow

On the existing reel **Publish** tab:

1. Preview the exact approved MP4, with its filename, SHA-256 and approval date.
2. Review the destination account handle/ID and editable platform text/settings.
3. Select destinations explicitly; none are selected initially.
4. Click **Publish selected**, or enter a Europe/London time and click **Schedule selected**.
5. Read each destination's independent result, published link or recovery action.

The composer reuses existing generated captions. Facebook has its own editable text, initially copied from
Instagram. Hashtags are appended to actual published text; they are not merely provider metadata. YouTube has
title, description, keyword tags and visibility; the title goes in `platformSpecificData.title` and keyword
tags use the top-level `tags` array. TikTok uses documented top-level `tiktokSettings`, creator-specific
privacy/interactions, commercial disclosure and two explicit consent confirmations. Subtitles remain in the
existing video-render workflow.

Opening the dashboard, saving text, checking accounts and checking status never upload media or submit posts.
The first real upload/publication/schedule still requires the user's deliberate Publish or Schedule action.
All upload, publication, scheduling and retry verification in this session used mocks and isolated fixtures.
No live post was submitted.

### Credentials and account routing

Credentials are server-side only: process environment first, then the ignored root `.env`.
The existing local keys were reused; they must not be printed, committed or returned to browsers/logs.
The tracked `.env.example` contains blank settings only.

| Login | Environment setting | Destinations |
| --- | --- | --- |
| A | `ZERNIO_KEY_TIKTOK_YOUTUBE` | TikTok, YouTube |
| B | `ZERNIO_KEY_INSTAGRAM_FACEBOOK` | Instagram, Facebook |

Read-only live checks authenticated both logins and found all four connections healthy. Instagram reported a
professional creator account with publishing permission; Facebook had a selected Page with posting permission.
TikTok's current Business connection exposed public Direct Post privacy and Creator Inbox delivery. Health
is checked again before submission; account identity must still match the handle/ID the user reviewed.
Multiple matching accounts block the destination rather than silently selecting one.

### Gates and reliability

- A linked approved script, reviewed script status, matching approved candidate/QA, creative preflight and
  exact approved video SHA are required. A promised keyword resource must have its current PDF approved and
  its keyword live. The integration does not bypass these gates.
- Each destination's identity, stable idempotency key, account, exact video/text/settings and schedule are
  saved in its existing `reels-data/content/<item-id>.json` manifest before any upload.
- Each platform gets its own provider post and result. Partial failure across the two logins is visible;
  retrying a failed destination does not repost successful destinations.
- Local concurrent/double submissions are held. Unknown create responses retry only through an explicit
  user action using the saved identity; after a conservative 23-hour window, manual reconciliation is required.
- Check status is read-only at Zernio, including after a process interruption. No timer resumes uploads or
  resubmits an uncertain creation. Status refresh runs every 30 seconds while the reel's Publish tab is open.
- Known failed provider posts are reconciled before calling the provider retry endpoint. That endpoint
  publishes immediately, so a failed future schedule cannot be retried early. Once due, **Retry publish now**
  is explicit. Unconfirmed create requests retain the original schedule and identity.
- Scheduled means accepted by Zernio's hosted scheduler, not published. Once accepted, delivery does not
  require this PC to stay on. No webhook service or local scheduled publishing job was added.
- TikTok Creator Inbox is a manual handoff. It does not count as public publication until a public link resolves.
- Facebook has its own publication record. Historical "all platforms" folder records continue to cover only
  their original destinations; they never imply Facebook publication.
- Existing historical/manual publication records remain available in a collapsed section on Publish.
  Existing authenticated phone permissions are retained; provider submission actions stay on the PC.

### Platform limits retained

Facebook targets a Page and the documented 3–60 second Reel format. Instagram requires a professional account.
TikTok Creator Inbox requires finishing the post in the TikTok app. YouTube determines whether a video is a
Short from its format; this composer declares content not made for children. Scheduling accepts 10 minutes to
180 days ahead and refuses invalid, skipped or repeated UK clock-change times. Accepted-post editing and
cancellation stay in Zernio; retry preserves the submitted video/text. Quotas and provider processing can
still affect delivery. Consult the official reference links in the dashboard README for future API changes.

## Final filenames and approval repair

The reported approval failure was caused by a renamed/missing `renders/final.mp4`. Approval already existed,
so the approval script correctly refused to approve the same candidate again, while the dashboard still
offered the approval action because its expected final file was absent.

The user then requested a permanent naming rule for all future reels:

```text
video-projects/<reel-slug>/renders/<reel-slug>-final.mp4
```

- New Reel Studio projects write `reel.json.finalFile` with that path. Future promotions use the reel-named
  output by default, including existing projects without an explicit output setting.
- The approval records the actual path in `promotedTo`. The dashboard player, download and publisher follow
  the recorded path. Legacy approvals still pointing at `final.mp4` remain readable.
- The Video tab shows **Approved final** with the final filename; the candidate used for approval is retained
  under collapsed **Approval source candidate** history.
- A missing final has a **Restore approved final video** action. The real approval script rechecks QA and
  candidate bytes against the latest matching approval. It restores without adding another approval or
  changing the original approver/date. A changed candidate remains blocked.
- Reconciliation to a new filename archives a different existing output before replacement. Never relabel
  a differently encoded file as approved just because its filename looks correct.
- Root `AGENTS.md` and `CLAUDE.md` both document the naming rule. Canonical create-reel instructions/scripts
  were changed in `.claude/skills/`, then synced to `.agents/skills/` with `npm.cmd run sync:skills`.

- 2026-11-17: outside finishing edits (e.g. Canva) can be approved from the Video tab dropdown **Use an outside
  edit**, through `approve-external.mjs`. See the dashboard README. The publishing gate accepts an outside-edit
  approval only when its `basedOn` candidate has matching, passed QA.

### Existing reels repaired

Both named files already on disk differed from their QA-approved candidates. They were preserved under each
project's `renders/approved/` archive by the promotion helper; the named final now contains the approved bytes.
Original approval dates were retained.

| Reel | Recorded final | Status at handover |
| --- | --- | --- |
| `elephant-goldfish` | `renders/elephant-goldfish-final.mp4` | Matches approved v003; no candidate awaiting approval; publishing gate passes |
| `claude-seo-plugin` | `renders/claude-seo-plugin-final.mp4` | Matches approved v002; video approved; publishing held because keyword SEO is not live |
| Trial `2026-11-16-001-01` | None | Still PENDING REVIEW; no approved script/final; publishing blocked |

Private reel records, footage, archives, manifests and credentials remain gitignored. Another clone will not
contain this private local state unless it is transferred separately through an authorized process.

## Code map

| Files | Responsibility |
| --- | --- |
| `dashboard/lib/zernio.mjs` | Credential routing, account/health checks, gates, video checksum, UK time conversion, provider payloads, upload, submission, retry, status and safe public views |
| `dashboard/lib/manifest.mjs` | Explicit send/draft/check/retry actions and persisted workflow records; explicit Facebook destination |
| `dashboard/lib/state.mjs` | Publishing status, independent Facebook records, named final paths and missing-final recovery state |
| `dashboard/lib/workflow.mjs` | Approval-script verification against the recorded final path |
| `dashboard/server.mjs` | Publishing routes/actions and static files; approval responses and existing local/phone boundaries |
| `dashboard/public/publish.js`, `publish.css` | Publishing composer, account display, saved submissions and read-only status refresh |
| `dashboard/public/index.html` | Composer mounting, retained manual records, named-final labels and recovery controls |
| `.claude/skills/create-reel/scripts/new-reel.mjs` | Writes the new named-final setting |
| `.claude/skills/create-reel/scripts/qa-core.mjs` | Resolves/validates final output path and safely promotes/archives exact bytes |
| `.claude/skills/create-reel/scripts/approve-reel.mjs` | Named promotion and recovery/reconciliation of a recorded approval |
| `.claude/skills/create-reel/SKILL.md`, generated `.agents/skills/` copies | Future agent workflow and matching script implementations |
| `tests/helpers/zernio-fixture.mjs`, `tests/zernio.test.mjs` | Isolated mocked publishing fixtures and 16 integration tests |
| `tests/dashboard.test.mjs`, `tests/reel-approval.test.mjs` | Existing workflow regression coverage plus named-final, recovery and archive tests |
| `dashboard/dev/check-publishing.mjs` | Headless desktop/phone publishing checks using named synthetic video outputs |
| `dashboard/dev/e2e-reel.mjs` | Existing end-to-end check updated for named finals |
| `.env.example`, `dashboard/README.md`, `dashboard/VERIFY-zernio.md` | Blank credential configuration, operational instructions and verification evidence |

## Verification completed

- Full test suite: **186 tests; 185 passed, one skipped, zero failures**.
- Zernio integration tests: **16 passed**.
- New publishing browser checks: **19 passed**, desktop and phone, with overflow checks at 1440, 1024,
  768, 390 and 320px and 44px phone targets.
- Existing navigation/research/workflow browser checks: **66 passed**.
- `check:skills`: **243 files, zero discrepancies**. Root AGENTS/CLAUDE guides kept synchronized.
- Live dashboard read-only browser check confirmed the Elephant Goldfish player and **Approved final** label
  use the named file, with no approval button remaining.
- `git diff --check` passed. Taste reported `GATE: OFF (no build active)`; the existing application's design
  was preserved and application-specific screenshots/browser checks were used, not a claimed Taste gate pass.

See [verification](../dashboard/VERIFY-zernio.md) and [dashboard instructions](../dashboard/README.md).
Ignored local evidence is in `tmp/command-centre/publishing/`, `tmp/command-centre/nav/` and
`tmp/command-centre/final-naming-tests.txt`.

## Running and continuing

The dashboard was restarted with the updated code at `http://localhost:4319` and opened for the user.
That describes the session state, not a permanent service guarantee. To start it later:

```powershell
node dashboard/server.mjs
```

Read the current project and content manifest before continuing. Keep code changes, private workflow data and
secrets separate. For a deliberate first live post, review an approved reel on Publish, select destinations,
then let the user click Publish selected or Schedule selected. The task did not authorize an agent to choose
and send the first live post. Do not mark SEO's resource live or approve the trial just to unblock publishing.
