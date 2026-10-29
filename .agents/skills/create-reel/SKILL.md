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

Who owns what:

| Mode | Herk Edit Kit | motionmaxxing | HyperFrames (+ `hyperframes`, `gsap` skills) |
| --- | --- | --- | --- |
| A | production workflow and storytelling | concept, visual direction, type, choreography, transitions, motion quality | composition and rendering |
| B | `short-form-edit` / `edit-video`: speech editing, source mapping, pacing, captions, editorial integrity | caption styling, the few graphic beats, type and polish only | consulted for every composition or animated graphic |
| C | production workflow | creative direction, visual identity, motion design | rendering |

Mode B protects the speaker's real voice, personality and meaning above everything else. Do not apply
motion-graphics rules (cadence, gates, "never ship" lists) mechanically to ordinary talking-head footage.

## 2. Workflow

1. Read the brief, `brand/DESIGN.md` (if it exists) and any supplied assets. Never modify or move source footage.
2. Identify audience, objective and profile: `organic` (default), `organic-60`, `ad`, `ad-disclaimer`
   (`.agents/skills/create-reel/profiles.json`).
3. Develop the direction with motionmaxxing's judgment (`references/judgment.md` in that skill): the idea, the
   world, the hook in the first second, the ending. Storyboard with scene timing.
4. Get the approvals the owner skill requires (brief, storyboard, preview, draft). Honor approvals already given.
   Paid API calls, uploads and transcription services need explicit permission first.
5. Create the project: `npm run new-reel -- <slug> --profile <p> --duration <s> --mode <faceless|footage|brand> --title "<title>" [--style <s>]`.
   It runs Herk's generator and converts the project to native 1080x1920. Never use `hyperframes init` or
   render a landscape design and crop it. `--style` (`brand` by default when its fonts exist; `npm run reel-fonts -- --list`)
   copies that style's font files into `assets/fonts/`. To change style later: `npm run reel-fonts -- <project> --style <s>`.
   Never load fonts from the network.
6. Author or edit `index.html` and `compositions/`. Rules: [qa.md](references/qa.md#composition-contract).
7. Validate source: `npm run qa:reel -- video-projects/<slug> --source-only`. Fix FAILs. Preview in Studio
   (`npx hyperframes preview` from the project folder) when the owner skill's preview gate applies.
8. Draft: `npm run render-reel -- video-projects/<slug> --draft` (quick checks only: decode, size, fps,
   duration, audio stream). Run `npm run qa:reel -- video-projects/<slug> --render renders/<draft>.mp4` when you
   need the review sheets for a draft.
9. Look at the real frames: Read `look/sheet.jpg`, `safe-area-sheet.jpg` and `event-sheet.jpg` (frames before, at,
   during and after each transition; full size in `events/`) from the QA folder, plus any
   `mid.jpg` / `strips.jpg`. Judge G1 (proof readable) and G4 (one hero per frame) by eye.
10. Make only justified corrections; re-render a new draft version. motionmaxxing gates (G0-G5) are creative
    WARNINGs: review them, do not change the cut or the motion just to satisfy one; record why it is intended.
    A checker FAIL (a tool crashed or could not read its input) is a real problem: fix the tool or input.
11. Stage 1: `npm run render-reel -- video-projects/<slug> --final` renders `renders/<slug>-candidate-vNNN.mp4`
    and runs full QA on it automatically. It is technically verified only when every essential check passes
    (any FAIL, or a required check NOT TESTED, blocks). Mode B also needs `assets/source-transcript.json`,
    `transcript.json`, `edit-decisions.json` and `plan.json`; see [qa.md](references/qa.md#mode-b-speech-integrity).
12. Stage 2: give the person the verified candidate path, its SHA-256 prefix, the project `QA.md` checklist and
    any flagged cuts (`<candidate>.qa/cuts/`). Ask them to watch and listen and approve that file explicitly.
    **Never run `approve-reel` because Stage 1 passed, or on an approval given in the same message as the
    render.** Run it only when the person approves that named candidate in a later message, or let them run:
    `npm run approve-reel -- video-projects/<slug> --candidate renders/<file>.mp4 --sha <12 hex> --approved-by "<name>"`.
    It re-hashes the file, refuses anything QA did not verify, and archives the previous `renders/final.mp4`.
13. Deliver: `renders/final.mp4` (or the pending candidate), the project folder, and `QA.md` with an honest
    summary using PASS / FAIL / WARNING / NOT TESTED / NOT APPLICABLE. Never claim a check ran that did not, that
    you listened to audio, or that loudness numbers or transcript checks prove speech sounds natural.

Revisions reuse the existing project and render the next version number; earlier renders are never overwritten.

## 3. Hard limits

- One GSAP (the project's `assets/gsap.min.js`), one paused timeline per composition, registered under its
  exact composition ID. Never load motionmaxxing's `runtime/motion.js`, its bundled GSAP, or its `render.mjs`.
- Safe-area guides exist only on QA review sheets, never in the composition.
- `npx hyperframes snapshot` sends frames to Gemini when `GEMINI_API_KEY` is set: always pass `--describe false`
  unless the user approves the upload.
- Do not publish, upload, push to Git, or change remotes. Keep renders and private assets out of Git.
- Never write `renders/final.mp4` by hand, edit a `qa.json`, or set `REEL_STUDIO_*` test hooks in real projects.
