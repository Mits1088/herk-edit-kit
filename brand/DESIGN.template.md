# <Brand name> — Visual Identity

Copy this file to `brand/DESIGN.md` and fill it in. Every new Reel project starts its own DESIGN.md from
`brand/DESIGN.md` (see `npm run new-reel`), then adds that reel's format and brief. Put logo and font files in
`brand/assets/` (kept out of Git). Delete any section that does not apply; leave nothing as placeholder text.

The creative brief for a specific reel overrides this file where they disagree. Technical requirements
(dimensions, safe areas, approvals) override both.

## Style Prompt

<Two or three sentences: what the brand feels like on screen, and what it must never feel like.>

## Audience and objectives

- Who: <target audience>
- What they should do or believe after watching: <content objective>
- Account: <@handle>, <organic / ads / both>

## Tone

<Voice of on-screen copy: e.g. plain, confident, dry humour; words the brand uses and avoids.>

## Colors

| Token | Hex | Role |
|---|---|---|
| `--brand-bg` | `#000000` | Primary background |
| `--brand-surface` | `#000000` | Panels, surfaces |
| `--brand-text` | `#ffffff` | Primary text |
| `--brand-accent` | `#000000` | One accent, used where emphasis is spent |

## Typography

- **<Display face> (<weights>)**: headlines. File or source: <brand/assets/... or Google Fonts name>.
- **<Text face> (<weights>)**: body lines and captions.
- Hierarchy at 1080x1920: headline <96-140 px>, sub-line <36-48 px>, captions <52-64 px>. Nothing under 32 px.

Ship font files locally in the project's `assets/` with `@font-face`; system fonts can differ between machines.

## Logo

- File: `brand/assets/<logo file>`; light and dark variants: <...>
- Clear space and minimum size: <...>
- Never: <recolour / stretch / effects>

## Motion Rules

- Feel: <e.g. heavy and certain / quick and light / calm>
- Eases: `ReelEases.*` (motionmaxxing measured curves). Default landings `softLand`, hero and CTA `snapSettle`,
  exits `accelExit`, fades `cruise`. Add brand-specific preferences here.
- Pacing: <hold lengths, how fast reels cut>

## References

- <Link or file of a reel whose craft to learn from, and what specifically to learn: timing, type, light.>

## What NOT to Do

- <Brand-specific anti-patterns.>
- Defaults from the kit and motionmaxxing: no page chrome (corner labels, counters, timecodes, progress bars),
  no generic slide layouts, no random bouncing text, no glow for its own sake, no stock transitions repeated
  for every cut. These are preferences, not bans, when the subject genuinely needs one.
