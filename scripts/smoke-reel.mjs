#!/usr/bin/env node
// Optional integration exercise for Reel Studio: a real HyperFrames render of a 2 s synthetic vertical Reel, real full QA,
// and the approval command. No personal media, no API calls. Needs Chrome, ffmpeg and python like a real render.
// Writes to tmp/reel-smoke-<time>/ (gitignored). The approvals here are automated test approvals of synthetic plans and files.
// Gate B: a new reel is refused until its creative preflight is approved; a legacy reel and a brand reel also render for real.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..');
const scripts = join(root, '.claude/skills/create-reel/scripts');
const { getProfile } = await import('../.claude/skills/create-reel/scripts/lib.mjs');
const { convertToVertical } = await import('../.claude/skills/create-reel/scripts/new-reel.mjs');
const { sha256File, recordPathFor, finalPath } = await import('../.claude/skills/create-reel/scripts/qa-core.mjs');
const { facelessPlan, footagePlan, brandPlan, readyAsset, writePlan } = await import('../tests/fixtures/visual-plans.mjs');

const slug = 'reel-smoke';
const dir = join(root, `tmp/reel-smoke-${Date.now()}`, slug);
cpSync(join(root, 'examples/starter'), dir, { recursive: true });
for (const d of ['assets', 'compositions', 'renders']) mkdirSync(join(dir, d), { recursive: true });
copyFileSync(join(root, 'node_modules/gsap/dist/gsap.min.js'), join(dir, 'assets/gsap.min.js'));
convertToVertical(dir, { slug, profile: getProfile('organic'), duration: 2, mode: 'faceless', title: 'Reel smoke', style: 'kallaway' });
// A final render needs the creative direction on record (reel.json "direction").
const direct = d => { const p = join(d, 'reel.json'), r = JSON.parse(readFileSync(p, 'utf8'));
  r.direction = { hook: 'Smoke test hook', coreClaim: 'The pipeline holds', heroBeat: 'the candidate', motif: 'a flat colour field', style: r.style };
  writeFileSync(p, JSON.stringify(r, null, 2)); };
