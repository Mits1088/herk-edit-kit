# trail: product-proof reel template

A talking-head reel where the product's real output is the hero. A fixed browser frame sits above the speaker and
changes what it shows on the spoken beats. The proof beats take over the whole 9:16 frame, and the speaker returns
to own the name and the call to action. Trialled and approved by Mits on `hallmark-websites`
(final `4cb73503bbc3`, 12 Nov 2026).

**Call it:** `/create-reel <brief> … use the trail template`. Create-reel then loads this file at planning time. It
also proposes this template at Gate B when the reel is about a tool, site or product that produces a visible result.

| File | What it is |
| --- | --- |
| `README.md` (this file) | The template as built: layout, layouts, scene recipes, look, motion, sound, evidence rules, traps |
| `reference/Website-Reel-Reference-and-Creative-Direction.md` | The original blueprint Mits wrote from a reference reel. It is the source of the idea; this README records what was kept and changed |
| `example/` | The approved Hallmark build: `index.html` and the pipeline scripts. Copy and adapt; do not reuse its content |

## 1. The idea in one line

Promise + visible result in the first second. Then the same frame shows the mechanism, the proof and the payoff.
The layout stays stable, so the viewer reads change as meaning, not as a new composition.

## 2. Layout (1080x1920, organic safe area x 90-930, y 200-1600)

| Layer | Position | Notes |
| --- | --- | --- |
| Ground | full frame | Pale cool stone `#eceef1`, a faint 40 px grid (`rgba(20,24,30,.045)`), soft white light from the top. Light, editorial, not cartoon |
| Title | top 214, centred, Inter 900 76 px, tracking -2.5 | Topic in 2-4 words, from the script ("Claude Code Websites") |
| Benefit strip | top 316, Fraunces italic ~560 weight 54 px, ink on brand yellow `#ebc934` | The benefit in the speaker's own terms ("without the AI-made look") |
| Tag zone | y 200-440 after the title retires | One readable claim at a time: a quote card, a counter, issue chips, width ticks |
| Browser frame | left 115, top 470, 850x526, radius 22; chrome 56 px (three window dots and an address pill that names the state) | **Holds still.** Content changes inside it with contained wipes |
| Caption lane | top 1030, Inter 900 caps 56 px, ink box with a thin light edge | Hand-grouped phrases. Red only on the problem words, yellow only on the keyword |
| Presenter panel | one rounded panel, left 50, top 420, 980x1500; split shows it from y 1142 (`clip-path: inset(722px 0 0 0 round 40px)`) | Footage 1536x864 at (-294, 716) inside the panel. A rounded crop, because there is no clean matte for the head-over-backdrop look |
| Mascot (Claude topics) | official Clawd (glyph data, never redrawn) standing on the frame's top-right edge, cell 13 | Has a job: watches, reacts, cheers the proof, reviews. Never covers content |

## 3. Three layouts and one state machine

| Layout | Use it when | Mechanics (all transforms or clip-path, 0.36 s `power3.inOut`) |
| --- | --- | --- |
| **split** (home base) | Explanation and setup: the frame shows the example, you see the speaker | Panel clip `inset(722px…)`, captions at 1030 |
| **full** (2-3 per reel) | The picture *is* the proof: breadth, before/after, the hero demonstration | The panel slides away (`inset(1500px…)`). A dedicated full-bleed layer, composed for 9:16, fades in. Never just scale the split world up |
| **face** | Naming the product, opinions, the CTA | The panel opens to full height and the footage scales 1.736x to (-577, -713). The name or keyword sits in the tag zone |

Write the layouts as one sequence of `[time, layout]` pairs. Tween every property from the previous state's exact
value so any seek order lands the same (see `example/index.html`, "layouts"). Keep each full beat to about 1.5-3.6 s
and bring the speaker back between them.

## 4. Scene recipes (the order that worked)

1. **Hook, 0-4.5 s (split).** Title, strip, a real finished result in the frame and the speaker are all on screen by
   0.3 s. 3-4 contrasting real examples (dark, light, colour) wipe through the same frame on spoken words; the
   address pill rolls to each one's name. Two strong examples beat three unreadable flashes.
2. **Mechanism handoff (split).** The title lifts away and the frame dims (a dim overlay, **no blur**). One sharp
   object steps in front: the SKILL.md file, the config, the command. Highlight it as it is named, then show it
   being used (it drops into a light terminal while the real install line types).
3. **Name (face).** Full face, the name set large in Fraunces with a yellow underline sweep.
4. **Provenance (split).** The real source page (README, docs) with a marker on the exact line said, enlarged as a
   quote card in the tag zone.
5. **Breadth (full).** The real gallery or list as a full-bleed scrolling wall; a big counter card rolls to the
   spoken number.
6. **Problem (split).** The "without" version, dimmed, with its real issue tag. The product's own listed tells
   stack over it as chips, entering on the words.
7. **Payoff (full).** Same input, two outputs stacked: "without" on top, "with" rising from below in a protected
   ~0.85 s pause. The bad tag is struck, the good tag pops, the mascot cheers. The caption sits between the pages.
8. **How it works (split).** The one interaction the line describes, as a light familiar UI (terminal prompt,
   dealt cards, a pick). Label it "Illustration" when it is simulated. Call back to an example from the hook.
