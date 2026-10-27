# Creator brand — Visual Identity

Taken from the approved `claude-mythos-reel` (final-v002, October 2026), a talking-head AI-news Reel. Every new
Reel project starts its own DESIGN.md from this file (see `npm run new-reel`), then adds that reel's format and brief.
Logo and font files live in `brand/assets/` (kept out of Git).

The creative brief for a specific reel overrides this file where they disagree. Technical requirements
(dimensions, safe areas, approvals) override both.

## Style Prompt

A dark graphite security-lab world: terminal windows, cards and counters on a lit charcoal ground, with one warm
yellow accent spent only where the story lands. It should feel precise, factual and calm, like a well-lit
workbench. It must never feel like hype, neon "AI" glow, or a slide deck.

## Audience and objectives

- Who: tech-curious Instagram viewers who follow AI news.
- What they should do or believe after watching: understand one concrete AI development and why it matters, then
  follow for more updates.
- Account: organic Reels.

## Tone

Plain and confident; numbers and names over adjectives. Claims on screen carry their source and date
("Source: Anthropic, 7 April 2026"). Dated recordings say so ("Recorded April 2026") and never present past
statements as current news. Context and source lines are sentence case without letter-spacing.

## Colors

The accent comes from the power icon on the creator's LAPTOP CEO shirt (sampled `#af9b29` under room light,
brightened for screen).

| Token | Hex | Role |
|---|---|---|
| `--brand-bg` | `#0e0f11` | Primary background (graphite ground) |
| `--brand-surface` | `#17191c` | Panels, cards, terminal windows, tiers |
| `--brand-text` | `#f2efe9` | Primary text |
| `--brand-accent` | `#ebc934` | One accent, used where emphasis is spent |
| `--brand-neg` | `#ff6b5b` | Losses only: missed, held back, attackers, "doesn't work" |

## Typography

- **Inter (variable; 900 for captions and display)**: headlines, captions and labels.
  File: `brand/assets/fonts/InterVariable.woff2` (OFL, licence in `OFL-Inter.txt`).
- **JetBrains Mono (Regular)**: terminal text, commands and code. File: `brand/assets/fonts/JetBrainsMono-Regular.woff2` (OFL).
- Captions: Inter 900 caps, 62 px (54 px when a chunk exceeds 18 characters), one dark box with a thin light edge,
  hand-grouped phrases, accent on roughly a quarter of chunks.
- Hierarchy at 1080x1920: headline 96-140 px, sub-line 36-48 px, captions 54-62 px. Nothing under 32 px; terminal
  text must stay readable on a phone.

Ship font files locally in the project's `assets/` with `@font-face`; system fonts can differ between machines.

## Motion Rules

- Feel: restrained and certain. Graphics make a point, then get out of the way of the speaker.
- Eases: `ReelEases.*` (motionmaxxing measured curves). Default landings `softLand`, hero and CTA `snapSettle`,
  exits `accelExit`, fades `cruise`.
- Layouts: split (speaker at native resolution under y 880, graphic above), full-screen graphic, and punch-in on the
  face for conviction beats. Hard cuts between layouts on phrase boundaries, never inside a phrase.
- Punch-ins use the widest full-height crop and push in from the top edge so the head is never cut.
- Pacing: speaker on screen about 80 % of the reel and never gone more than about 3 s. Visuals land on the spoken
  word (bars fill on the numbers, names highlight as they are said). End within a quarter-second of the last word.
- Recurring devices that worked: counters and odometers rolling to a spoken number, stamps (MISSED, PATCHED),
  real captured pages pushed in with an underline, and a callback to the opening graphic for the payoff.

## Sound

Local only unless a paid service is approved. Voice: high-pass, light denoise, gentle compression, presence lift.
A quiet synthesized bed under the voice, dropped out for the conviction punch-in. SFX only on visible actions: soft
ticks, taps on landings, air on real moves, one warm tone on the hero moment, dry stops on losses. Master about
-14 LUFS integrated, true peak at or below -1.5 dBTP.

## References

- `video-projects/claude-mythos-reel` (final-v002): the hook (frame 0 already shows the terminal and the context
  line), split/full/punch layout rhythm, caption treatment, and the opening callback at the payoff.

## What NOT to Do

- No logos drawn or approximated: company names are plain text or the real captured page.
- No generated B-roll without an approved paid service; illustrations are labelled ILLUSTRATION.
- No claims about a product's status beyond the recording's date.
- No tracked uppercase labels for context or source lines.
- No dark flashes at graphic cuts, empty first frames, or captions sitting on the chin after a cut.
- The red is never decorative; the yellow is never on more than one thing at a time.
- Defaults from the kit and motionmaxxing: no page chrome (corner labels, counters, timecodes, progress bars),
  no generic slide layouts, no random bouncing text, no glow for its own sake, no stock transitions repeated
  for every cut. These are preferences, not bans, when the subject genuinely needs one.
