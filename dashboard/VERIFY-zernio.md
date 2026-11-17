# Zernio verification — 2026-11-16

Completed locally on `research-command-centre`. Existing work and publication records preserved.
No real upload, publication, schedule or retry was performed.

## Checks

- Latest `npm.cmd test`: 186 tests, 185 passed, 1 skipped, 0 failed, including named-final creation and legacy-approval recovery.
- Final `node --test tests/zernio.test.mjs`: 16 passed, 0 failed, including the added account-change and scheduled-retry regressions.
- `npm.cmd run check:skills`: 243 skill files, 0 discrepancies.
- Existing `node dashboard/dev/check-nav.mjs`: 66 desktop/phone navigation, research and workflow checks passed.
- `node dashboard/dev/check-publishing.mjs`: 19 desktop/phone checks passed against an isolated temporary workflow
  and mocked Zernio. Real local synthetic MP4; external browser requests blocked; headless Edge with Pointer Lock disabled.
  Keyboard Publish, separate editable Facebook text, Schedule, Check status, phone permissions and PENDING REVIEW
  gates exercised. Overflow checked at 1440, 1024, 768, 390 and 320px; phone controls meet 44px targets.
- Desktop composer and phone results screenshots inspected: fields readable, no sideways scroll or clipped controls,
  submitted results distinguish scheduled from published, exact video hash and destination accounts visible.
- `git diff --check`: passed.
- Taste checker: `GATE: OFF (no build active)`. This is an existing application, with its current design retained
  as requested. No marketing-page build was armed. Application-specific browser checks supply the visual evidence;
  this is not a Taste gate pass.

Screenshots and the browser report are local, ignored files in `tmp/command-centre/publishing/`.

## Live checks

Only `GET /accounts`, `GET /accounts/health` and TikTok creator-info were used with the two existing root `.env`
credentials. Both logins authenticated; all four destinations reported healthy and allowed posting. Login A maps
only TikTok/YouTube; login B maps only Instagram/Facebook. Instagram reported a professional creator account with
publishing permission; Facebook reported a selected Page with posting permission. No credential was printed or
included in a browser response, manifest, fixture, screenshot or source file.

The real trial (`2026-11-16-001-01`) was inspected read-only: `PENDING REVIEW`, publish gate false, with no approved
script or final video. It was not modified.

## Reliability coverage

Mocked tests cover credential routing, stale-account refusal, approval/QA/resource gates, exact approved video
hash, all identities persisted before first upload, platform-specific customContent, literal hashtags, YouTube
title/tags/visibility, TikTok required consent/privacy/interactions, independent partial failure and retries,
double-click prevention, lost-response recovery with the original idempotency key, expired uncertainty and
process interruption, GMT/BST and skipped/repeated UK times, scheduled-versus-published state, hosted automatic
retry state, due failed schedules, manual TikTok inbox handoff and subsequent public-link resolution, upload
failure, provider conflicts, public response secret exclusion, preserved history and explicit Facebook records.

Known failed remote posts retry immediately via Zernio's retry endpoint. Future scheduled posts are blocked
from that action until due. Unknown create requests keep their original schedule and identity; status checks
never send them again. After 23 hours of uncertainty, reconcile manually in Zernio.

## First live submission

Restart `node dashboard/server.mjs`. On the PC, open an approved reel's Publish tab, watch its approved final
video, review text/settings and destination handles, select destinations, then explicitly click **Publish
selected** or **Schedule selected** with a Europe/London time. Only that deliberate action starts live work.
See [README.md](README.md#zernio-publishing) for setup, platform limitations and recovery instructions.

## Named final outputs

New projects and future approvals use `renders/<reel-slug>-final.mp4`. `reel.json.finalFile` and approval
`promotedTo` record the output; the dashboard's player, Approved final label, download and Zernio publisher
follow that path. Legacy `final.mp4` approvals remain readable. Missing finals can be restored from the exact
verified candidate without duplicating an approval or changing its date. A different existing named output
is archived by the promotion helper before replacement.

Both Elephant Goldfish and Claude SEO were reconciled to their named outputs through the approval script,
with original approval dates retained and differing user-named copies archived. Byte-for-byte approval hashes
were checked afterwards. Elephant Goldfish's publishing gate passes. SEO's approved video is linked, while
its keyword/resource live gate continues to block publishing. No live publishing calls were made.
