# Editable plan schema

Keep one canonical map. Seconds are on the edited timeline except fields prefixed
with `source`. Quantize cuts and scene boundaries to `1/fps`; retain precise ASR
word timings rather than rounding every word independently.

`assets/plan.json`:

```json
{
  "duration": 10,
  "fps": 30,
  "scenes": [{"id":"s00","start":0,"end":10,"layout":"face","kind":"hook","anchor":"First three words","anchorTime":0.1}],
  "events": [{"time":0,"type":"paper-tap","visual":"s00","anchor":"First three words"}],
  "captions": [{"start":0.1,"end":0.8,"words":[{"text":"First","start":0.1,"end":0.3,"sourceStart":1.1,"sourceEnd":1.3}]}]
}
```

Layouts are `face`, `split`, `paper`, `broll`, and `broll-split`. For this schema,
B-roll scene `kind` names `assets/<kind>.mp4`. `events` are actual meaningful
visual actions, never filler entries inserted only to satisfy cadence. Longer
holds can carry `holdReason` on their scene and must be justified editorially.

`assets/transcript.json` contains `words` with the same text/start/end/sourceStart/
sourceEnd fields and `text`. `assets/edit-decisions.json` contains `duration`, `fps`,
`keeps` with `{sourceStart,sourceEnd,start,end}`, and reviewed removal reasons.
Every retained word must map back to one kept range without crossing a removed
interval. `sourceStart` may be absent only when no edit was made; adapt validation
explicitly for that case rather than guessing a mapping.

## Creative companion

Keep creative reasoning in DESIGN.md alongside the technical map. It must name:

- Audience, requested aspect ratios, chosen visual direction, and asset shortlist.
- Three distinct opening concepts and their rough preview paths; the selected
  concept's benefit, viewer question, evidence visible by three seconds, and payoff.
- Sequence ranges with expectation, development, consequence, attention target,
  rhythm, and source rationale. Group related shots; avoid redundant per-frame prose.
- OPEN-LOOPS.json using the schema in curiosity-and-entertainment.md. Resolve each
  promised answer before the CTA; verify closure in the rendered sequence.
- Timestamped ENTERTAINMENT-REVIEW.md findings and revisions before polish.

The plan validator checks timing and coverage. It does not validate these creative
documents or certify engagement; review their claims against the rendered footage.

## Footage ledger

For projects with B-roll, `assets/footage-ledger.json` is an array of rows:

```json
[{"scene":"s02","sourceSceneId":"wallet-opening","asset":"assets/wallet.mp4",
"sha256":"<64 lowercase hex characters>","sourceStart":0.5,"sourceEnd":1.5,
"framing":{"9x16":"Full source contained; hands and wallet visible",
"16x9":"Full source contained; captions outside the action"}}]
```

Intervals refer to that exact local asset, before playback-speed adjustment.
Record upstream source provenance separately for downloaded excerpts. Scene
identity survives crop, grade, speed, reverse, and transcode changes. Each scene
appears once per reel; the same selection can be used in both requested ratios.
`validate-footage.mjs` verifies selected rows, file hashes, duplicate scene
identities, and overlapping intervals. Visual review must still establish that
the action and result remain visible and that differently encoded duplicates
have not evaded the source identity ledger.

## Schema v2: visual metadata (opt-in)

New Reel Studio reels add `"schemaVersion": 2` to the same `assets/plan.json`. A plan without it is v1 and is
validated exactly as before; nothing below applies to it. v2 adds fields; it never changes `scenes`, `events`,
`captions`, `kind`, `layout` or timing semantics.

Every scene:

| Field | Values |
| --- | --- |
| `visualPurpose` | `performance` (the speaker or a hold carries it), `evidence`, `explanation`, `metaphor`, `orientation`, `emphasis`, `callback`, `cta` |
| `brollMode` | `none` (speaker only); `source-footage`, `screen-recording`, `generated-video` (video files, also in the footage ledger); `screenshot` (an authentic still: a photographic layer, not moving B-roll); `designed` (HTML/GSAP graphic); `ui-mock` (rebuilt interface); `generated-image` (a plate only) |
| `evidenceType` | `authentic`, `reconstructed` (rebuilt from a real source), `illustrative` (a metaphor or diagram, not a claim), `simulated` (depicts something that did not happen as shown), `none` |

