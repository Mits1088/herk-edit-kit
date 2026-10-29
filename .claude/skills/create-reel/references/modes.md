# Reel Studio modes and precedence

## Precedence when skills disagree

1. The user's explicit brief.
2. Technical contract: HyperFrames composition rules (`hyperframes`), the one-clock rule, the profile's size,
   fps and safe area, and the approval gates of the owner skill.
3. motionmaxxing's craft judgment and its "never ship" list, over house-style defaults in
   `MOTION_PHILOSOPHY.md`, `motion-showreel` and the style library (decoratives, ghost text, hairlines, eyebrows,
   progress patterns, persistent HUDs). If the brief asks for one of those, the brief wins; say so in the QA notes.
4. Herk's `MOTION_PHILOSOPHY.md` and the owner skill's house style.

Known conflicts, resolved:

| Topic | Source A | Source B | Reel Studio rule |
| --- | --- | --- | --- |
| Scaffold | `make-a-video`: `npx hyperframes init` | Herk: `npm run new-video` | `npm run new-reel` (wraps new-video, converts to vertical) |
| Ending | `make-a-video`: 4-6 s outro hold | `short-form-edit`, motionmaxxing G3: short hold | Reels end with a hold of about 1.4 s or less unless the brief wants more |
| HUD, chapter labels | `motion-showreel`: persistent HUD | motionmaxxing: never ship page chrome | No HUD unless the brief asks for it |
| Eases | `make-a-video`: 3-4 GSAP eases per beat | motionmaxxing: 12 measured curves | `ReelEases.*`; built-in GSAP eases are fine where a measured curve does not fit |
| Runtime | motionmaxxing: `Motion.film()` | HyperFrames: paused GSAP timeline | HyperFrames contract only; motionmaxxing's principles applied through GSAP |
| Openings | `short-form-edit`: three rough openings | render cost | Modes A and B: one rough animated opening plus two written alternatives; Mode C may animate three |
| Direction notes | separate brief files | one source of truth | `reel.json` `"direction"`: `hook`, `coreClaim`, `heroBeat`, `motif`, `style`; required before a final render |
| Creative approval | `short-form-edit`: an instruction to finish authorizes local building | Gate B | A new reel always stops at the creative preflight ([preflight.md](preflight.md)) before paid generation, the full build or any `render-reel`; after approval it continues autonomously. Projects created before Gate B are not gated |
| Visual plan | prose in DESIGN.md | structured plan | `assets/plan.json` `"schemaVersion": 2` in every mode (`short-form-edit/references/plan-schema.md`); Modes A and C need no captions or transcript |

## Mode A: faceless motion graphics

Owner: `make-a-video` (Gates 1-8). Replace its scaffold step with `new-reel --mode faceless`; skip its aspect
question (vertical is fixed; ask only organic or ad and length). Write `assets/plan.json` (schema v2: scenes with
visual metadata, `script` for planned narration) for Gate B; `make-a-video`'s own gates still apply after it.
Direction: motionmaxxing (`SKILL.md`, then `references/idea.md`, `world.md`, `type.md`, `motion.md`,
`transitions.md` as the beat needs). Narrative: `video-storytelling` for a persistent world and callbacks.
Build: `hyperframes`, `gsap`; catalog blocks via `hyperframes-registry` only if they fit the world.
Voice or music: only with a configured provider and the user's go-ahead (`docs/TOOLS-AND-API-KEYS.md`).

## Mode B: footage editing

Owner: `short-form-edit`, end to end: transcript, cuts, captions, B-roll, sound, its validators
(`npm run validate:short-form`, `npm run validate:footage`) and its gates. Create the project with
`new-reel --mode footage`, then put footage in the project's `assets/` folder (copies, never moves).
Transcription provider: ask, per `docs/TOOLS-AND-API-KEYS.md`; the bundled script is ElevenLabs-only and paid.
motionmaxxing applies to typography, caption treatment, pacing and the few graphic beats. The footage is the
hero: no animation that competes with a face that is talking. Consult `hyperframes` and `gsap` whenever a
composition or animated graphic is created or changed.
Speech integrity comes first: keep the speaker's real voice, personality and meaning. Cut between phrases, never
inside a word; review every removal that touches a negation, qualifier or number in context; flag uncertain cuts
for the person rather than deciding alone. Save the verified source transcript (source timeline, word timings)
as `assets/source-transcript.json` so QA can compare the edit against it. Human approval is always required.

Openings (this replaces `short-form-edit`'s three rough openings inside Reel Studio): build one rough animated
opening from the strongest truthful line, and write two alternatives in a sentence or two each (the line, the
first image, why it hooks). When the visual direction is uncertain, make one static preview frame per alternative
before choosing. Record the chosen hook and the reason in `reel.json` `"direction"`.

## Mode C: cinematic brand promotion

Herk owns the production workflow; HyperFrames renders. Direction owner: motionmaxxing (brand idea, world, hero moment, sound plan, gates). Approvals: `make-a-video`
Gate 4 (brief) and Gates 7-8 (preview, draft, final). Use `brand/DESIGN.md` and official brand assets only;
motionmaxxing's `scripts/brand.mjs` and `fetch_logo.mjs` capture a website only when the user gives the URL
and agrees. A showreel cut to music: `motion-showreel` for the beat grid, without its HUD unless asked.
3D (`runtime/hero3d`) is not wired into the HyperFrames clock in Phase 1: do not use it until an adapter is
built and seek-checked.
Openings: a high-production brand film may develop three distinct animated openings before choosing; otherwise
follow the lean rule of Mode B (one animated, two written). Before Gate B they are shown in Studio preview or as
static snapshots, not rendered with `render-reel`. Write `assets/plan.json` (schema v2) as in Mode A; generated plates
are `generated-image` with `evidenceType: illustrative`, official marks are `screenshot` with `authentic`.
