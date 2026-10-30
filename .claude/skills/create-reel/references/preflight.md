# Gate B: the creative preflight

Every new Reel stops here once, before paid asset generation, full composition building or any `render-reel` run,
even when the brief says to build it end to end. The person approves one creative direction; after that, production,
renders, QA and ordinary revisions continue without asking again. Stage 2 (approving the final file) is unchanged.

`new-reel` writes `"preflightRequired": true` into `reel.json`, and `render-reel` (draft and final) refuses until the
plan is approved and still matches. Projects created before Gate B have no such field and are not gated.

## Order of work

1. **Scaffold** with `new-reel` (local, free). Planning files live in the project from the start.
2. **Analyse the source**: brief, `brand/DESIGN.md`, supplied assets, and for footage the transcript (provider and
   cost per `docs/TOOLS-AND-API-KEYS.md`, with permission), then local silence and mistake cuts (Mode B owner rules).
3. **Story and openings**: hook, payoff, CTA; the existing openings rule (one rough opening plus two written
   alternatives, [modes.md](modes.md)). Before approval, show the rough opening in Studio preview or as static
   snapshots (`npx hyperframes snapshot --describe false`), never as a `render-reel` draft. Where it is feasible
   without paid production, also prepare three storyboard keyframes or equivalent static concepts (the hook, the
   hero beat, one more representative scene) so the person approves pictures, not only prose. Make them at the
   intended production fidelity, not as wireframes: they set the bar the build must meet or beat. Save each as
   `keyframes/<scene id>.png` (or `.jpg`), so QA's intent sheet shows it beside the encoded frame.
   If the person supplied a reference video, analyse it first (`short-form-edit/references/reference-analysis.md`):
   separate the techniques worth adopting from its distinctive styling, and list which ideas you adopt and why.
   Without a reference, plan normally.
4. **One visual world**: ground, light, material, type, and any motif that recurs if one helps
   (`motionmaxxing/references/world.md`; `video-storytelling` for persistent-world thinking). Decide what the visuals
   do with `short-form-edit/references/visual-principles.md`. Record it in `reel.json` `direction` and `DESIGN.md`.
5. **Each scene's visual**: `visualPurpose`, `brollMode`, `evidenceType`, and for every shown visual a specific
   `visualIntent` (what happens on screen, what the viewer understands) and an `asset` plan with `whyThis`.
   Talking-head holds are `performance` with `brollMode: none`; they need no motion and no carry.
6. **Asset gaps** (below): what exists, what must be captured, designed or generated, by what method, at what cost.
7. **Write** `DESIGN.md` and `assets/plan.json` with `"schemaVersion": 2`
   (`short-form-edit/references/plan-schema.md`). Times may be approximate; they can change later without approval.
8. **Validate**: `npm run preflight-reel -- video-projects/<slug>` (read-only; no asset files needed yet). Fix every
   problem it lists.
9. **Present the report** (template below) and **stop**.
10. **After the person explicitly approves**, in a later message than the report, record it:
    `npm run preflight-reel -- video-projects/<slug> --approve --fingerprint <12 hex> --approved-by "<name>"`.
    Then continue with production and the normal QA in `SKILL.md`.

Never run `--approve` on your own judgement, because a check passed, or on an approval given in the same message as the
report. The command is a workflow safeguard that ties an approval to one plan's fingerprint; it is not proof of who
approved, and anyone who can edit the project can run it.

## Paid generation

Approving the creative plan does **not** approve spending. Planned paid assets (`asset.paid: true`) are listed in the
report. Ask for the provider and a spending limit (and a maximum number of calls if useful) unless the person's own
instructions already set them, and record them only when given:
`--paid-provider <name> --spend-limit "<limit>" [--max-calls N]`. Without a recorded scope, ask before every paid call.
Stay inside the recorded scope; ask again before exceeding it.

## What keeps or invalidates the approval

The fingerprint covers creative decisions only: mode, profile, the five `direction` fields, motif ids and
descriptions, and in order each scene's purpose, B-roll mode, evidence type, intent, asset identity (`ref`, `source`,
`method`, `provider`, `paid`, `whyThis`) and planned callbacks. Text is compared ignoring case, spacing and punctuation.

