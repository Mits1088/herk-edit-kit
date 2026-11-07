# Plan: a reusable house sound for reels

Status: **built on 2026-11-07** as a single high-energy profile with no A/B/C versions (Mits's decision). See
`scripts/audio/reelmix.py`, `scripts/audio/library.mjs`, `audio-library/`, `cueChecks` in `create-reel` qa-core, and
`cut-silences --protect`. Differences from this text: the level basis is the loudest K-weighted **100 ms** window
(not 400 ms), the voice gets its own peak control before the mix, and claude-arena v003 is one version.
The profile is provisional until Mits approves v003. Revision 1 was reviewed by Mits and ChatGPT on 2026-11-07.
Owner: Mits. Drafted by Claude Code after the claude-arena v001 → v002 revision.

**Goal.** A system that knows when a sound should stay subtle and when it should make a moment exciting, while keeping
speech clear throughout. It is not about making claude-arena louder, and it is built by extending the audio code the
kit already has, not by adding a second pipeline.

## 0. Decisions (Mits, 2026-11-07)

| Question | Decision |
| --- | --- |
| Openverse licences | **CC0 / public domain only.** No CC BY, no NC, no ND for now. Verify each licence on the original source page, not only Openverse's metadata. Record the source. |
| Audio references | **Don't wait for external reels.** Calibrate on claude-arena with three controlled versions (§7) on Mits's phone. Add external references later. |
| earshot | **Install for Claude Code** (MCP). Local only, Gemini (`llm`) disabled, optional: the ffmpeg pipeline works without it. |
| Approved final | Never replaced automatically. A new final only through `approve-reel` on a named candidate. |
| Logo API | CompanyEnrich stays documented as a future logo source, separate from this work. Verify the endpoint and terms before use. |

## 1. The problem, measured

Effects are measured against the voice: K-weighted (the curve LUFS uses), in 100 ms windows, against the voice's median
speaking level. This is what `create-reel` QA measures now (`qa-core.mjs`, `sfxPerceived`; uncommitted working tree).

| Mix | Over speech | In pauses | Integrated | Mits's verdict |
| --- | --- | --- | --- | --- |
| karpathy-rules (final) | -11.9 dB | -12.1 dB | -18.8 LU | "quite loud" before this fix |
| claude-animated-reels | -12.8 dB | -12.6 dB | -22.3 LU | too loud (recurring) |
| claude-arena v001 | -11.0 dB | -9.4 dB | -17.2 LU | "overpowering" |
| claude-arena v002 | -19.9 dB | -21.9 dB | -26.0 LU | "ok but went a bit quiet" |

Why both fail:
- **v002 is flat by construction.** Its guard clamps every effect to the same ceiling, so a typing tick and the crowd
  roar at the payoff both sit at about -20 dB.
- **Every effect is synthesized in numpy.** A synthesized crowd can't carry a payoff at any level.
- **QA only catches "too loud".** Nothing fails a hero moment that is too quiet or missing.

## 2. What already exists, and what we extend

Extend these. Don't replace them.

| Existing | Where | Extension |
| --- | --- | --- |
| Per-reel mix (bed duck, SFX duck under speech, guard, loudnorm, limiter) | `video-projects/<slug>/scripts/audio.py`, hand-written per reel | Move the guard and ducking into one shared helper (§4), which `audio.py` imports. Everything else stays per reel. |
| Stems + gains (`stem-voice`, `stem-sfx` as mixed, `mix-levels.json`) | each project's `assets/audio/` | Add `cues.json`: one row per placed effect (§3) |
| Loudness, true peak, clipping, dead air | `qa-core.mjs` `audioChecks` | Add limiter load and pre-encode vs encoded MP4 diff (§5) |
| Effects vs voice, perceived (single limit) | `qa-core.mjs` `sfxPerceived` | Per cue, by role, with a too-quiet floor (§5) |
| Encoded mix event diagnostic | `qa-core.mjs` `audioBalance` | Keep as the encoded-file cross-check |
| Event plan with times | `assets/plan.json` `events` | Add the optional `sfxRole` and `sfx` fields (§3) |

## 3. Sound roles (starting points; §7 calibrates them)

Levels are K-weighted, relative to the voice's median speaking level. A cue's level is the loudest 400 ms window of
that cue alone (from its own render, before summing), after its gain, duck and guard. This is the same basis QA reads.

| Role | Examples | Over speech | In a gap | Floor (too quiet) | Length at level |
| --- | --- | --- | --- | --- | --- |
| `foley` | typing, ticks, taps, paper, UI clicks | -20 to -24 dB | -20 to -22 dB | none (subtle is fine) | n/a |
| `accent` | whoosh on a real move, impact, success tone | -16 to -19 dB | -14 to -17 dB | -26 dB | about 0.5 s |
| `hero` | crowd cheer at the payoff, crowd boo at the hook, a dramatic reveal | ducks to accent level | -3 to -8 dB | -12 dB | up to about 2.5 s, then the tail |

Rules:
- A `hero` cue peaks in a gap: a beat the edit leaves on purpose, or the 0.3-0.6 s after a punchline. It builds in
  (about 150-300 ms), peaks, and ducks smoothly under the next word over 150-250 ms. It does not cut off, and its tail
  continues under the speech at the accent level.
- 1-3 hero cues per reel. Each one gives its reason in the plan (`"sfx": {"role": "hero", "why": "payoff: last Clawd
  standing"}`). That reason is the only way to get past the foley limit. Untagged cues are treated as `foley`.
- Delivery targets, as starting points rather than Instagram rules: about -14 LUFS integrated and at most -1.5 dBTP,
  measured on the encoded MP4. Contrast does the work, not a louder master.

## 4. Mixing: one shared, speech-aware helper

New: `scripts/audio/reelmix.py`. It is small, numpy/scipy only, and imported by each reel's `audio.py`.

- `place(cue, role, t, gain)` renders each cue into its **own** buffer and keeps a per-cue row: role, start, end,
  source file. Its output is `cues.json` plus the summed `stem-sfx.wav` (as mixed).
- `speech_mask(words)` makes a smooth speech envelope, the one bed ducking already uses (moved, not rewritten).
- `duck_and_guard(cues, voice, mask, limits)` processes each cue: duck under speech to its role's speech level, hold
  its gap level, attack 150-300 ms and release 150-250 ms. Gain changes are limited per 10 ms so nothing jumps, and
  the duck never closes completely, so tails stay natural. The K-weighted measurement is the one QA uses.
- The bed duck moves here too. Its existing targets are kept.
- The master stays as is: loudnorm (linear) plus a gentle limiter. The helper reports **limiter load**: the gain
  reduction applied and how much of the reel it touched.

The voice is never processed by this helper. Its existing cleanup stays in each reel's `prep.py`.

## 5. QA (extend `qa-core.mjs`)

Each check reads `cues.json` plus the stems. All of them are deterministic and covered by tests.

| Check | Measurement | Result |
| --- | --- | --- |
| Overwhelms speech | each cue's level over speech vs its role limit | FAIL above |
| Hero too quiet or missing | a planned `hero` event with no cue, or a hero cue that never reaches its floor | FAIL |
| Accent inaudible | accent under -26 dB at its peak | WARNING (likely lost on a phone) |
| Mistimed | the cue's audible onset (energy rise over its own noise floor) vs its plan event time; more than 60 ms early or more than 100 ms late | WARNING, with the times |
| Masking important words | bed + effects vs voice in the 1-4 kHz speech band, during words flagged important (emphasis captions and beat anchors, or `"important": true`) | WARNING if within 10 dB. This is a proxy, not proof. |
| Clipping | already exists (true peak, sample peak, flat factor) | stays |
| Excessive limiting | limiter load from the mix: over 3 dB gain reduction, or over 5% of the reel touched | WARNING |
| Unintended silence | already exists (dead air at -50 dB, 0.8 s and up) | stays |
| Intermediate vs encoded | the same per-cue windows measured on `mix.wav` and on the MP4's audio; level differences over 1 dB, or an offset over 1 frame | WARNING (AAC or sync drift) |
| Integrated effects | kept as a sanity bound | FAIL above |

Tests in `tests/reel-checks.test.mjs`:
- A hero cue in a gap at -5 dB passes.
- The same cue over a word fails.
- Foley at -12 dB fails.
- A hero cue at -20 dB fails as too quiet, and a planned hero with no cue fails as missing.
- A cue 150 ms late warns.
- A hero cue ducks under the next word within 250 ms in the `reelmix` output.

## 6. Sources and ears

### Openverse (CC0 only)
- Search: `https://api.openverse.org/v1/audio/?q=<query>&license=cc0,pdm`. Codex: check the current rate limits, and
  whether anonymous access is enough or OAuth client credentials are needed. Any key goes in `.env`.
- New script: `scripts/sfx/fetch-openverse.mjs <project> --query "stadium crowd cheer" --role hero --n 8`.
  It downloads candidates to `assets/sfx/candidates/`.
- For each candidate, open the **original source page** (Freesound, Wikimedia, ...) and confirm it is CC0 there. Drop
  it if the source disagrees or can't be reached. Record the source URL, creator, licence, licence URL, the date
  checked and sha256 in `assets/sfx/provenance.md`.
- Keep a local reusable library at `assets-library/sfx/` (gitignored) holding only files that have a provenance row.
  Search it before searching Openverse again.

### earshot (https://github.com/Leonxlnx/earshot)
- Install for Claude Code: `uv tool install "earshot[mcp] @ git+https://github.com/Leonxlnx/earshot"`, then
  `earshot doctor --fetch` (about 1.1 GB of models, one time), then
  `claude mcp add earshot --scope user -e EARSHOT_THREADS=3 -- earshot mcp`.
- Never use `earshot llm`, which uploads audio to Gemini. Record "local only" in `docs/TOOLS-AND-API-KEYS.md`.
- Uses:
  - `rank` / `match` to pre-select candidates against the cue's intent.
  - `realness` as a WARNING on hero cues that sound synthesized.
  - `timeline` / `sheet` to save a review PNG in `<candidate>.qa/audio/`.
  - `measure` as a cross-check on the ffmpeg numbers.
- `critique` is not used for scores. It is calibrated on launch films. The house profile comes from approved reels (§7).
- Optional everywhere. Without earshot, its QA rows become NOT TESTED and nothing else changes.
- earshot's judgements are imperfect. It can't judge emotional impact, and Mits's listening stays the approval.

## 7. Claude Arena v003: three controlled versions

The visual edit is the same for all three. Only the mix differs, and there are real CC0 crowd cues at s00 (boo) and
s08 (roar), plus s07's last-one-standing beat if it earns it.

| Version | Foley | Accents | Hero (in gap) | Bed |
| --- | --- | --- | --- | --- |
| A Balanced | -22 dB | -18 dB | -8 dB | current |
| B Cinematic | -24 dB | -19 dB | -4 dB, a longer build and a dip in the bed before the payoff | 2 dB lower under speech |
| C High-energy | -20 dB | -16 dB | -3 dB, a faster build | current |

- Render `renders/claude-arena-candidate-v003-a/b/c.mp4`. This needs `render-reel` to accept a suffix, or a mix
  variant argument that reuses the picture.
- For each one, report: integrated LUFS, true peak, limiter load, and every hero and accent level as measured on the
  MP4.
- Mits listens on his phone and picks one. The pick, with its numbers, becomes `docs/AUDIO-HOUSE-PROFILE.md` and the
  QA defaults. The table is rewritten as each later approved reel adds data.
- `renders/final.mp4` stays v001 until Mits approves one of these by name.

## 8. CompanyEnrich logos (separate track)

- `https://api.companyenrich.com/logo/{domain}`, used on claude-plugins-roles with its provenance in
  `assets/brand/logos/`. Add it to `docs/TOOLS-AND-API-KEYS.md` as a candidate source. Before first use: confirm it
  still answers and read its terms. It returns 200 × 200 JPEGs, so prefer official media kits for anything shown large.

## 9. Order of work

1. `reelmix.py` (move the existing duck and guard into it, then add per-cue roles), `cues.json`, and the QA checks in
   §5 with tests. `npm test`, then `npm run sync:skills`.
2. Openverse fetch, with licence verification at the source.
3. earshot install (Claude Code MCP) and its optional QA rows.
4. claude-arena v003 A/B/C, measured, then Mits listens.
5. House profile and QA defaults from his pick. Update `short-form-edit` SKILL step 5, `docs/EDITING-PLAYBOOK.md` and
   `create-reel/references/qa.md`. These replace the current single -16 / -18 limit.
6. Logo docs.

Done when QA fails a mix that is too loud, a hero moment that is too quiet or missing, and a cue that is badly late.
It passes one where foley stays subtle and the heroes swell in the gaps. And Mits picks a v003 version on his phone.

## 10. Technical concerns

1. **Not every reel has a gap.** House style removes pauses (gaps under about 0.2 s). A hero cue needs one, so the
   edit has to keep a beat on purpose (about 0.4-0.8 s) where a hero lands. claude-arena may need a small re-cut at
   s08, which is a creative change, and preflight would then ask for re-approval. Checked: claude-arena already has a
   0.47 s gap after "survived the fight." (33.59-34.06 s). That is the natural home for the roar, peaking there and
   tailing under "To install". No re-cut is needed for A/B/C. Widening that gap to about 0.7 s is an option for B only,
   and it would need re-approval. Every other gap in this reel is under 0.3 s, so s00's boo and s07 stay accents over
   or around speech.
2. **The CC0 pool is thinner.** Good CC0 crowd recordings exist (mostly Freesound) but are fewer. Openverse's licence
   metadata can be wrong, hence the check at the source. If no candidate passes, the fallback is a better-synthesized
   crowd, flagged as synthesized.
3. **earshot on Windows** is unverified, and so is the licence of its SFX bank. Codex: install it, run `doctor`, time
   one QA call, and read the licence of the bank before using any of it.
4. **Masking is a proxy.** A band-energy check flags likely trouble but can't prove a word is intelligible. No local
   speech recognition is configured. Listening decides.
5. **A three-version render** costs about 3× render time unless the picture is rendered once and only the audio is
   muxed per version. Prefer the mux. The picture is identical.
6. **The level basis must match everywhere.** The mixer, QA and the house profile all use the loudest K-weighted
   400 ms window of each cue against the median speaking level. If the windows differ, the numbers drift again.
7. **The uncommitted working tree** holds the single-limit QA and docs from v002. Codex should build on it. If it
   isn't on this machine, Mits needs to commit and push to his fork (origin) first.

## Context for Codex

- Current QA: `sfxPerceived`, `kWeight`, `audioBalance` in `.claude/skills/create-reel/scripts/qa-core.mjs`, with tests
  in `tests/reel-checks.test.mjs`.
- claude-arena: the v002 mix is `video-projects/claude-arena/scripts/audio.py`, the v001 audio is in `archive/audio-v001/`,
  and the approved final is still v001.
- Edit skills in `.claude/skills/`, then run `npm run sync:skills`. Follow `CLAUDE.md` / `AGENTS.md`.
