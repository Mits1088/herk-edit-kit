// End to end on isolated synthetic data: dashboard hook approval -> real HyperFrames draft render -> real final render
// with full QA -> dashboard candidate approval. Everything lives in D:/herk-edit-kit/tmp/dash-e2e-<time>/ (gitignored).
// The dashboard is driven over HTTP, exactly as the page does it. No personal media, no API calls.
// Run: node dashboard/dev/e2e-reel.mjs  (needs Chrome, ffmpeg and python, like a real render; takes a few minutes)
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const repo = join(import.meta.dirname, '..', '..'); const U = p => pathToFileURL(join(repo, p)).href; const scripts = join(repo, '.claude/skills/create-reel/scripts');
const { loadConfig } = await import(U('dashboard/lib/config.mjs'));
const { createServer } = await import(U('dashboard/server.mjs'));
const { getProfile } = await import(U('.claude/skills/create-reel/scripts/lib.mjs'));
const { convertToVertical } = await import(U('.claude/skills/create-reel/scripts/new-reel.mjs'));
const { recordPathFor } = await import(U('.claude/skills/create-reel/scripts/qa-core.mjs'));
const { facelessPlan, writePlan, deliveryReviewText } = await import(U('tests/fixtures/visual-plans.mjs'));
const sha = f => createHash('sha256').update(readFileSync(f)).digest('hex');
const slug = 'e2e-reel'; const root = join(repo, 'tmp', `dash-e2e-${Date.now()}`); const dir = join(root, 'video-projects', slug);
mkdirSync(join(root, 'video-projects'), { recursive: true }); cpSync(join(repo, 'examples/starter'), dir, { recursive: true });
for (const d of ['assets', 'compositions', 'renders']) mkdirSync(join(dir, d), { recursive: true });
copyFileSync(join(repo, 'node_modules/gsap/dist/gsap.min.js'), join(dir, 'assets/gsap.min.js'));
convertToVertical(dir, { slug, profile: getProfile('organic'), duration: 2, mode: 'faceless', title: 'Dashboard e2e', style: 'kallaway' });
const rp = join(dir, 'reel.json'); const reel = () => JSON.parse(readFileSync(rp, 'utf8'));
{ const r = reel(); r.direction = { hook: 'Smoke test hook', coreClaim: 'The pipeline holds', heroBeat: 'the candidate', motif: 'a flat colour field', style: r.style }; writeFileSync(rp, JSON.stringify(r, null, 2)); }
writePlan(dir, facelessPlan(2));
const node = (script, args) => spawnSync(process.execPath, [join(scripts, script), dir, ...args], { encoding: 'utf8', windowsHide: true });
const ok = (name, r, expect = 0) => { if (r.status !== expect) { console.error(r.stdout + r.stderr); throw new Error(`${name}: exit ${r.status}, expected ${expect}`); } console.log('ok  ' + name); };

const cfg = loadConfig({ root, uploadsDir: join(root, 'Uploads'), missionCli: false }); const srv = createServer(cfg); await new Promise(r => srv.listen(4396, '127.0.0.1', r));
const base = 'http://localhost:4396'; const ID = 'video-e2e-reel';
const item = async () => (await (await fetch(base + '/api/state', { headers: { connection: 'close' } })).json()).items.find(i => i.id === ID);
const act = async body => { const r = await fetch(base + '/api/action', { method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify({ id: ID, ...body }) }); return { status: r.status, ...(await r.json()) }; };
try {
  ok('render is refused before the hook is approved', node('render-reel.mjs', ['--draft', '--workers', '1']), 1);
  ok('opening preview recorded', node('preflight-reel.mjs', ['--record-opening', '--end', '2']));
  let it = await item(); assert.equal(it.stage, 'hook'); assert.equal(it.project.hook.valid, true); assert.equal(it.project.hook.openingOk, true);
  let r = await act({ type: 'approve-hook', fingerprint: it.project.hook.fingerprint, watched: true }); assert.equal(r.status, 200, JSON.stringify(r));
  console.log('ok  dashboard approved the hook: ' + r.message);
  assert.equal(reel().preflight.status, 'approved'); it = await item(); assert.equal(it.stage, 'build');
  ok('draft render (real HyperFrames) + quick checks', node('render-reel.mjs', ['--draft', '--workers', '1']));
  const draft = `renders/${slug}-draft-v001.mp4`; node('qa-reel.mjs', ['--render', draft]);
  writeFileSync(join(dir, 'ENTERTAINMENT-REVIEW.md'), deliveryReviewText(facelessPlan(2), { render: draft, sha: reel().renders.at(-1).sha256 })); // automated review of a synthetic draft
  it = await item(); assert.equal(it.stage, 'build'); assert.equal(it.candidate, null);
  r = await act({ type: 'approve-candidate', sha: reel().renders.at(-1).sha256 }); assert.equal(r.status, 400); console.log('ok  a draft cannot be approved from the dashboard: ' + r.error);
  ok('final render (real HyperFrames) + full QA', node('render-reel.mjs', ['--final', '--workers', '1']));
  const cand = join(dir, `renders/${slug}-candidate-v001.mp4`); const rec = JSON.parse(readFileSync(recordPathFor(dir, cand), 'utf8'));
  assert.equal(rec.technicallyVerified, true); console.log(`ok  QA verdict ${rec.verdict}; ${rec.results.length} checks; areas: ${[...new Set(rec.results.filter(x => x.status !== 'NOT TESTED').map(x => x.area))].join(', ')}`);
  it = await item(); assert.equal(it.stage, 'candidate'); assert.equal(it.candidate.sha, rec.sha256); assert.equal(it.candidate.sha, sha(cand));
  const head = await fetch(`${base}/file?p=${encodeURIComponent(`video-projects/${slug}/${it.candidate.file}`)}`, { headers: { range: 'bytes=0-15', connection: 'close' } }); assert.equal(head.status, 206); console.log('ok  the dashboard serves the candidate for playback');
  r = await act({ type: 'approve-candidate', sha: it.candidate.sha }); assert.equal(r.status, 200, JSON.stringify(r)); console.log('ok  dashboard approved the candidate: ' + r.message);
  const fin = join(dir, `renders/${reel().slug}-final.mp4`); assert.ok(existsSync(fin)); assert.equal(sha(fin), rec.sha256);
  const ap = reel().approvals.at(-1); assert.deepEqual([ap.status, ap.approvedBy, ap.sha256], ['approved', 'Mits', rec.sha256]);
  it = await item(); assert.equal(it.stage, 'instagram'); assert.equal(it.project.finalExists, true);
  console.log(`ok  ${reel().slug}-final.mp4 is the QA-verified candidate byte for byte (${rec.sha256.slice(0, 12)}); renders recorded: ${reel().renders.map(x => x.file.replace('renders/', '')).join(', ')}`);
  console.log('PASS  ' + root);
} finally { srv.close(); }
