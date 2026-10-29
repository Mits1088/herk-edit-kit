// Schema v2 visual plan: preflight and production validation, the creative fingerprint and the script policy.
// Every rule has a negative control. Plans are the synthetic per-mode fixtures in tests/fixtures/visual-plans.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { validateVisualPlan, validatePlan, genericIntent } from '../.claude/skills/short-form-edit/scripts/validate-plan.mjs';
import * as core from '../.claude/skills/create-reel/scripts/qa-core.mjs';
import { facelessPlan, footagePlan, brandPlan, readyAsset } from './fixtures/visual-plans.mjs';

const root = resolve(import.meta.dirname, '..');
const sf = name => JSON.parse(readFileSync(join(root, 'examples/short-form/assets', name), 'utf8'));
const errs = (plan, opts) => validateVisualPlan(plan, opts).errors;
const fails = (change, pattern, build = facelessPlan) => {
  const plan = build(); change(plan);
  const e = errs(plan);
  assert.ok(e.some(x => pattern.test(x)), `expected ${pattern} in ${JSON.stringify(e)}`);
  assert.ok(e.every(x => x.startsWith('Visual: ')), 'every visual error is prefixed');
};

test('the three mode fixtures pass the preflight stage with no asset files', () => {
  for (const build of [facelessPlan, footagePlan, brandPlan]) {
    const v = validateVisualPlan(build(), { stage: 'preflight', exists: () => false });
    assert.equal(v.ok, true, JSON.stringify(v.errors));
  }
  assert.deepEqual(validateVisualPlan(brandPlan()).metrics.paidAssets, ['s01']);
  assert.deepEqual(validateVisualPlan(footagePlan()).metrics.authenticScenes, ['s01']);
});

test('a plan with no motifs and no callbacks is valid: hard cuts and holds need no carry', () => {
  const plan = facelessPlan();
  delete plan.motifs; for (const s of plan.scenes) { delete s.motifs; delete s.carryOut; delete s.carryIn; }
  assert.deepEqual(errs(plan), []);
});

test('preflight rejects bad enums, missing metadata and a missing or empty asset plan', () => {
  fails(p => { p.schemaVersion = 1; }, /schemaVersion must be 2/);
  fails(p => { p.scenes[0].visualPurpose = 'decoration'; }, /visualPurpose "decoration" is not one of/);
  fails(p => { delete p.scenes[0].brollMode; }, /brollMode "undefined"/);
  fails(p => { p.scenes[0].evidenceType = 'true'; }, /evidenceType "true"/);
  fails(p => { delete p.scenes[0].visualIntent; }, /needs a visualIntent/);
  fails(p => { delete p.scenes[0].asset; }, /needs an asset plan/);
  fails(p => { p.scenes[0].asset.whyThis = ' '; }, /asset\.whyThis is empty/);
  fails(p => { p.scenes[0].asset.method = 'buy'; }, /asset\.method "buy"/);
  fails(p => { p.scenes[0].asset.paid = 'no'; }, /asset\.paid must be true or false/);
  fails(p => { p.scenes[1].start = 1.1; }, /gap or overlap at s02/);
  fails(p => { p.scenes[1].id = 's01'; }, /Duplicate scene s01/);
});

test('visualIntent: generic phrases fail, short specific intents only warn', () => {
  for (const g of ['interesting animation', 'Show automation.', 'B-roll of', 'stock footage', 'some cool transitions', 'a dynamic visual']) assert.equal(genericIntent(g), true, g);
  for (const s of ['tokens collapse 69 to 19', 'Kevin punches the README', 'stock footage of a 1950s switchboard operator plugging cables']) assert.equal(genericIntent(s), false, s);
  fails(p => { p.scenes[0].visualIntent = 'Interesting animation'; }, /only a generic description/);
  const plan = facelessPlan(); plan.scenes[0].visualIntent = 'Tokens collapse 69 to 19';
  const v = validateVisualPlan(plan);
  assert.equal(v.ok, true, 'a short specific intent is not an error');
  assert.ok(v.warnings.some(w => /visualIntent is short \(5 words\)/.test(w)));
});

test('truth rules separate authentic evidence from illustration and simulation', () => {
  fails(p => { p.scenes[1].brollMode = 'generated-video'; p.scenes[1].evidenceType = 'authentic'; }, /generated-video and cannot be authentic/);
  fails(p => { p.scenes[1].evidenceType = 'authentic'; }, /ui-mock and cannot be authentic/);
  fails(p => { p.scenes[0].evidenceType = 'none'; }, /evidenceType is none/);
  fails(p => { p.scenes[1].asset.source = 'generated'; }, /authentic but its source is "generated"/, brandPlan);
  fails(p => { p.scenes[1].layout = 'broll'; }, /layout broll needs moving footage .* not screenshot/, brandPlan);
  fails(p => { p.scenes[0].layout = 'broll-split'; p.scenes[0].brollMode = 'generated-image'; }, /needs moving footage .* not generated-image/, brandPlan);
});