9. **Hero (full).** The fixed frame finally moves. The real result opens large ("localhost"), then the same real
   page is shown at the widths or states it was checked at (1440 → 834 → 390 px from real captures), with ticks.
10. **Review / hand-back (split).** A second character or check passes over the result, then the result glides
    down to the speaker ("comes back to you").
11. **CTA (face).** Full face with a comment bubble reading the keyword. Hold of 1.4 s or less after the last word.

Adapt the scenes to the script; never force a recipe onto a line it does not match (each visual must match the
spoken line literally).

## 5. Look and type

- **Palette:** ink `#15171a`, brand yellow `#ebc934` on one thing at a time, loss red `#ff6b5b` only on problem
  words and bad tags, success green `#1f9d55` only on passes and ticks, greys `#6b7280` / `#8a9099`.
- **Type:**
  - Inter 900 for the title and captions.
  - Inter 600-800 for chips.
  - Fraunces (OFL, `example/assets/fonts.css` adds it after the brand fonts) for the strip, the name, quotes and counters.
  - JetBrains Mono for files and commands.
  - Nothing under 32 px except page captures.
- **Familiar UI:** OS window dots, address pill, terminal prompt, comment bubble. Generic names, no drawn logos.

## 6. Motion grammar

- Contained wipe inside the frame for every content change: clip `inset(0 0 0 100%)` → `0`, 0.34 s, with a soft
  white edge line riding it.
- Dim-to-focus: dim overlay 0.55-0.8 opacity behind the active object, never on it. Remove emphasis when its claim ends.
- Things land on the word: wipes on example names, highlights on the noun, counters on the number.
- The mascot moves only with a reason (glance at a change, hop on a win, jump down beside the hero).
- Eases: `ReelEases.snapSettle` for landings, `accelExit` for exits, `cruise` for fades.

## 7. Sound

- Voice dominant; shared mixer `scripts/audio/reelmix.py` with the house profile, -14 LUFS.
- Bed: Funky_beat by Spol (CC0), looped on bar lines. Mits was fine with it here; vary it if recent reels used it.
- Foley on visible actions only: air plus a tick on wipes, typing on typed text, paper on highlights, blips for the
  mascot, a soft whoosh into and out of full-screen beats (kept off phrase-initial words).
- Payoff: a bright two-note tone, **no crowd cheer** for calm product proof (Mits, 12 Nov 2026).

## 8. Evidence rules

- Capture the product's real pages headless: theme previews, README, its own before/after or audit, and the same
  page at several widths. Examples: `example/scripts/capture*.mjs`; set `CHROME_PATH`.
- Before/after claims use the product's own comparison and numbers, labelled with their source ("Hallmark's own
  issue checker"). Don't draw outlines of issues you can't verify on the page.
- Simulated interactions say "Illustration". Check licences (Hallmark is MIT); no logos drawn by hand.

## 9. Production pipeline (example scripts, run from the project folder)

1. `transcribe.py`: local faster-whisper. Whisper puts phrase-initial words early; `cut_full.py` snaps word edges
   to the silence boundaries.
2. `cut_full.py`: keeps from `silencedetect`, pauses about 0.3 s, one protected ~0.85 s pause before the payoff line.
3. `write_plan.py`: plan schema v2, hand-grouped caption phrases, events, and `assets/reel-data.js` for the composition.
4. `index.html`: the composition; `shots.mjs` for phone-size stills; `keyframes.mjs` plus `kf.html` for the Gate B frames.
5. `audio.py`: cues from plan events through reelmix.
6. Gate B: build the first ~5 s (hook through the first wipe and the title) in `index.html`, serve it in Studio,
   record it with `preflight-reel --record-opening --end 5 --url <studio url>`, and stop for approval. Then drafts,
   delivery review, candidate and Stage 2.

## 10. Traps already paid for

- Studio (`npx hyperframes preview`) writes `data-hf-id` into `index.html`; stop it before lint, seek-check or a render.
- Promote panes, sites and pill rows with `will-change: transform, clip-path` from the start, or rounded corners
  shift by 1-7/255 between seek orders. No animated `filter` on children of the rounded frame.
- Give the face `<video>` `poster` = its first frame and `preload="auto"` (seek-check never seeks media).
- Park elements that rise in later fully off-frame (`y` past 1920), authored and at time 0.
- Hide device or full layers with `visibility: hidden` until used; fade them with opacity.
- Typed text must fit its window at 30 px mono (~40 characters across 850 px).
- `scripts/diag-seek.mjs` finds a pixel diff by hiding one layer at a time.

## 11. Where the build departs from the blueprint, and why

| Blueprint (`reference/`) | Built | Why |
| --- | --- | --- |
| Blue strip, white italic serif | Brand yellow strip, ink Fraunces italic | Brand accent; one yellow at a time |
| Coral mascots flanking the frame | One official Clawd with tasks; a second Clawd as reviewer | Brand-true, and a character with a job |
| Head overlapping a rounded backdrop | Rounded presenter crop | No clean matte for the footage; noted as a gap |
| Dark blurred backdrop plus terminal for the mechanism | Light dim overlay; light terminal; no blur | Light house look; blur broke seek determinism |
| Split composition throughout | 2-3 full-bleed proof beats plus face beats | Mits: "there should be some where it should be full screen" |
| Badges and outlines for issues | The product's own comparison and issue tags | Evidence we can verify |
