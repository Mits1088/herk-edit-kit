// Schema v2 plans for the three Reel Studio modes, shared by the tests and scripts/smoke-reel.mjs.
// Synthetic content only; no personal media. Each builder returns a fresh object the caller may mutate.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '../..');

// Mode A, faceless: a designed graphic and a rebuilt UI, joined by a conceptual callback (no shared element).
export function facelessPlan(duration = 2) {
  const half = duration / 2;
  return {
    schemaVersion: 2, duration, fps: 30,
    script: 'Most to-do lists fail on day three.',
    motifs: [{ id: 'card', description: 'a folding card that holds the whole list', activeRange: [0, duration] }],
    scenes: [
      { id: 's01', start: 0, end: half, layout: 'paper', kind: 'list-fold', visualPurpose: 'explanation', brollMode: 'designed', evidenceType: 'illustrative',
        visualIntent: 'A long to-do list folds itself into one card on "fail", so the viewer sees the list collapse before the claim lands.',
        asset: { ref: 'folding list card', source: 'designed in the composition', method: 'design', paid: false,
          whyThis: 'The fold turns the claim into an action; a stock clip of someone writing a list would only name the topic.' },
        motifs: ['card'], carryOut: [{ to: 's02', motif: 'card', state: 'folded' }] },
      { id: 's02', start: half, end: duration, layout: 'paper', kind: 'calendar', visualPurpose: 'evidence', brollMode: 'ui-mock', evidenceType: 'reconstructed',
        visualIntent: 'The folded card lands on a rebuilt calendar at day three, and the viewer sees exactly where the plan breaks.',
        asset: { ref: 'calendar day-three view', source: 'rebuilt from the brief', method: 'design', paid: false,
          whyThis: 'A dated calendar makes "day three" concrete; another text card would repeat the narration.' },
        motifs: ['card'], carryIn: [{ from: 's01', motif: 'card' }] },
    ],
    events: [{ time: 0, type: 'fold', visual: 's01' }, { time: half, type: 'land', visual: 's02' }],
  };
}

// Mode B, footage: the public short-form fixture, upgraded. A talking-head hold, then an authentic still above the speaker.
export function footagePlan() {
  const plan = JSON.parse(readFileSync(join(root, 'examples/short-form/assets/plan.json'), 'utf8'));
  plan.schemaVersion = 2;
  plan.motifs = [{ id: 'seed', description: 'the seed the speaker tells you to start with' }];
  Object.assign(plan.scenes[0], { visualPurpose: 'performance', brollMode: 'none', evidenceType: 'none',
    holdReason: 'The speaker delivers the hook; the face carries it.' });
  Object.assign(plan.scenes[1], { layout: 'split', visualPurpose: 'evidence', brollMode: 'screenshot', evidenceType: 'authentic',
    visualIntent: 'The real seed packet photo sits above the speaker on "Start small", so the viewer sees the exact first step.',
    asset: { ref: 'seed packet photo', source: 'supplied by the creator', method: 'have', paid: false, status: 'planned',
      whyThis: 'It shows the first step the speaker names, instead of a generic gardening stock clip.' },
    motifs: ['seed'] });
  return plan;
}

// Mode C, brand: a generated surface plate (illustrative, paid) and the official mark, joined by a callback on a named element.
export function brandPlan(duration = 2) {
  const half = duration / 2;
  return {
    schemaVersion: 2, duration, fps: 30,
    script: 'Grind fresh.',
    motifs: [{ id: 'mark', description: 'the grinder mark that ends as the logo', activeRange: [0, duration] }],
    scenes: [
      { id: 's01', start: 0, end: half, layout: 'paper', kind: 'bean-plate', visualPurpose: 'metaphor', brollMode: 'generated-image', evidenceType: 'illustrative',
        visualIntent: 'A key light sweeps across a generated espresso-bean surface, so the viewer feels the material before the product appears.',
        asset: { ref: 'espresso bean surface plate', source: 'generated', method: 'generate', provider: 'kie', paid: true,
          whyThis: 'A lit material plate belongs to this grinder; a stock coffee pour could advertise any cafe.' },
        motifs: ['mark'], carryOut: [{ to: 's02', motif: 'mark', element: 'grinder-mark' }] },
      { id: 's02', start: half, end: duration, layout: 'paper', kind: 'logo', visualPurpose: 'cta', brollMode: 'screenshot', evidenceType: 'authentic',
        visualIntent: 'The official mark settles out of the bean surface onto a clean ground, and the viewer reads the brand and the line "Grind fresh".',
        asset: { ref: 'official grinder logo', source: 'brand press kit (supplied)', method: 'have', paid: false, status: 'planned',
          whyThis: 'Only the real mark can sign off the film; a redrawn logo would misrepresent the brand.' },
        motifs: ['mark'], carryIn: [{ from: 's01', motif: 'mark', element: 'grinder-mark' }] },
    ],
    events: [{ time: 0, type: 'light-sweep', visual: 's01' }, { time: half, type: 'logo-land', visual: 's02' }],
  };
}

// Production: write a synthetic asset file into the project and mark the scene's asset ready with its hash.
export function readyAsset(dir, plan, sceneId, file, bytes = `synthetic asset for ${sceneId}`) {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), bytes);
  const s = plan.scenes.find(x => x.id === sceneId);
  Object.assign(s.asset, { status: 'ready', file, sha256: createHash('sha256').update(bytes).digest('hex') });
  return plan;
}

export const writePlan = (dir, plan) => { mkdirSync(join(dir, 'assets'), { recursive: true }); writeFileSync(join(dir, 'assets/plan.json'), JSON.stringify(plan, null, 2)); };

// A delivery review (ENTERTAINMENT-REVIEW.md "## Delivery review") for a plan: every scene described in the reviewer's
// own words. verdicts: { sceneId: 'partial' | 'missing' } overrides the default 'delivered'; skip drops scenes.
export function deliveryReviewText(plan, { render, sha, verdicts = {}, skip = [], seen = {}, motion = {}, notes = true } = {}) {
  const rows = plan.scenes.filter(s => !skip.includes(s.id)).map(s =>
    `| ${s.id} | ${s.kind || s.id} | ${seen[s.id] ?? `the encoded frame for ${s.id} shows its main object large and lit at phone size`} | ${motion[s.id] ?? 'the object enters from the left and settles'} | ${verdicts[s.id] || 'delivered'} | ${verdicts[s.id] ? 'rebuild it' : ''} |`);
  return ['# Entertainment review', '', 'Other findings stay above the delivery review.', '', '## Delivery review', '',
    `Reviewed render: ${render} (SHA-256 ${sha.slice(0, 12)})`, '',
    '| Scene | Intent (short) | Seen at phone size, sound off | Motion (strip) | Verdict | Fix |', '| --- | --- | --- | --- | --- | --- |', ...rows, '',
    ...(notes ? ['Modality: intent and motion sheets plus event frames; no full-speed viewing in this test.',
      'Silhouettes (labels ignored): every adjacent pair has a different shape and action.',
      'Keyframes: each encoded frame matches or beats its Gate B keyframe.',
      'Slide test: no frame would pass as a slide; the second scene is the screenshot frame.'] : []), ''].join('\n');
}
