# Reel Studio: Phase 1 report (2026-10-26)

## Tested versions (proven to work together)

| Component | Version |
| --- | --- |
| Herk Edit Kit | 2.0.0 at 10511e5af86fc47756ea89803b397422e2d89284 (upstream nateherkai/herk-edit-kit) |
| motionmaxxing | 8c8ec0f2a6f6c9a0da15cd24f7b1298ab298368c (copied, see `.claude/skills/motionmaxxing/LOCAL-CHANGES.md`) |
| HyperFrames | 0.7.109 (kit pin) |
| GSAP | 3.14.2 (kit pin; motionmaxxing's bundled 3.12.5 is not loaded) |
| Playwright | 1.63.0 (kit dependency, used with the installed Chrome) |
| Node.js / npm | 24.22.1 / 11.19.1 |
| Python | 3.14.3 (numpy 2.4.3, Pillow 12.1.1) |
| FFmpeg / ffprobe | 8.1 essentials build (gyan.dev) |
| Chrome | 155.0.8059.86; HyperFrames renders with chrome-headless-shell 146.0.7680.31 |
| Claude Code | 2.1.310 |
| OS | Windows 11 Home 10.0.26200, Git Bash and PowerShell 5.1 |

No dependency was upgraded. `npm ci` reported that npm 11 skipped install scripts for `onnxruntime-node` and
`protobufjs`; nothing in Phase 1 needed them (they matter only for local transcription and TTS features).

## Acceptance criteria

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Core dependencies checked | PASS | versions above; `npx hyperframes doctor` OK except optional whisper-cpp, Kokoro, MusicGen (not installed) and a low free-memory warning |
| 2 | Herk's original tests still work | PASS | baseline 11/11 before changes; now 16/16 (11 original + 5 Reel Studio) |
| 3 | motionmaxxing available locally | PASS | `.claude/skills/motionmaxxing` via its installer (`--dir --copy`); identical to upstream except two documented files |
| 4 | HyperFrames renders a real vertical MP4 | PASS | ffprobe: h264, yuv420p, 1080x1920, 30.000 fps, 6.000 s; second render 60.000 fps, 3.000 s |
| 5 | Animation clock deterministic | PASS | seek-check: identical computed state and pixels at 12 frames reached forward, backward, repeatedly and shuffled, three runs; negative control with Math.random fails as expected |
| 6 | /create-reel exists with valid metadata | PASS | frontmatter test; `npm run check` frontmatter rule |
| 7 | Skill arguments supported | PASS | fresh headless Claude Code session in the kit: the brief with marker ZEBRA-CHECK-42 reached the skill, which routed to Mode A and stopped at the approval gate; `/create-reel` with no brief asked for one |
| 8 | Workflow architecture documented | PASS | `docs/REEL-STUDIO.md`, `create-reel/references/modes.md`, `qa.md` |
| 9 | Brand and Instagram profiles defined | PASS | `brand/DESIGN.template.md`; `profiles.json` (organic, organic-60, ad, ad-disclaimer) |
| 10 | QA tools and limitations documented | PASS | `create-reel/references/qa.md` |
| 11 | Validation results recorded | PASS | this file; `renders/*.qa/QA.md` in the smoke projects |
| 12 | Existing user work intact | PASS | no existing project or upstream file changed except `package.json` (4 scripts added) and `THIRD_PARTY_NOTICES.md` (motionmaxxing entry) |

Not tested in Phase 1: a Mode B footage edit, audio and captions, a final-quality (`--final`) render, the
Studio preview UI, and the ad profiles on a real composition (their pixels are unit-tested).

## Smoke tests

- `video-projects/reel-studio-smoke-20261026/renders/reel-studio-smoke-20261026-draft-v002.mp4` (30 fps, 6 s)
  QA: preflight, HyperFrames lint (0/0), seek-check, motionmaxxing G5 (15 rules), canvas and safe-area text,
  all ffprobe checks, G0, G2: PASS. Fonts: WARNING (system Arial; no web font in the starter).
  G3 end hold: FAIL (the placeholder starter is resolved at 1.6 s and holds; expected for a starter, not
  changed to satisfy the gate). Contact and safe-area sheets reviewed by eye: text centred, inside the
  safe area, no clipping or blank frames.
- `video-projects/reel-studio-smoke60-20261026/renders/reel-studio-smoke60-20261026-draft-v001.mp4` (60 fps, 3 s)
  Same technical PASSes. look.py G0 reported "NO MOTION" (7 of 179 frames changed); framemd5 shows all 120 frames
  of the first 2 s are unique, so this is look.py's fixed threshold at 60 fps (documented in qa.md). G3: FAIL as above.

`draft-v001` of the 30 fps project was rendered directly with `npx hyperframes render` before `render-reel.mjs`
existed; it is the same composition.

## Issues found and resolved

1. Full motionmaxxing copy made `npm run check` report 58 syntax errors: three.js browser ES modules parsed as
   CommonJS under the kit's root `package.json`. Fixed with `runtime/hero3d/package.json` `{"type":"module"}`;
   no validation disabled.
2. Clock conflict: motionmaxxing's `Motion.film()` registers `__timelines.main` and its own `__seek`, and bundles
   GSAP 3.12.5. Not loaded. Its 12 measured eases are ported verbatim to `ReelEases` (test proves numerical identity).
3. The first seek-check draft screenshotted before Chrome painted, producing false mismatches. It now waits two
   animation frames and also compares computed animated state.
4. motionmaxxing's `lint.mjs` reads size only from `#main` (else 1920x1080); QA always passes width, height and duration.
5. motionmaxxing's `install.sh`, `providers.sh`, `_cdp.mjs` and `look.py` assume macOS/Linux paths: Chrome is passed
   via `CHROME_PATH`; look.py's sheet has no timecodes on Windows, so QA draws its own timecoded sheet.
6. `GEMINI_API_KEY` is set in this environment, which makes `hyperframes snapshot` upload frames to Gemini by
   default. The skill requires `--describe false`. Reel Studio's scripts set `HYPERFRAMES_NO_TELEMETRY=1` for
   their own HyperFrames calls; global telemetry was not changed.

## Open items

- Meta's ad safe areas come from widely cited secondary sources; the primary Ads Guide page was not retrieved.
- motionmaxxing's `hero3d` and `native-ui` layers need an adapter to the HyperFrames clock before use.
- Low free memory (about 1 GB at test time): renders used `--workers 1`.
- The kit checkout has no Git remote of its own for these changes yet (origin is upstream; nothing was pushed).

## Starting Phase 2

1. Read this file and `docs/REEL-STUDIO.md`.
2. Run `npm test` and `npm run check` (expect 16/16 and 0 errors).
3. Start `claude` in `D:\herk-edit-kit` and give the Phase 2 prompt (the polished 10-second cinematic demo).
   Fill in `brand/DESIGN.md` first if the demo should use your brand.
