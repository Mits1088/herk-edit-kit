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
- Keep text, logos and key action inside the profile's safe area; ship fonts locally with `@font-face`.

## Checks: tool and status

`npm run qa:reel -- <project> [--render <mp4>] [--source-only]` runs these and writes
`renders/<render>.qa/QA.md` and `qa.json`:

| Area | Check | Tool |
| --- | --- | --- |
| Herk | preview preflight | `scripts/preflight.mjs` |
| HyperFrames | lint | `hyperframes lint` |
| Clock | identity (meta, root, timeline key), one GSAP, paused timeline, duration, identical state and pixels when seeked forward, backward, repeatedly, shuffled | `seek-check.mjs` |
| motionmaxxing | G5 no page chrome | `scripts/lint.mjs` with `--width --height --duration` |
| Layout | text outside the canvas (clipping) or the safe area; fonts loaded | DOM pass in headless Chrome |
| Render | size, native vertical, fps, h264, yuv420p, duration, audio | `ffprobe` |
| motionmaxxing | G0 render exists, G2 no empty frame, G3 end hold; motion level (a question) | `scripts/look.py` |
| Visual | G1 proof readable, G4 one hero per frame, continuity, timing, captions and A/V sync | a person looking: NOT TESTED until done |

Statuses: PASS, FAIL, WARNING, NOT TESTED, NOT APPLICABLE. Safe-area text is a WARNING for organic profiles
(the guide is approximate) and a FAIL for ad profiles.

## Known limitations

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
- A gate FAIL from look.py (for example G3 end hold) is motionmaxxing's taste heuristic. Fix it when it is a real
  problem; when the hold is intended, keep it and say why in the delivery notes.
- motionmaxxing's `runtime/hero3d` and `native-ui` layers depend on its own clock and are not available yet.
