---
name: create-reel
description: Create, edit, render and quality-check premium Instagram Reels using Herk Edit Kit, motionmaxxing and HyperFrames.
argument-hint: "[Describe your Reel]"
disable-model-invocation: true
---

# Reel Studio: /create-reel

Creative brief from the user:

$ARGUMENTS

If the brief above is empty, ask for one in a single message (what the Reel is about, who it is for, any footage
or assets and where they are, length, organic or ad) and stop until it arrives.

This skill is an orchestration layer. The craft lives in the skills it routes to; load them, do not restate them.
Read `docs/REEL-STUDIO.md` once for the system overview.

## 1. Route the brief to one mode

| Mode | Use when | Owner skill (its gates apply) | Also load |
| --- | --- | --- | --- |
| A Faceless motion graphics | explainers, kinetic type, concept pieces, no footage | `make-a-video` | `motionmaxxing`, `video-storytelling`, `hyperframes`, `gsap` |
| B Footage editing | talking head, interview, B-roll, caption-heavy | `short-form-edit` | `motionmaxxing` for type, pacing and graphics only; `cut-silences`, `cut-mistakes` when asked |
| C Cinematic brand promo | launch, product ad, logo reveal, brand film | `motionmaxxing` for idea and world; `make-a-video` gates for approvals | `hyperframes`, `gsap`; `motion-showreel` only when the user asks for a showreel cut to music |

Pick one mode and say which and why in one line. Do not run two master workflows. Mode details and the
precedence rules between these skills: [modes.md](references/modes.md).

## 2. Workflow

1. Read the brief, `brand/DESIGN.md` (if it exists) and any supplied assets. Never modify or move source footage.
2. Identify audience, objective and profile: `organic` (default), `organic-60`, `ad`, `ad-disclaimer`
   (`.claude/skills/create-reel/profiles.json`).
3. Develop the direction with motionmaxxing's judgment (`references/judgment.md` in that skill): the idea, the
   world, the hook in the first second, the ending. Storyboard with scene timing.
4. Get the approvals the owner skill requires (brief, storyboard, preview, draft). Honor approvals already given.
   Paid API calls, uploads and transcription services need explicit permission first.
5. Create the project: `npm run new-reel -- <slug> --profile <p> --duration <s> --mode <faceless|footage|brand> --title "<title>"`.
   It runs Herk's generator and converts the project to native 1080x1920. Never use `hyperframes init` or
   render a landscape design and crop it.
6. Author or edit `index.html` and `compositions/`. Rules: [qa.md](references/qa.md#composition-contract).
7. Validate source: `npm run qa:reel -- video-projects/<slug> --source-only`. Fix FAILs. Preview in Studio
   (`npx hyperframes preview` from the project folder) when the owner skill's preview gate applies.
8. Draft: `npm run render-reel -- video-projects/<slug> --draft`, then `npm run qa:reel -- video-projects/<slug>`.
9. Look at the real frames: Read `look/sheet.jpg` and `safe-area-sheet.jpg` from the QA folder, plus any
   `mid.jpg` / `strips.jpg`. Judge G1 (proof readable) and G4 (one hero per frame) by eye.
10. Make only justified corrections; re-render a new draft version. Do not change the cut or the motion just to
    satisfy a heuristic gate; record why a WARNING or gate FAIL is intended instead.
11. Final: `npm run render-reel -- video-projects/<slug> --final`, then `npm run qa:reel` on it.
12. Deliver: final MP4 path, the editable project folder, and the QA.md path with an honest summary using
    PASS / FAIL / WARNING / NOT TESTED / NOT APPLICABLE. Never claim a check ran that did not.

Revisions reuse the existing project and render the next version number; earlier renders are never overwritten.

## 3. Hard limits

- One GSAP (the project's `assets/gsap.min.js`), one paused timeline per composition, registered under its
  exact composition ID. Never load motionmaxxing's `runtime/motion.js`, its bundled GSAP, or its `render.mjs`.
- Safe-area guides exist only on QA review sheets, never in the composition.
- `npx hyperframes snapshot` sends frames to Gemini when `GEMINI_API_KEY` is set: always pass `--describe false`
  unless the user approves the upload.
- Do not publish, upload, push to Git, or change remotes. Keep renders and private assets out of Git.