test('motifs: unique ids, known references, ranges inside the reel that cover their scenes and handoffs', () => {
  fails(p => { p.motifs.push({ id: 'card', description: 'again' }); }, /Duplicate motif card/);
  fails(p => { p.motifs[0].description = ''; }, /Motif card has no description/);
  fails(p => { p.scenes[0].motifs = ['boat']; }, /s01 motifs names unknown motif boat/);
  fails(p => { p.motifs[0].activeRange = [0, 3]; }, /activeRange must be/);
  fails(p => { p.motifs[0].activeRange = [1, 1]; }, /activeRange must be/);
  fails(p => { p.motifs[0].activeRange = [1.2, 2]; }, /s01 uses motif card outside its activeRange/);
});

test('planned callbacks: targets exist, move forward in time, agree in both directions, and need no DOM element', () => {
  fails(p => { p.scenes[0].carryOut[0].to = 's09'; }, /carryOut targets unknown scene s09/);
  fails(p => { p.scenes[0].carryOut[0].to = 's01'; }, /carryOut targets itself/);
  fails(p => { p.scenes[1].carryIn = []; }, /carryOut card to s02 has no matching carryIn/);
  fails(p => { p.scenes[0].carryOut = []; }, /carryIn card from s01 has no matching carryOut/);
  fails(p => { p.scenes[0].carryOut[0].element = 'card-el'; }, /no matching carryIn/);
  fails(p => { p.scenes[1].carryOut = [{ to: 's01', motif: 'card' }]; p.scenes[0].carryIn = [{ from: 's02', motif: 'card' }]; }, /carryOut to s01 goes backwards in time/);
  fails(p => { p.scenes[0].carryOut[0].motif = 'boat'; }, /carryOut names unknown motif boat/);
  const v = validateVisualPlan(facelessPlan());
  assert.deepEqual(v.metrics.callbacks, [{ from: 's01', to: 's02', motif: 'card', element: null, adjacent: true }], 'a conceptual callback has no element');
});

test('production stage: planned files must exist and match their hash, including authentic stills in split layouts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'visual-plan-'));
  const exists = p => { try { readFileSync(join(dir, p)); return true; } catch { return false; } };
  const hash = p => createHash('sha256').update(readFileSync(join(dir, p))).digest('hex');
  const plan = footagePlan();
  assert.ok(errs(plan, { stage: 'production', exists, hash }).some(e => /s01 asset\.status is planned; production needs ready/.test(e)));
  readyAsset(dir, plan, 's01', 'assets/broll/seed.png');
  assert.deepEqual(errs(plan, { stage: 'production', exists, hash }), []);
  writeFileSync(join(dir, 'assets/broll/seed.png'), 'changed');
  assert.ok(errs(plan, { stage: 'production', exists, hash }).some(e => /asset hash mismatch for assets\/broll\/seed\.png/.test(e)));
  plan.scenes[1].asset.file = '../outside.png';
  assert.ok(errs(plan, { stage: 'production', exists, hash }).some(e => /must be a path inside the project/.test(e)));
  assert.deepEqual(errs(facelessPlan(), { stage: 'production', exists: () => false }), [], 'designed and ui-mock scenes have no file to check');
});

test('legacy plans validate exactly as before; v2 plans add visual errors that planChecks reports in their own row', () => {
  const plan = sf('plan.json'), transcript = sf('transcript.json'), edl = sf('edit-decisions.json');
  const legacy = validatePlan(plan, transcript, edl);
  assert.deepEqual(Object.keys(legacy), ['ok', 'errors', 'metrics'], 'no new fields on a legacy result');
  assert.equal(legacy.metrics.visual, undefined);
  const v2 = footagePlan(); v2.scenes[1].visualPurpose = 'decoration';
  const result = validatePlan(v2, transcript, edl);
  const rows = core.planChecks(result, v2);
  assert.equal(rows[0][2], 'PASS', 'visual errors never land in the source-mapping row');
  assert.equal(rows[1][2], 'PASS', 'or in the caption row');
  assert.equal(rows[2][2], 'FAIL');
  assert.match(rows[2][3], /visualPurpose "decoration"/);
});

