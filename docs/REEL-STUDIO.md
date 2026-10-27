# Reel Studio

Reel Studio makes Instagram Reels from a plain-English brief. You type one command in Claude Code, approve a
plan, and get an editable project, a vertical MP4, and a quality report.

It joins three tools that already know their jobs:

- **Herk Edit Kit** (this folder): projects, editing, captions, short-form workflow, validation.
- **motionmaxxing** (`.claude/skills/motionmaxxing`): creative direction, motion craft, and honest review.
- **HyperFrames** (installed with the kit): builds each video as an HTML page and renders it to MP4.

## Before the first run

1. Open a terminal in this folder (`D:\herk-edit-kit`) and run `claude`.
2. Optional but recommended: describe your brand once. Copy `brand/DESIGN.template.md` to `brand/DESIGN.md`,
   fill it in (or ask Claude to fill it in with you), and put your logo and font files in `brand/assets/`.
   Every new Reel starts from that file.

## Make a Reel

Type `/create-reel` followed by your brief:

```
/create-reel A 20 second Reel explaining why our app saves freelancers 5 hours a week. Audience: freelance designers. End with "Try it free". Organic post.
```

Claude picks one of three modes, tells you which, and shows you a brief and storyboard. Nothing is built until
you approve. If you type `/create-reel` with no brief, it asks you for one.

| Mode | For | Example brief |
| --- | --- | --- |
| A Faceless motion graphics | explainers, kinetic text, ideas without footage | `/create-reel A 15 second kinetic-type Reel: "Most to-do lists fail on day 3". Calm, premium.` |
| B Footage editing | you talking to camera, interviews, B-roll | `/create-reel Edit D:\Footage\tip-03.mp4 into a 30 second Reel with captions. Keep my best take.` |
| C Brand promotion | launches, product ads, logo reveals | `/create-reel A 15 second launch ad for our new espresso grinder. Paid ad. Use brand/DESIGN.md.` |

For an ad, say "ad" (or "ad with a disclaimer"). Ads use stricter safe areas. For fast motion you can ask for
60 fps. Any length works; organic Reels default to 20 seconds.

Footage is never changed or moved; the project uses copies. Paid services (transcription, voice, music,
image generation) are only used after you say yes.

## Where things are

Each Reel lives in `video-projects/<name>/`:

| Path | What it is |
| --- | --- |
| `index.html`, `compositions/` | the editable video |
| `DESIGN.md` | brand and look for this Reel |
| `reel.json` | format, mode, and a log of every render |
| `renders/<name>-draft-v001.mp4` | drafts, numbered |
| `renders/<name>-final-v001.mp4` | finals, numbered; a new version never replaces an old one |
| `renders/<render>.qa/QA.md` | the quality report for that render |

Video projects and renders stay on your computer; they are not added to Git.

## Preview and review

- Live preview while building: in the project folder run `npx hyperframes preview` and open the address it
  prints (usually http://localhost:3002).
- Watch a render: open the MP4 from `renders/` in any video player.
- Claude also reads still frames from every draft (contact sheets) before showing it to you.

## Ask for changes

Just say what to change, in the same conversation or a new one:

```
In video-projects/espresso-launch, make the logo reveal slower and change the last line to "Grind fresh".
```

Claude edits the existing project and renders the next numbered draft. Earlier renders stay.

## Render the final

When you approve a draft, Claude runs the final render. You can also run the steps yourself:

```
npm run render-reel -- video-projects/<name> --draft
npm run render-reel -- video-projects/<name> --final
npm run qa:reel -- video-projects/<name>
```

On a machine with little free memory, add `--workers 1` to the render command.

## Read the QA report

`QA.md` lists every check with one of five results:

| Result | Meaning |
| --- | --- |
| PASS | the automated check ran and passed |
| FAIL | the check ran and found a problem |
| WARNING | worth a look; may be intended |
| NOT TESTED | needs a person to look (taste, readability, timing) |
| NOT APPLICABLE | does not apply (for example audio checks on a silent Reel) |

The technical checks (size 1080x1920, frame rate, codec, duration, audio, text off-screen or outside the safe
area, one deterministic animation clock) should all PASS before you publish. The motionmaxxing gates (G0-G5) are
craft heuristics: a FAIL there is a strong hint, and sometimes an intended choice. Automated checks never prove a
video looks good: always watch it.

Two review images come with each report: `look/sheet.jpg` (frames across the Reel) and `safe-area-sheet.jpg`
(the same idea with the areas covered by Instagram's interface shaded red and a timecode on each frame). The
shading exists only on that image, never in the video.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `/create-reel` is not recognised | Start `claude` from this folder. In Git Bash scripts use `//create-reel` or `MSYS_NO_PATHCONV=1`, because Git Bash rewrites a leading `/`. |
| Render fails or Chrome times out | Close other apps and add `--workers 1`. Run `npx hyperframes doctor`. |
| "Project already exists" | Pick a new name, or ask Claude to revise the existing project. |
| Text sits under Instagram's buttons | QA shows it under Layout; ask Claude to move it inside the safe area. |
| Fonts look different on another computer | Put the font files in the project's `assets/` and load them with `@font-face`. |
| A check says NOT TESTED: Chrome not found | Set `CHROME_PATH` to your Chrome or Chromium executable. |
| `npm run check` reports skill errors after editing skills | Run `npm run sync:skills`, then `npm run check` again. |

## How it fits together (for maintainers)

- Skill: `.claude/skills/create-reel/` (`SKILL.md`, `references/modes.md`, `references/qa.md`).
  Codex gets a mirror in `.agents/skills/` via `npm run sync:skills`.
- Scripts: `new-reel.mjs` (wraps `npm run new-video`, converts to vertical), `render-reel.mjs` (versioned
  renders), `qa-reel.mjs` (all checks plus the report), `seek-check.mjs` (one clock, deterministic seeking).
- Profiles: `.claude/skills/create-reel/profiles.json` (`organic`, `organic-60`, `ad`, `ad-disclaimer`).
- Animation: one GSAP (the kit's pinned copy) and one paused timeline per composition. motionmaxxing's measured
  eases are available as `ReelEases` (`runtime/reel-eases.js`); its own runtime and renderer are not used inside
  HyperFrames.
- Ad safe areas follow Meta's widely cited Reels ad guidance (14% top, 35% bottom, 6% sides; 40% bottom with a
  disclaimer). Check Meta's current Ads Guide before publishing an ad. The organic guide is approximate.
- Tested versions and the Phase 1 report: [REEL-STUDIO-PHASE1.md](REEL-STUDIO-PHASE1.md).