- **Kept:** times and anchors, layout, `kind`, captions, events, animation, transitions, fonts, sound, an asset's
  `status`, `file` and `sha256`, renders and QA records. Script edits that only delete fillers (um, uh, er, erm, ah,
  hmm, like, basically, actually, literally, so, you know, I mean) or a stutter repeat, or change case or punctuation.
- **Invalidated:** any other script change (removed negations, numbers and qualifiers are listed first; removing a
  whole retake sentence counts too), a scene added, removed, split, merged or reordered, a changed visual purpose,
  mode, evidence type, intent or asset identity, a new paid asset, a changed motif or direction.

When `render-reel` refuses, it prints each problem and the field-level difference. Revise or restore the plan, or
present the changes and ask for a new approval.

## Asset-gap table

| Scene | Needed visual (intent) | Have | Gap | Method (have / capture / design / generate) | Paid? provider | Why this, not stock or a text card |
| --- | --- | --- | --- | --- | --- | --- |

Prefer, in order (`docs/EDITING-PLAYBOOK.md` B-roll): real footage of the thing named, a real screen recording, an
animated UI mock labelled as an example, concrete AI video metaphors, short crops of a real page. A generated still is
a plate, never B-roll. Never invent evidence; a reconstructed or simulated visual is declared as such.

## Editorial checklist (existing rules, applied at planning time)

- One reason to stay by second three, earned by the payoff (`short-form-edit/references/curiosity-and-entertainment.md`).
- Graphics show the example, relationship, evidence or consequence, not a third restatement of the caption
  (`short-form-edit/SKILL.md`, Design the emotional journey).
- No generic "person at a computer" or stock clip where a specific action exists (`docs/EDITING-PLAYBOOK.md`).
- Adjacent scenes with headings hidden do not repeat the same card reveal (`short-form-edit/SKILL.md`, entertaining).
- Every extended graphic has an action with an outcome; no settle-and-freeze cards and no idle motion for its own
  sake (`short-form-edit/references/quality-gates.md`, `motionmaxxing/references/slop.md`).
- Stillness is a choice: holds, hard cuts and the speaker's face carrying a beat are valid (`holdReason`).
- Real logos and portraits only from verified sources; authentic, reconstructed, illustrative and simulated visuals
  are labelled honestly (`short-form-edit/SKILL.md`, Verify brand assets).

## Report template

Present this in the conversation (keep it short) and save the same facts in `DESIGN.md`:

1. **Mode, profile, length** and the one-line idea.
2. **Hook**: the chosen opening and the two alternatives, one line each; why the chosen one.
3. **World**: ground, light, type, and the recurring motif if there is one. With a reference: the techniques adopted
   and why, and what was deliberately not borrowed.
4. **Scene by scene, what the viewer sees** (`preflight-reel` prints the table): purpose, mode, evidence, intent, and
   why each visual is meaningful rather than generic.
5. **How the story works visually**, answered from the plan's existing fields (`preflight-reel` prints a read-only
   "Story mechanics" block to help; nothing in it is a target):
   - the primary visual mechanism, and what the viewer sees happen rather than simply appear (`visualIntent`, `events`);
   - which objects or concepts return and how they change, if any (`motifs`, `carryIn`/`carryOut`);
   - how the layouts serve attention (`layout`, `visualPurpose`);
   - which numerical claims deserve a visual demonstration and which are fine as speech;
   - where anticipation, motion and stillness go (`events`, `holdReason`);
   - why each visual beats generic footage or a title card (`asset.whyThis`).
   Plain footage, a simple demonstration or the speaker's face are valid answers.
   Planned callbacks: say plainly that they are planned and built per scene, not verified rendered transitions.
   Keyframes: the three static concepts, if prepared.
6. **Authentic versus simulated**: which visuals are real evidence and which are reconstructed, illustrative or
   simulated.
7. **Assets and cost**: the asset-gap table, paid calls planned, and the provider and spending limit you are asking for.
8. **Fingerprint** (12 hex) and the question: "Do you approve this creative plan?"
