#!/usr/bin/env node
// Optional integration exercise for Reel Studio: a real HyperFrames render of a 2 s synthetic vertical Reel, real full QA,
// and the approval command. No personal media, no API calls. Needs Chrome, ffmpeg and python like a real render.
// Writes to tmp/reel-smoke-<time>/ (gitignored). The approval here is an automated test approval of a synthetic file.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..');
const scripts = join(root, '.claude/skills/create-reel/scripts');
const { getProfile } = await import('../.claude/skills/create-reel/scripts/lib.mjs');
const { convertToVertical } = await import('../.claude/skills/create-reel/scripts/new-reel.mjs');
const { sha256File, recordPathFor, finalPath } = await import('../.claude/skills/create-reel/scripts/qa-core.mjs');

const slug = 'reel-smoke';
const dir = join(root, `tmp/reel-smoke-${Date.now()}`, slug);
cpSync(join(root, 'examples/starter'), dir, { recursive: true });
for (const d of ['assets', 'compositions', 'renders']) mkdirSync(join(dir, d), { recursive: true });
copyFileSync(join(root, 'node_modules/gsap/dist/gsap.min.js'), join(dir, 'assets/gsap.min.js'));
convertToVertical(dir, { slug, profile: getProfile('organic'), duration: 2, mode: 'faceless', title: 'Reel smoke', style: 'kallaway' });
const node = (script, args) => spawnSync(process.execPath, [join(scripts, script), dir, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const steps = [];
const step = (name, r, expect) => {
  steps.push({ name, exit: r.status });
  if (r.status !== expect) { console.error(r.stdout + r.stderr); throw new Error(`${name}: exit ${r.status}, expected ${expect}`); }
  console.log(`ok  ${name}`);
};

step('draft render + quick checks', node('render-reel.mjs', ['--draft', '--workers', '1']), 0);
assert.ok(existsSync(join(dir, `renders/${slug}-draft-v001.qa/quick.json`)));
step('final render + full QA (Stage 1)', node('render-reel.mjs', ['--final', '--workers', '1']), 0);
const cand = join(dir, `renders/${slug}-candidate-v001.mp4`);
const record = JSON.parse(readFileSync(recordPathFor(dir, cand), 'utf8'));
assert.equal(record.technicallyVerified, true);
assert.equal(record.sha256, await sha256File(cand));
const ran = new Set(record.results.filter(r => r.status !== 'NOT TESTED').map(r => r.area));
for (const area of ['Herk', 'HyperFrames', 'Clock', 'Layout', 'Fonts', 'Render']) assert.ok(ran.has(area), `real ${area} checks ran`);
const res = check => record.results.find(r => r.check.startsWith(check));
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
for (const f of ['plan.json', 'transcript.json', 'edit-decisions.json']) copyFileSync(join(root, 'examples/short-form/assets', f), join(b, 'assets', f));
const kept = JSON.parse(readFileSync(join(b, 'assets/transcript.json'), 'utf8')).words.map(w => ({ text: w.text, start: w.sourceStart, end: w.sourceEnd }));
writeFileSync(join(b, 'assets/source-transcript.json'), JSON.stringify({ words: [{ text: "Don't", start: 0.3, end: 0.6 }, ...kept] }));
const bCand = `renders/${bSlug}-candidate-v001.mp4`;
const mk = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x334455:s=1080x1920:r=30:d=4', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(b, bCand)], { windowsHide: true });
assert.equal(mk.status, 0);
const bq = spawnSync(process.execPath, [join(scripts, 'qa-reel.mjs'), b, '--render', bCand], { encoding: 'utf8', windowsHide: true });
const bRec = JSON.parse(readFileSync(recordPathFor(b, join(b, bCand)), 'utf8'));
const by = c => bRec.results.find(r => r.check.startsWith(c));
for (const c of ['no cut splits a spoken word', 'retained transcript equals', 'validate-plan', 'caption words and timing', 'EDL duration'])
  assert.equal(by(c)?.status, 'PASS', `${c}: ${JSON.stringify(by(c))}`);
assert.ok(['PASS', 'WARNING'].includes(by('integrated loudness')?.status), 'audio analysis ran (a quiet test tone may WARN)');
assert.equal(by('cuts that remove')?.status, 'WARNING', 'removed "Don\'t" is flagged');
assert.equal(by('review clips')?.status, 'PASS');
assert.equal(bq.status, bRec.technicallyVerified ? 0 : 1);
steps.push({ name: 'Mode B QA on synthetic footage records', exit: bq.status, verdict: bRec.verdict, blocking: bRec.blocking.map(r => r.check) });
console.log(`ok  Mode B QA (${bRec.verdict})`);
console.log(JSON.stringify({ passed: true, project: dir, counts: record.counts, steps }, null, 2));