When `brollMode` is not `none`:

- `visualIntent`: what happens on screen and what the viewer understands from it. "Interesting animation" or
  "show automation" alone is rejected; a short but specific intent is accepted (under six words is only a warning).
- `asset`: `ref` (a stable name for the planned visual), `source` (URL, supplied file, or `generated`), `method`
  (`have`, `capture`, `generate`, `design`), `provider` (optional), `paid` (true/false), `whyThis` (why it beats stock
  footage or another text card). Production fields, filled when the asset exists: `status` (`planned`, `ready`),
  `file` (a path inside the project), `sha256`.

Optional: top-level `motifs: [{id, description, activeRange?: [start, end]}]` and `script` (planned narration for
Modes A and C before any voice exists); per scene `motifs: [id]`, `carryOut: [{to, motif, element?, state?}]` and
`carryIn: [{from, motif, element?}]`.

`carryOut`/`carryIn` are **planned callbacks**: the motif recurs in a later scene in a changed state. Each scene's own
composition builds it; no shared visual layer exists yet, and nothing verifies the rendered handoff. `element` is
optional: a conceptual callback needs no shared DOM element. No scene is required to carry anything; hard cuts,
holds and natural footage transitions remain valid. Coordinates are not part of Phase 1; when added they will be
root-composition CSS pixels (the profile's 1080x1920), top-left origin, before any camera transform.

Validation (`validateVisualPlan` in `validate-plan.mjs`; every error starts with `Visual:`):

- **Preflight stage** (before assets exist; used by create-reel's `preflight-reel`): contiguous scenes covering
  `duration`, valid values, required fields, unique motif ids, known motif and scene references, motif ranges inside
  the reel that overlap their scenes and span their handoffs, callbacks that move forward in time and agree in both
  directions, and truth rules: generated or mocked visuals are never `authentic`, an `authentic` visual has a
  non-generated source, a shown visual is never `evidenceType: none`, and a `broll` layout needs moving footage.
  It never checks files.
- **Production stage** (QA; `validatePlan` runs it for v2 plans): everything above, plus each `screenshot`,
  `source-footage`, `screen-recording` and `generated-*` scene is `ready` with a project file that matches its
  `sha256`. This is how authentic stills in `split` or `paper` layouts are tracked; moving footage still also needs
  its footage-ledger row.

Example (Mode B, two scenes; captions as in v1):

```json
{"schemaVersion":2,"duration":4,"fps":30,
 "motifs":[{"id":"seed","description":"the seed the speaker tells you to start with"}],
 "scenes":[
  {"id":"s00","start":0,"end":2,"layout":"face","kind":"hook","anchor":"Grow","anchorTime":0.1,
   "visualPurpose":"performance","brollMode":"none","evidenceType":"none","holdReason":"The face carries the hook."},
  {"id":"s01","start":2,"end":4,"layout":"split","kind":"payoff","anchor":"Start","anchorTime":2.1,
   "visualPurpose":"evidence","brollMode":"screenshot","evidenceType":"authentic","motifs":["seed"],
   "visualIntent":"The real seed packet photo sits above the speaker on \"Start small\", so the viewer sees the exact first step.",
   "asset":{"ref":"seed packet photo","source":"supplied by the creator","method":"have","paid":false,
    "whyThis":"It shows the step the speaker names, instead of a generic gardening stock clip.",
    "status":"ready","file":"assets/broll/seed.png","sha256":"<64 lowercase hex>"}}],
 "events":[{"time":0,"type":"title","visual":"s00","anchor":"Grow"}],
 "captions":[]}
```

Faceless and brand examples, with planned callbacks, are in `tests/fixtures/visual-plans.mjs`.