direct(dir);
const nodeIn = (d, script, args) => spawnSync(process.execPath, [join(scripts, script), d, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const node = (script, args) => nodeIn(dir, script, args);
// Gate B: the fingerprint the read-only report prints, then an automated test approval of that exact plan.
const approvePlan = d => {
  const fp = JSON.parse(nodeIn(d, 'preflight-reel.mjs', ['--json']).stdout).fingerprint;
  return nodeIn(d, 'preflight-reel.mjs', ['--approve', '--fingerprint', fp.slice(0, 12), '--approved-by', 'smoke-test (automated, synthetic plan)']);
};
const scaffold = (s, mode, duration, extra = {}) => {
  const d = join(dir, '..', s);
  cpSync(join(root, 'examples/starter'), d, { recursive: true });
  for (const x of ['assets', 'compositions', 'renders']) mkdirSync(join(d, x), { recursive: true });
  copyFileSync(join(root, 'node_modules/gsap/dist/gsap.min.js'), join(d, 'assets/gsap.min.js'));
  convertToVertical(d, { slug: s, profile: getProfile('organic'), duration, mode, title: s, ...extra });
  direct(d);
  return d;
};
const steps = [];
const step = (name, r, expect) => {
  steps.push({ name, exit: r.status });
  if (r.status !== expect) { console.error(r.stdout + r.stderr); throw new Error(`${name}: exit ${r.status}, expected ${expect}`); }
  console.log(`ok  ${name}`);
};

step('source-only QA', node('qa-reel.mjs', ['--source-only']), 0);
assert.equal(JSON.parse(readFileSync(join(dir, 'renders/source.qa/qa.json'), 'utf8')).verdict, 'SOURCE_VALIDATED', 'source-only QA never reports VERIFIED');
const refused = node('render-reel.mjs', ['--draft', '--workers', '1']);
step('Gate B refuses a draft of a new reel with no approved plan', refused, 1);
assert.match(refused.stderr, /Render refused: the creative preflight \(Gate B\)[\s\S]*no assets\/plan\.json/);
writePlan(dir, facelessPlan(2));
step('Gate B refuses an unapproved plan', node('render-reel.mjs', ['--draft', '--workers', '1']), 1);
step('creative preflight approved (automated test approval)', approvePlan(dir), 0);
step('draft render + quick checks', node('render-reel.mjs', ['--draft', '--workers', '1']), 0);
assert.equal(JSON.parse(readFileSync(join(dir, `renders/${slug}-draft-v001.qa/quick.json`), 'utf8')).verdict, 'DRAFT_CHECKED');
step('final render + full QA (Stage 1)', node('render-reel.mjs', ['--final', '--workers', '1']), 0);
const cand = join(dir, `renders/${slug}-candidate-v001.mp4`);
const record = JSON.parse(readFileSync(recordPathFor(dir, cand), 'utf8'));
assert.equal(record.technicallyVerified, true);
assert.equal(record.sha256, await sha256File(cand));
const ran = new Set(record.results.filter(r => r.status !== 'NOT TESTED').map(r => r.area));
for (const area of ['Herk', 'HyperFrames', 'Clock', 'Layout', 'Fonts', 'Render']) assert.ok(ran.has(area), `real ${area} checks ran`);
const res = check => record.results.find(r => r.check.startsWith(check));
assert.equal(res('creative preflight approved').status, 'PASS', 'Gate B row');
assert.equal(res('validate-plan: visual plan').status, 'PASS', 'Mode A visual plan at the production stage');
assert.equal(res('planned callbacks: named elements').status, 'PASS', 'a conceptual callback needs no element');
assert.equal(res('each declared face loaded from its local file').status, 'PASS', 'local fonts loaded');
assert.equal(res('no network font requests').status, 'PASS');
assert.equal(res('event frames from the encoded video').status, 'PASS', 'event frames extracted from the MP4');
step('approve verified candidate', node('approve-reel.mjs', ['--candidate', `renders/${slug}-candidate-v001.mp4`, '--sha', record.sha256.slice(0, 12), '--approved-by', 'smoke-test (automated, synthetic file)']), 0);
assert.equal(await sha256File(finalPath(dir)), record.sha256);
step('second final render + full QA', node('render-reel.mjs', ['--final', '--workers', '1']), 0);
const v2 = join(dir, `renders/${slug}-candidate-v002.mp4`);
const r2 = JSON.parse(readFileSync(recordPathFor(dir, v2), 'utf8'));
appendFileSync(v2, 'tampered');
step('approval refuses a candidate modified after QA', node('approve-reel.mjs', ['--candidate', `renders/${slug}-candidate-v002.mp4`, '--sha', r2.sha256.slice(0, 12), '--approved-by', 'smoke-test']), 1);
assert.equal(await sha256File(finalPath(dir)), record.sha256, 'approved final unchanged');

// Mode B: real qa-reel on the public short-form records plus a synthetic source transcript and a synthetic 4 s
// candidate with audio (not a render of that plan; it exercises the footage checks, clips and audio analysis).
const bSlug = 'reel-smoke-footage';
const b = join(dir, '..', bSlug);
cpSync(join(root, 'examples/starter'), b, { recursive: true });
for (const d of ['assets', 'compositions', 'renders']) mkdirSync(join(b, d), { recursive: true });
copyFileSync(join(root, 'node_modules/gsap/dist/gsap.min.js'), join(b, 'assets/gsap.min.js'));
convertToVertical(b, { slug: bSlug, profile: getProfile('organic'), duration: 4, mode: 'footage', title: 'Footage smoke' });
direct(b);
for (const f of ['plan.json', 'transcript.json', 'edit-decisions.json']) copyFileSync(join(root, 'examples/short-form/assets', f), join(b, 'assets', f));
// Schema v2 for Mode B: an authentic still in a split scene, ready and hashed, and an approved creative preflight.
writePlan(b, readyAsset(b, footagePlan(), 's01', 'assets/broll/seed.png'));
step('Mode B creative preflight approved (automated test approval)', approvePlan(b), 0);
const kept = JSON.parse(readFileSync(join(b, 'assets/transcript.json'), 'utf8')).words.map(w => ({ text: w.text, start: w.sourceStart, end: w.sourceEnd }));
writeFileSync(join(b, 'assets/source-transcript.json'), JSON.stringify({ words: [{ text: "Don't", start: 0.3, end: 0.6 }, ...kept] }));
const bCand = `renders/${bSlug}-candidate-v001.mp4`;
const mk = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x334455:s=1080x1920:r=30:d=4', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(b, bCand)], { windowsHide: true });
assert.equal(mk.status, 0);
const bq = spawnSync(process.execPath, [join(scripts, 'qa-reel.mjs'), b, '--render', bCand], { encoding: 'utf8', windowsHide: true });
const bRec = JSON.parse(readFileSync(recordPathFor(b, join(b, bCand)), 'utf8'));
const by = c => bRec.results.find(r => r.check.startsWith(c));
for (const c of ['reel.json direction recorded', 'creative preflight approved', 'no cut splits a spoken word', 'retained transcript equals', 'validate-plan: source', 'validate-plan: visual plan', 'caption words and timing', 'EDL duration'])
  assert.equal(by(c)?.status, 'PASS', `${c}: ${JSON.stringify(by(c))}`);
assert.ok(['PASS', 'WARNING'].includes(by('integrated loudness')?.status), 'audio analysis ran (a quiet test tone may WARN)');
assert.equal(by('cuts that remove')?.status, 'WARNING', 'removed "Don\'t" is flagged');
assert.equal(by('review clips')?.status, 'PASS');
assert.equal(bq.status, bRec.technicallyVerified ? 0 : 1);
steps.push({ name: 'Mode B QA on synthetic footage records', exit: bq.status, verdict: bRec.verdict, blocking: bRec.blocking.map(r => r.check) });
console.log(`ok  Mode B QA (${bRec.verdict})`);

// Legacy: a reel.json from before Gate B renders exactly as before, with no plan and no preflight.
const legacy = scaffold('reel-smoke-legacy', 'faceless', 2);
{ const p = join(legacy, 'reel.json'), r = JSON.parse(readFileSync(p, 'utf8')); delete r.preflightRequired; delete r.preflight; writeFileSync(p, JSON.stringify(r, null, 2)); }
step('legacy reel renders a draft without any preflight', nodeIn(legacy, 'render-reel.mjs', ['--draft', '--workers', '1']), 0);
const legacyQa = nodeIn(legacy, 'qa-reel.mjs', ['--source-only']);
assert.match(legacyQa.stdout, /NOT APPLICABLE\s+\[Preflight\] creative preflight approved and unchanged \(Gate B\): legacy reel/);

// Mode C, brand: a paid generated plate and the official mark, joined by a callback on a named element that the
// starter does not contain, so the callback row warns (it never fails) and the paid plan is noted without a scope.
const brand = scaffold('reel-smoke-brand', 'brand', 2);
const bp = brandPlan(2);
readyAsset(brand, bp, 's01', 'assets/plates/beans.png'); readyAsset(brand, bp, 's02', 'assets/brand/logo.png');
writePlan(brand, bp);
step('brand reel refused before approval', nodeIn(brand, 'render-reel.mjs', ['--draft', '--workers', '1']), 1);
step('brand creative preflight approved (automated test approval)', approvePlan(brand), 0);
const brandDraft = nodeIn(brand, 'render-reel.mjs', ['--draft', '--workers', '1']);
step('brand reel renders a draft after approval', brandDraft, 0);
assert.match(brandDraft.stderr, /Preflight note: .*paid assets planned \(s01\)/);
const brandQa = nodeIn(brand, 'qa-reel.mjs', ['--source-only']);
assert.match(brandQa.stdout, /PASS\s+\[Preflight\] creative preflight approved and unchanged/);
assert.match(brandQa.stdout, /PASS\s+\* \[Herk\] validate-plan: visual plan \(schema v2\)/);
assert.match(brandQa.stdout, /WARNING\s+\[Visual\] planned callbacks: named elements exist in the source \(rendered transition not verified, Phase 2\): not found: #grinder-mark/);
steps.push({ name: 'brand source QA', exit: brandQa.status });
console.log('ok  brand source QA (callback row is a warning, not a failure)');
console.log(JSON.stringify({ passed: true, project: dir, counts: record.counts, steps }, null, 2));
