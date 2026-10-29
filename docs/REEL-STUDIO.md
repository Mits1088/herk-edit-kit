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
   List the font files in `brand/fonts.json` (family, file, weight range, style, licence). Every new Reel starts
   from that file and copies those fonts into its own `assets/fonts/`. The kit ships Inter and JetBrains Mono
   (SIL OFL) as the default brand fonts, so a fresh checkout renders the same type on every machine. If a listed
   file is missing, `new-reel` stops; pass `--style none` to choose system fonts deliberately.

## Make a Reel

Type `/create-reel` followed by your brief, or just ask Claude for a Reel in plain words; it loads the same skill:

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
| `renders/<name>-candidate-v001.mp4` | final-quality candidates, numbered; a new version never replaces an old one |
| `renders/final.mp4` | the candidate you approved; earlier approved finals move to `renders/approved/` |
| `renders/<render>.qa/QA.md`, `qa.json` | the quality report and record for that one render (hash, results, approval) |
| `QA.md` | summary of the latest QA run and what is waiting for your approval |

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

## Render the final and approve it

Finishing takes two stages:

1. **Automatic technical check.** When you approve a draft, Claude runs the final render. This produces a
   numbered candidate and runs every quality check on it. The candidate counts as technically verified only
   when every essential check passes.
2. **Your approval.** You watch and listen to that candidate, and Claude gives you a short checklist. Only when
   you explicitly approve that exact file does it become `renders/final.mp4`. Claude never approves on your
   behalf just because the checks passed.

You can also run the steps yourself:

```
npm run render-reel -- video-projects/<name> --draft        # quick preview + quick checks
npm run render-reel -- video-projects/<name> --final        # candidate + full QA (Stage 1)
npm run approve-reel -- video-projects/<name> --candidate renders/<name>-candidate-v001.mp4 --sha <first 12 of its hash> --approved-by "<your name>"
```

`QA.md` in the project folder prints the exact approve command for the current candidate. Approval refuses a
file that QA did not verify, one that changed after QA, or a hash that does not match. If anything goes wrong
while it copies, your previous `final.mp4` stays as it was. On a machine with little free memory, add
`--workers 1` to the render command.

## Read the QA report

`QA.md` lists every check with one of five results:

| Result | Meaning |
| --- | --- |
| PASS | the automated check ran and passed |
| FAIL | the check found a problem, or the checking tool itself broke |
| WARNING | worth a look; may be intended |
| NOT TESTED | did not run, or needs a person (taste, readability, timing, how speech sounds) |
| NOT APPLICABLE | does not apply (for example audio checks on a silent Reel) |

Checks marked required (size 1080x1920, frame rate, codec, duration, decoding, audio, text off-screen, one
deterministic animation clock, and for footage the transcript, cut and caption checks) must pass. A required
check that did not run blocks approval. The motionmaxxing gates (G0-G5) are craft heuristics and show as
WARNING: a strong hint, and sometimes an intended choice. For footage, QA flags cuts that removed words like
"not", "only" or a number, and saves a short clip of each for you to watch. Automated checks never prove a
video looks or sounds good: always watch and listen.

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
| Fonts look different on another computer | Install a style with local fonts: `npm run reel-fonts -- video-projects/<slug> --style <name>` (`--list` shows them). It renames the old style's families by role and lists what it left alone. QA's Fonts rows name any face that failed and any text in a family with no local face. |
| A check says NOT TESTED: Chrome not found | Set `CHROME_PATH` to your Chrome or Chromium executable. |
| `npm run check` reports skill errors after editing skills | Run `npm run sync:skills`, then `npm run check` again. |

## How it fits together (for maintainers)

- Skill: `.claude/skills/create-reel/` (`SKILL.md`, `references/modes.md`, `references/qa.md`).
  Codex gets a mirror in `.agents/skills/` via `npm run sync:skills`.
- Scripts: `new-reel.mjs` (wraps `npm run new-video`, converts to vertical, installs the style's fonts),
  `fonts.mjs` (style font manifests, install and re-sync), `samples.mjs` (event-targeted QA frames), `render-reel.mjs` (versioned
  drafts and candidates; draft quick checks; full QA on candidates), `qa-reel.mjs` (all checks plus the report),
  `qa-core.mjs` (blocking rule, records, speech integrity, safe promotion), `approve-reel.mjs` (Stage 2),
  `seek-check.mjs` (one clock, deterministic seeking).
- Tests: `npm test` (fast, with HyperFrames and full QA replaced by test scripts) and `npm run test:reel-smoke`
  (a real 2 s render, full QA and approval; about a minute).
- Profiles: `.claude/skills/create-reel/profiles.json` (`organic`, `organic-60`, `ad`, `ad-disclaimer`).
- Animation: one GSAP (the kit's pinned copy) and one paused timeline per composition. motionmaxxing's measured
  eases are available as `ReelEases` (`runtime/reel-eases.js`); its own runtime and renderer are not used inside
  HyperFrames.
- Ad safe areas follow Meta's widely cited Reels ad guidance (14% top, 35% bottom, 6% sides; 40% bottom with a
  disclaimer). Check Meta's current Ads Guide before publishing an ad. The organic guide is approximate.
- Tested versions and the Phase 1 report: [REEL-STUDIO-PHASE1.md](REEL-STUDIO-PHASE1.md).
