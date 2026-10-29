# Reel Studio QA and composition contract

## Composition contract

- Root: `<div id="ID" data-composition-id="ID" data-start="0" data-duration="S" data-width="1080" data-height="1920" data-fps="30">`.
  `ID` equals `meta.json` `id`; `new-reel` derives it from the slug.
- Scripts: `assets/gsap.min.js` (the kit's pinned GSAP) then `assets/reel-eases.js`. No other GSAP copy.
- One `gsap.timeline({ paused: true })` per composition, registered once as
  `window.__timelines['ID'] = tl` with the literal ID. No `main` alias, no duplicate registration for linters.
- Anchor the timeline to the full duration: `tl.to({}, { duration: S }, 0)`.
- Prefer `fromTo` with explicit start values. No `Math.random`, `Date`, `performance.now`, timers,
  `requestAnimationFrame` or CSS animations driving what is drawn; seed any noise from the frame time.
- Timed elements: `class="clip"`, `data-start`, `data-duration`, `data-track-index`; same-track clips never
  overlap. Videos muted, audio as sibling `<audio>`.
- Keep text, logos and key action inside the profile's safe area.
- Fonts: link `assets/fonts/fonts.css` (written by `new-reel --style` or `npm run reel-fonts -- <project> --style <s>`)
  and use only the families and weights it declares; reel.json `fonts` lists them. No network fonts: a font that
  fails during a HyperFrames render falls back silently, so QA treats any remote font as a failure.
- Optional: `window.__events = [{ t, end?, label }]` marks the moments that matter (hero beat, reveal) so QA samples them first.

## Two render levels

| Command | Output | Checks |
| --- | --- | --- |
| `npm run render-reel -- <project> --draft` | `renders/<slug>-draft-vNNN.mp4` | quick: ffprobe size, fps, duration, audio stream; full decode (`<draft>.qa/quick.json`) |
| `npm run render-reel -- <project> --final` | `renders/<slug>-candidate-vNNN.mp4` | full QA below, run automatically on that exact file |
| `npm run approve-reel -- <project> --candidate <file> --sha <12 hex> --approved-by "<name>"` | `renders/final.mp4` | Stage 2 promotion, see below |

## Checks: tool and status

`npm run qa:reel -- <project> [--render <mp4>] [--source-only]` runs these and writes
`renders/<render>.qa/QA.md` and `qa.json` (the record for that one render), plus the project `QA.md` summary.
`*` = required.

| Area | Check | Tool | Kind |
| --- | --- | --- | --- |
| Herk | preview preflight * | `scripts/preflight.mjs` | technical |
| HyperFrames | lint * | `hyperframes lint` | technical |
| Clock | identity, one GSAP, paused timeline, duration, deterministic seeking * | `seek-check.mjs` | technical |
| motionmaxxing | G5 no page chrome | `scripts/lint.mjs` with `--width --height --duration` | creative |
| Layout | text outside the canvas * or the safe area * (12 even samples); text at event boundaries (review) | DOM pass in headless Chrome | technical |
| Direction | `reel.json` `"direction"` filled: hook, coreClaim, heroBeat, motif, style (* for a candidate; a WARNING before that, and `render-reel --final` refuses to start without it) | `qa-core.mjs` | technical |
| Fonts | no network font references * or requests * (blocked in QA); declared files present *; each declared face loaded from its own local file *; every text weight and style covered by a real face *; every text family has a local face * (a family left from an earlier style, or a system font, fails) | source scan, DOM pass | technical |
| Render | size, native vertical, fps, h264, yuv420p, duration, audio stream when expected, full decode * | `ffprobe`, `ffmpeg -xerror` | technical |
| Audio | loudness, clipping, dead air (required in Mode B) | `ffmpeg` silencedetect, astats, ebur128 | technical |
| Speech | Mode B records, speech integrity, EDL duration * | `qa-core.mjs` | technical |
| Herk, Captions | Mode B `validate-plan` source mapping *, caption alignment * when captions exist, `validate-footage` * when there is B-roll | short-form-edit validators | technical |
| Render | candidate unchanged while QA ran * | SHA-256 before and after | technical |
| motionmaxxing | G0, G2 no empty frame, G3 end hold; motion level (a question) | `scripts/look.py` | creative |
| Render | event frames from the encoded MP4: `event-sheet.jpg`, and `events/` with reasons in `index.json` | `samples.mjs`, `ffmpeg` | info |
| Visual, Speech | G1, G4, continuity, timing, captions and A/V sync, meaning at cuts, natural joins, framing | a person: the Stage 2 checklist | human |

Statuses: PASS, FAIL, WARNING, NOT TESTED, NOT APPLICABLE. Stage 1 is **BLOCKED** by any FAIL, and by any
required check that is not PASS, WARNING or NOT APPLICABLE (a required NOT TESTED never counts as passed).
Verdicts name what was checked: **VERIFIED** only for full QA of a rendered video; a passing `--source-only` run is
**SOURCE_VALIDATED** (no video checked) and passing draft quick checks are **DRAFT_CHECKED**. Neither is eligible
for approval, and no automated verdict approves anything: Stage 2 needs a person to approve the exact candidate
by its SHA-256, and a changed file invalidates that approval.
Creative rules are never FAIL: a motionmaxxing gate finding is a WARNING to review in context. A checker that
crashed, failed to start, or produced output QA cannot read is a FAIL of kind `checker`, never a quiet warning.
A missing optional tool (motionmaxxing, python) is NOT TESTED and listed. Safe-area text is a WARNING for organic
profiles (the guide is approximate) and a FAIL for ad profiles.

## Mode B speech integrity

QA reads from the project's `assets/`: `source-transcript.json` (verified word timings on the source timeline),
`transcript.json` (retimed edit), `edit-decisions.json` (EDL keeps) and `plan.json`. All four are required.

- No keep boundary falls inside a source word (FAIL).
- The retained transcript is exactly the source words inside the keeps, in order (FAIL otherwise).
- Every removed span containing a negation, qualifier or number is flagged (WARNING, kind human) with the words
  either side, and gets a 3 s review clip and waveform in `<candidate>.qa/cuts/`. This is a word scan for a
  person to judge, not a meaning check. Meaning, natural joins and voice quality stay on the Stage 2 checklist.
- Loudness, peaks and silences are ffmpeg measurements. They do not prove the audio sounds natural, and no
  script here listens. Comparing a transcript of the rendered audio is NOT TESTED: no local speech recognition
  is configured. Speaker framing is a human check on `safe-area-sheet.jpg` (no face detector).

## Two-stage approval

1. **Stage 1, technical verification:** `render-reel --final` -> full QA -> the candidate's own `qa.json`
   records its full SHA-256 (hashed before and after QA), every result with required/kind, and
   `technicallyVerified`. The project `QA.md` shows the latest summary and the Stage 2 checklist; approval
   never reads it.
2. **Stage 2, human creative approval:** a person watches and listens to that candidate and approves it
   explicitly, in a later message than the render. `approve-reel` then refuses unless the file is a candidate,
   its own record names it and is verified, the `--sha` prefix matches, and the file re-hashes to the same value
   now. Promotion copies to a temp file, verifies it, archives the previous `final.mp4` to `renders/approved/`
   (copy, verified), renames into place and verifies `final.mp4`. Any failure leaves the previous final as it was.
   Human approval is recorded separately from technical verification, in that `qa.json`, `reel.json`
   `approvals` and `QA.md`.

`reel.json` `requireHumanApproval` (default `true`, set by `new-reel`) may be `false` for Modes A and C; the
promotion is still an explicit command and is recorded as without human approval. Mode B always requires it.

## Targeted samples

Twelve evenly spaced samples miss short moves. `samples.mjs` adds frames around the moments that change, from
`window.__events` and `assets/plan.json` events (first), plan scene cuts, caption groups and clip windows, then the
timeline's tweens (nested timelines resolved to the root clock). A short span (up to 1 s) gets frames before, at,
during, at its end and after; a point, or a long span's ends, gets before, at and settled. Frames are deduplicated by
index and capped (36 in the DOM pass, 24 from the MP4); over the cap, lower-priority events are thinned evenly
across the film. Text off the canvas at those frames is a WARNING to review, because entries and exits are often
intentional; the 12 even samples keep the blocking clipping check. A sheet does not replace watching at full speed.

## Known limitations

- Style-library fonts are latin-subset WOFF2 (Fontsource, SIL OFL). Characters outside that subset fall back to a
  system font; put a fuller file in the style's `fonts/` and manifest if a reel needs them.
- The tween sampler assumes nested timelines run at timeScale 1; repeats count toward a tween's span.
- `seek-check` and the DOM pass seek the GSAP timeline in plain Chrome. HyperFrames' own frame controller is
  exercised by the render itself, not by these checks. Clip visibility is inferred from `data-start`/`data-duration`.
- `lint.mjs` reads text in the DOM; text drawn in `<canvas>` or images is invisible to it. Without `--width` and
  `--height` it would assume 1920x1080 (it only reads size from a `#main` element), so QA always passes them.
- `look.py` looks for macOS and Linux fonts, so on Windows its `sheet.jpg` has no timecodes; the QA
  `safe-area-sheet.jpg` carries timecodes instead.
- look.py's G0 motion test counts a frame as changed only above a fixed threshold on a 96x54 thumbnail. At
  60 fps each frame step is half as large, so gentle motion can read as "NO MOTION". Confirm with
  `ffmpeg -v error -i <mp4> -f framemd5 -` (count unique hashes) before acting on it. Measured in Phase 1: a
  60 fps smoke render had 120 of 120 unique frames in its first 2 s while look.py reported 7 of 179 changed.
- A gate FAIL from look.py (for example G3 end hold) is motionmaxxing's taste heuristic, reported as a WARNING.
  Fix it when it is a real problem; when the hold is intended, keep it and say why in the delivery notes.
- The hash binds an approval to one file; it is not a signature. Anyone with write access to the project could
  edit a `qa.json`. The checks guard against mistakes, not against someone forging records.
- `npm test` replaces HyperFrames and full QA with test scripts (`REEL_STUDIO_RENDERER`, `REEL_STUDIO_QA_SCRIPT`).
  The real path is `npm run test:reel-smoke` (a 2 s faceless render; it does not exercise Mode B footage).
- motionmaxxing's `runtime/hero3d` and `native-ui` layers depend on its own clock and are not available yet.