test('fingerprint: stable under technical revisions, changed by creative decisions', () => {
  const reel = { mode: 'brand', profile: 'organic', direction: { hook: 'Grind fresh', coreClaim: 'Fresh beats stale', heroBeat: 'the mark lands', motif: 'the grinder mark', style: 'brand' } };
  const fp = (r, p) => core.creativeFingerprint(core.creativeSnapshot(r, p));
  const base = fp(reel, brandPlan());
  const same = [
    p => { p.scenes[0].end = p.scenes[1].start = 0.7; },
    p => { p.scenes[1].layout = 'split'; p.scenes[1].kind = 'logo-v2'; p.scenes[0].anchor = 'Grind'; },
    p => { p.events = []; p.captions = [{ start: 0, end: 1, words: [] }]; },
    p => { Object.assign(p.scenes[1].asset, { status: 'ready', file: 'assets/logo.png', sha256: 'b'.repeat(64) }); },
    p => { p.motifs[0].activeRange = [0, 1.5]; },
    p => { p.scenes[0].visualIntent = p.scenes[0].visualIntent.toUpperCase().replace(/,/g, ' ,  '); },
  ];
  for (const change of same) { const p = brandPlan(); change(p); assert.equal(fp(reel, p), base, change.toString()); }
  assert.equal(fp({ ...reel, renders: [{ file: 'x' }], approvals: [{}], preflight: { status: 'approved' } }, brandPlan()), base, 'records are not part of the plan');
  const differ = [
    p => { p.scenes[0].visualIntent = 'A different idea entirely, a pour of coffee into a white cup.'; },
    p => { p.scenes[1].asset.ref = 'stock logo animation'; },
    p => { p.scenes[1].asset.source = 'https://example.com/other-logo.svg'; },
    p => { p.scenes[0].asset.paid = false; },
    p => { p.scenes[0].brollMode = 'designed'; },
    p => { p.scenes[0].evidenceType = 'simulated'; },
    p => { p.motifs[0].description = 'a coffee bean'; },
    p => { p.scenes.reverse(); },
  ];
  for (const change of differ) { const p = brandPlan(); change(p); assert.notEqual(fp(reel, p), base, change.toString()); }
  assert.notEqual(fp({ ...reel, direction: { ...reel.direction, hook: 'Buy now' } }, brandPlan()), base);
  assert.notEqual(fp({ ...reel, mode: 'faceless' }, brandPlan()), base);
  const changed = brandPlan(); changed.scenes[0].brollMode = 'designed';
  assert.deepEqual(core.diffSnapshot(core.creativeSnapshot(reel, brandPlan()), core.creativeSnapshot(reel, changed), changed), ['scene 1 (s01) brollMode "generated-image" -> "designed"']);
});

test('script policy: fillers, stutters, case and punctuation pass; negations, numbers, qualifiers and new words do not', () => {
  const w = s => core.scriptWords({ script: s }, null);
  assert.deepEqual(core.scriptChanges(w('Um, so you know, I I start small.'), w('I start small')), []);
  assert.deepEqual(core.scriptChanges(w('START SMALL!'), w('start small')), []);
  const show = (a, b) => core.scriptChanges(w(a), w(b)).map(c => `${c.type} ${c.word} ${c.risk ?? ''}`.trim());
  assert.deepEqual(show('It does not work', 'It does work'), ['removed not negation']);
  assert.deepEqual(show('13,000 stars', '1,300 stars'), ['removed 13000 number', 'added 1300 number']);
  assert.deepEqual(show('It only takes a minute', 'It takes a minute'), ['removed only qualifier']);
  assert.deepEqual(show('Start small', 'Start big'), ['removed small', 'added big']);
  assert.deepEqual(show('Start small', 'Start small um'), ['added um'], 'adding words is a change, even a filler');
  assert.equal(core.scriptWords({}, { words: [{ text: 'Hi', type: 'word' }, { text: ' ', type: 'spacing' }] })[0], 'hi', 'a transcript wins over the plan script');
  assert.equal(core.scriptWords({}, null), null, 'a silent piece has no script');
});

test('preflightStatus: legacy reels are not gated; new reels need a valid, approved, unchanged plan', () => {
  const validate = validateVisualPlan;
  assert.deepEqual(core.preflightStatus({ reel: { mode: 'footage' }, plan: sf('plan.json'), validate }), { required: false, ok: true, problems: [], warnings: [] });
  const reel = { preflightRequired: true, mode: 'faceless', direction: {} };
  assert.match(core.preflightStatus({ reel, plan: null, validate }).problems[0], /no assets\/plan\.json/);
  const s = core.preflightStatus({ reel, plan: facelessPlan(), validate });
  assert.equal(s.ok, false);
  assert.match(s.problems.join(' '), /no approved creative preflight/);
  const approved = { ...reel, preflight: { status: 'approved', fingerprint: s.fingerprint, snapshot: s.snapshot, scriptWords: s.words } };
  assert.equal(core.preflightStatus({ reel: approved, plan: facelessPlan(), validate }).ok, true);
  assert.equal(core.preflightStatus({ reel: { mode: 'faceless' }, plan: facelessPlan(), validate }).required, true, 'a v2 plan opts in by itself');
});
