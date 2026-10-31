// Reel Studio two-stage pipeline: draft quick checks, candidate QA wiring, the blocking rule, Mode B speech integrity,
// and hash-bound approval with safe promotion. Fast: HyperFrames and full QA are replaced by test scripts here.
// The real render-and-QA path is exercised by `npm run test:reel-smoke`, not by these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, cpSync, mkdirSync, existsSync, copyFileSync, appendFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const scripts = join(root, '.claude/skills/create-reel/scripts');
const { getProfile } = await import('../.claude/skills/create-reel/scripts/lib.mjs');
const { convertToVertical } = await import('../.claude/skills/create-reel/scripts/new-reel.mjs');
const core = await import('../.claude/skills/create-reel/scripts/qa-core.mjs');
const { approveCandidate } = await import('../.claude/skills/create-reel/scripts/approve-reel.mjs');
const { validatePlan } = await import('../.claude/skills/short-form-edit/scripts/validate-plan.mjs');
const { facelessPlan, footagePlan, brandPlan, writePlan } = await import('./fixtures/visual-plans.mjs');

// Render and audio tests synthesize media with ffmpeg; say so plainly instead of failing on a null exit status.
const HAS_FFMPEG = spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0;
const requireFfmpeg = () => assert.ok(HAS_FFMPEG, 'ffmpeg and ffprobe must be on PATH for this test');

const SLUG = 'pipe-test';
const DIRECTION = { hook: 'Most to-do lists fail on day 3', coreClaim: 'Plans fail at the handoff', heroBeat: 'the list folds into one card', motif: 'a folding card', style: 'kallaway' };
const PLANS = { faceless: () => facelessPlan(2), footage: footagePlan, brand: () => brandPlan(2) };
// Gate B through the real CLI: read the fingerprint the report prints, then approve that exact plan.
function preflight(dir, ...extra) {
  return spawnSync(process.execPath, [join(scripts, 'preflight-reel.mjs'), dir, ...extra], { encoding: 'utf8', windowsHide: true });
}
function approvePlan(dir, extra = []) {
  const fp = JSON.parse(preflight(dir, '--json').stdout).fingerprint;
  const r = preflight(dir, '--approve', '--fingerprint', fp.slice(0, 12), '--approved-by', 'test person', ...extra);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return fp;
}
// preflight: 'approved' (default; a v2 plan approved through the CLI), 'pending' (plan written, not approved),
// 'none' (a new reel with no plan) or 'legacy' (a reel.json from before Gate B).
function project({ mode = 'faceless', requireHumanApproval, direction = DIRECTION, preflight = 'approved' } = {}) {
  const dir = join(mkdtempSync(join(tmpdir(), 'reel-approval-')), SLUG);
  cpSync(join(root, 'examples/starter'), dir, { recursive: true });
  mkdirSync(join(dir, 'assets')); mkdirSync(join(dir, 'renders'));
  writeFileSync(join(dir, 'assets/gsap.min.js'), '');
  convertToVertical(dir, { slug: SLUG, profile: getProfile('organic'), duration: 2, mode, title: 'Pipeline test' });
  const reel = JSON.parse(readFileSync(join(dir, 'reel.json'), 'utf8'));
  if (direction) reel.direction = direction;
  if (requireHumanApproval !== undefined) reel.requireHumanApproval = requireHumanApproval;
  if (preflight === 'legacy') { delete reel.preflightRequired; delete reel.preflight; }
  writeFileSync(join(dir, 'reel.json'), JSON.stringify(reel, null, 2));
  if (preflight === 'approved' || preflight === 'pending') writePlan(dir, PLANS[mode]());
  if (preflight === 'approved') approvePlan(dir);
  return dir;
}

// Stand-ins for the HyperFrames CLI and qa-reel.mjs, written per test run.
const hooksDir = mkdtempSync(join(tmpdir(), 'reel-hooks-'));
const fakeRenderer = join(hooksDir, 'fake-render.mjs');
writeFileSync(fakeRenderer, `import { spawnSync } from 'node:child_process';
const a = process.argv.slice(2), out = a[a.indexOf('--output') + 1], mode = process.env.FAKE_RENDER || 'ok';
if (mode === 'fail') process.exit(3);
const size = mode === 'landscape' ? '1920x1080' : '1080x1920';
const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x223344:s=' + size + ':r=30:d=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', out]);
process.exit(r.status);`);
const fakeQa = join(hooksDir, 'fake-qa.mjs');
writeFileSync(fakeQa, `import { writeFileSync } from 'node:fs'; import { join } from 'node:path';
writeFileSync(join(process.argv[2], 'qa-called.json'), JSON.stringify(process.argv.slice(2)));
process.exit(Number(process.env.FAKE_QA_EXIT || 0));`);
function render(dir, kind, env = {}) {
  return spawnSync(process.execPath, [join(scripts, 'render-reel.mjs'), dir, `--${kind}`], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, REEL_STUDIO_RENDERER: fakeRenderer, REEL_STUDIO_QA_SCRIPT: fakeQa, ...env },
  });
}

// A candidate plus the qa.json that qa-reel.mjs would write for it, built from the real evaluate().
async function candidateWithRecord(dir, version, { results } = {}) {
  const rel = `renders/${SLUG}-candidate-v${String(version).padStart(3, '0')}.mp4`;
  const file = join(dir, rel);
  writeFileSync(file, `candidate ${version} ${Math.random()}`);
  const rows = results || [{ area: 'Render', check: 'duration', status: 'PASS', detail: '', required: true, kind: 'technical' }];
  const record = { schema: 'reel-qa/2', project: SLUG, render: rel, candidate: true, sha256: await core.sha256File(file), qaAt: new Date().toISOString(), ...core.evaluate(rows), approval: { status: 'pending' }, results: rows };
  mkdirSync(core.qaDirFor(dir, file), { recursive: true });
  core.writeJson(core.recordPathFor(dir, file), record);
  return { rel, file, record };
}
const approve = (dir, c, extra = {}) => approveCandidate(dir, { candidate: c.rel, sha: c.record.sha256.slice(0, 12), approvedBy: 'Reviewer', ...extra });

test('a successful draft render runs only the lightweight checks', () => {
  requireFfmpeg();
  const dir = project();
  const r = render(dir, 'draft');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const qaDir = join(dir, `renders/${SLUG}-draft-v001.qa`);
  const quick = JSON.parse(readFileSync(join(qaDir, 'quick.json'), 'utf8'));
  assert.equal(quick.verdict, 'DRAFT_CHECKED', 'a draft is never reported as VERIFIED');
  assert.equal(quick.technicallyVerified, false);
  const checks = quick.results.map(x => x.check);
  assert.ok(checks.includes('every frame decodes (ffmpeg full decode)'));
  assert.ok(checks.some(c => c.startsWith('dimensions 1080x1920')) && checks.some(c => c.startsWith('duration 2 s')));
  assert.ok(!existsSync(join(qaDir, 'qa.json')), 'no full QA record for a draft');
  assert.ok(!existsSync(join(dir, 'qa-called.json')), 'full QA not run for a draft');
});

test('a render never reuses a version held by a renamed file or a leftover .qa folder', () => {
  requireFfmpeg();
  const dir = project();
  mkdirSync(join(dir, 'renders'), { recursive: true });
  writeFileSync(join(dir, `renders/${SLUG}-draft-v001-mine.mp4`), 'renamed by the person');
  mkdirSync(join(dir, `renders/${SLUG}-draft-v002.qa`));
  writeFileSync(join(dir, `renders/${SLUG}-draft-v002.qa/keep.txt`), 'old review');
  const r = render(dir, 'draft');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(dir, `renders/${SLUG}-draft-v003.mp4`)), 'next free version');
  assert.equal(readFileSync(join(dir, `renders/${SLUG}-draft-v002.qa/keep.txt`), 'utf8'), 'old review', 'old QA folder untouched');
});

test('a draft with the wrong shape fails its quick checks', () => {
  requireFfmpeg();
  const dir = project();
  const r = render(dir, 'draft', { FAKE_RENDER: 'landscape' });
  assert.equal(r.status, 1);
  const quick = JSON.parse(readFileSync(join(dir, `renders/${SLUG}-draft-v001.qa/quick.json`), 'utf8'));
  assert.equal(quick.verdict, 'BLOCKED');
  assert.ok(quick.blocking.some(x => x.check.startsWith('dimensions')));
});

test('a final render produces a versioned candidate and runs full QA on that exact file', () => {
  requireFfmpeg();
  const dir = project();
  const r = render(dir, 'final');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'qa-called.json'), 'utf8')), [dir, '--render', `renders/${SLUG}-candidate-v001.mp4`]);
  const reel = JSON.parse(readFileSync(join(dir, 'reel.json'), 'utf8'));
  assert.equal(reel.renders[0].kind, 'candidate');
  assert.match(reel.renders[0].sha256, /^[a-f0-9]{64}$/);
  assert.ok(reel.renders[0].testHooks, 'test hooks are recorded');
  assert.equal(render(dir, 'final').status, 0);
  assert.ok(existsSync(join(dir, `renders/${SLUG}-candidate-v002.mp4`)) && existsSync(join(dir, `renders/${SLUG}-candidate-v001.mp4`)), 'earlier candidate kept');
  assert.ok(!existsSync(core.finalPath(dir)), 'nothing promoted automatically');
});

test('a final render is refused before rendering until the creative direction is recorded', () => {
  const dir = project({ direction: null });
  assert.deepEqual(Object.keys(core.readJson(join(dir, 'reel.json')).direction), core.DIRECTION_FIELDS, 'scaffold writes an empty direction');
  const r = render(dir, 'final');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /"direction" is missing hook, coreClaim, heroBeat, motif, style/);
  assert.deepEqual(readdirSync(join(dir, 'renders')), [], 'nothing rendered');
  assert.deepEqual(core.missingDirection({ direction: { ...DIRECTION, motif: '  ' } }), ['motif']);
});

test('failed renders and failed QA leave the approved final untouched', () => {
  requireFfmpeg();
  const dir = project();
  writeFileSync(core.finalPath(dir), 'approved final bytes');
  assert.equal(render(dir, 'final', { FAKE_RENDER: 'fail' }).status, 1);
  const q = render(dir, 'final', { FAKE_QA_EXIT: '1' });
  assert.equal(q.status, 1);
  assert.match(q.stderr, /Stage 1 blocked/);
  assert.ok(existsSync(join(dir, `renders/${SLUG}-candidate-v001.mp4`)), 'failed candidate kept for debugging');
  assert.equal(readFileSync(core.finalPath(dir), 'utf8'), 'approved final bytes');
});

test('blocking rule: FAIL and required NOT TESTED block; warnings and optional NOT TESTED do not', () => {
  const row = (status, required = true, kind = 'technical') => ({ area: 'A', check: `${status}-${required}-${kind}`, status, detail: '', required, kind });
  assert.equal(core.evaluate([row('PASS'), row('WARNING'), row('NOT APPLICABLE'), row('NOT TESTED', false, 'human')]).technicallyVerified, true);
  assert.equal(core.evaluate([row('PASS'), row('FAIL', false)]).verdict, 'BLOCKED');
  const source = core.evaluate([row('PASS')], { scope: 'source' });
  assert.deepEqual([source.verdict, source.passed, source.technicallyVerified], ['SOURCE_VALIDATED', true, false], 'source-only QA never verifies a video');
  assert.equal(core.evaluate([row('FAIL')], { scope: 'source' }).verdict, 'BLOCKED');
  assert.throws(() => core.evaluate([], { scope: 'everything' }), /Unknown QA scope/);
  const missing = core.evaluate([row('PASS'), row('NOT TESTED')]);
  assert.equal(missing.technicallyVerified, false);
  assert.deepEqual(missing.blocking.map(b => b.status), ['NOT TESTED']);
  const { results, add } = core.makeCollector();
  add('motionmaxxing', 'G3 end hold', 'FAIL', 'hold 2.1 s', { kind: 'creative' });
  assert.equal(results[0].status, 'WARNING', 'a creative rule never becomes a technical failure');
  assert.throws(() => add('x', 'y', 'PASSED'), /Unknown status/);
});

test('motionmaxxing creative findings are warnings; a crashed or confused checker is a FAIL', () => {
  const gates = JSON.stringify({ gates: [{ id: 'G2', name: 'no empty frame', status: 'FAIL', detail: 'blank at 1.2 s' }, { id: 'G3', name: 'end hold', status: 'WARN', detail: '' }, { id: 'G0', name: 'render', status: 'PASS', detail: '' }] });
  const look = core.interpretLook({ status: 1, stdout: '', stderr: '' }, gates);
  assert.deepEqual(look.map(r => [r[2], r[4].kind]), [['WARNING', 'creative'], ['WARNING', 'creative'], ['PASS', 'creative']]);
  const crashed = core.interpretLook({ status: 1, stdout: '', stderr: 'Traceback: ModuleNotFoundError: numpy' }, null);
  assert.equal(crashed[0][2], 'FAIL'); assert.equal(crashed[0][4].kind, 'checker'); assert.match(crashed[0][3], /checker error.*numpy/);
  assert.equal(core.interpretLook({ status: 0, stdout: '', stderr: '' }, '{not json')[0][2], 'FAIL', 'unreadable gates.json is a checker error');
  const lint = core.interpretLint({ status: 1, stdout: JSON.stringify({ rules: [{ id: 'V5', status: 'FAIL' }, { id: 'V1', status: 'PASS' }] }), stderr: '' });
  assert.deepEqual([lint[0][2], lint[0][4].kind], ['WARNING', 'creative']);
  const lintCrash = core.interpretLint({ status: 0, stdout: 'Error: incompatible input', stderr: '' });
  assert.deepEqual([lintCrash[0][2], lintCrash[0][4].kind], ['FAIL', 'checker'], 'exit 0 with unparseable output is not a PASS');
  const { results, add } = core.makeCollector();
  for (const r of [...look, ...lint]) add(...r);
  assert.equal(core.evaluate(results).technicallyVerified, true, 'creative warnings alone do not block');
  add(...crashed[0]);
  assert.equal(core.evaluate(results).technicallyVerified, false, 'a broken checker blocks');
});

test('probe and decode checks report decode, size, fps, duration and audio', () => {
  const probe = { streams: [{ codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, r_frame_rate: '30/1', pix_fmt: 'yuv420p' }], format: { duration: '2.000' } };
  const ok = core.probeChecks(probe, { width: 1080, height: 1920, fps: 30, duration: 2, audio: false, codec: 'h264', pixFmt: 'yuv420p' });
  assert.ok(ok.filter(r => r[4]?.required).every(r => r[2] === 'PASS'));
  const noAudio = core.probeChecks(probe, { width: 1080, height: 1920, fps: 30, duration: 2, audio: true });
  assert.equal(noAudio.find(r => r[1] === 'audio stream present')[2], 'FAIL');
  assert.equal(core.probeChecks(null, {})[0][2], 'FAIL');
  assert.equal(core.decodeCheck({ status: 0, stderr: '' })[2], 'PASS');
  assert.equal(core.decodeCheck({ status: 0, stderr: '[h264] error while decoding MB 3 4' })[2], 'FAIL');
});

test('audio analysis measures loudness, peaks and dead air, and reports a failed run as a checker error', () => {
  requireFfmpeg();
  const dir = mkdtempSync(join(tmpdir(), 'reel-audio-'));
  const f = join(dir, 'a.m4a');
  const mk = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1.2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5',
    '-filter_complex', '[0][1][2]concat=n=3:v=0:a=1', '-c:a', 'aac', f], { windowsHide: true });
  assert.equal(mk.status, 0);
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', f, '-af', core.AUDIO_FILTER, '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true });
  const a = core.parseAudioAnalysis(r.stderr);
  assert.ok(a.parsed && Number.isFinite(a.lufs) && Number.isFinite(a.peak));
  const rows = core.audioChecks(r, a, { duration: 4.2, required: true });
  assert.equal(rows.find(x => x[1].startsWith('dead air'))[2], 'WARNING');
  assert.ok(rows.every(x => x[4].required));
  const broken = core.audioChecks({ status: 1, stderr: 'Invalid data found' }, core.parseAudioAnalysis(''), { duration: 2, required: true });
  assert.deepEqual([broken[0][2], broken[0][4].kind], ['FAIL', 'checker']);
});

// Mode B fixture: the public short-form example plus a source transcript with the words that were cut.
const sf = name => JSON.parse(readFileSync(join(root, 'examples/short-form/assets', name), 'utf8'));
function sourceFor(retained, extra) {
  const words = retained.words.map(w => ({ text: w.text, start: w.sourceStart, end: w.sourceEnd, type: 'word' }));
  return { words: [...extra, ...words].sort((a, b) => a.start - b.start) };
}

test('Mode B: source mapping and captions validate; drifted captions are reported as caption failures', () => {
  const plan = sf('plan.json'), retained = sf('transcript.json'), edl = sf('edit-decisions.json');
  const rows = core.planChecks(validatePlan(plan, retained, edl), plan);
  assert.deepEqual(rows.map(r => r[2]), ['PASS', plan.captions?.length ? 'PASS' : 'NOT APPLICABLE', 'NOT APPLICABLE']);
  assert.ok(rows.slice(0, 2).every(r => r[4].required));
  assert.match(rows[2][3], /legacy plan/, 'a legacy plan has no visual-plan row to pass or fail');
  const drifted = structuredClone(plan);
  drifted.captions[0].words[0].start += 0.2;
  const bad = core.planChecks(validatePlan(drifted, retained, edl), drifted);
  assert.equal(bad.find(r => r[0] === 'Captions')[2], 'FAIL');
  const noCaptions = { ...plan, captions: [] };
  assert.equal(core.planChecks({ errors: [], metrics: { retainedWords: 0, scenes: 1 } }, noCaptions)[1][2], 'NOT APPLICABLE');
});

test('Mode B: speech integrity passes a clean edit and flags a removed negation for human review', () => {
  const retained = sf('transcript.json'), edl = sf('edit-decisions.json');
  const clean = core.speechIntegrity(sourceFor(retained, [{ text: 'Um,', start: 0.4, end: 0.7 }]), retained, edl);
  assert.ok(clean.rows.filter(r => r[4]?.required).every(r => r[2] === 'PASS'), JSON.stringify(clean.rows));
  assert.equal(clean.flagged.length, 0);
  // "not" said before the kept range was cut away: flagged, not failed, and pointed at the edited time.
  const risky = core.speechIntegrity(sourceFor(retained, [{ text: "Don't", start: 0.3, end: 0.6 }, { text: 'not', start: 5.2, end: 5.5 }]), retained, edl);
  assert.equal(risky.flagged.length, 2);
  assert.deepEqual(risky.flagged.map(f => f.risks[0][1]), ['negation', 'negation']);
  const row = risky.rows.find(r => r[1].startsWith('cuts that remove'));
  assert.deepEqual([row[2], row[4].kind], ['WARNING', 'human']);
  assert.equal(core.riskOf('15%'), 'number'); assert.equal(core.riskOf('only'), 'qualifier'); assert.equal(core.riskOf('garden'), null);
});

test('Mode B: a cut inside a word and a transcript that does not match the source both fail', () => {
  const retained = sf('transcript.json'), source = sourceFor(retained, []);
  const split = core.speechIntegrity(source, retained, { keeps: [{ sourceStart: 1.25, sourceEnd: 5, start: 0, end: 3.75 }] });
  assert.equal(split.rows.find(r => r[1] === 'no cut splits a spoken word')[2], 'FAIL');
  const altered = structuredClone(retained); altered.words[3].text = 'big.';
  const mismatch = core.speechIntegrity(source, altered, sf('edit-decisions.json'));
  const row = mismatch.rows.find(r => r[1].startsWith('retained transcript equals'));
  assert.equal(row[2], 'FAIL'); assert.match(row[3], /word 3/);
  assert.equal(core.speechIntegrity({ words: [] }, retained, sf('edit-decisions.json')).rows[0][2], 'FAIL');
});

test('approval promotes only the verified candidate it names, and records it separately', async () => {
  const dir = project({ mode: 'footage' });
  const c = await candidateWithRecord(dir, 1);
  const r = await approve(dir, c, { note: 'watched twice' });
  assert.equal(r.final, 'renders/final.mp4');
  assert.equal(await core.sha256File(core.finalPath(dir)), c.record.sha256, 'promoted output matches the approved candidate');
  const rec = core.readJson(core.recordPathFor(dir, c.file));
  assert.equal(rec.approval.status, 'approved'); assert.equal(rec.approval.sha256, c.record.sha256); assert.equal(rec.technicallyVerified, true);
  const qa = readFileSync(join(dir, 'QA.md'), 'utf8');
  assert.match(qa, /## Stage 1: automated technical verification[\s\S]*VERIFIED[\s\S]*## Stage 2: human creative approval[\s\S]*APPROVED by Reviewer/);
  assert.equal(core.readJson(join(dir, 'reel.json')).approvals.length, 1);
  await assert.rejects(approve(dir, c), /already approved/);
});

test('approval rejects unverified, modified, mismatched, unrecorded and borrowed QA', async () => {
  const dir = project({ mode: 'footage' });
  const blocked = await candidateWithRecord(dir, 1, { results: [{ area: 'Speech', check: 'source transcript', status: 'NOT TESTED', detail: '', required: true, kind: 'technical' }] });
  await assert.rejects(approve(dir, blocked), /did not pass Stage 1: NOT TESTED source transcript/);
  const c = await candidateWithRecord(dir, 2);
  await assert.rejects(approve(dir, c, { sha: 'abcdefabcdef' }), /does not match the QA-verified hash/);
  await assert.rejects(approve(dir, c, { sha: c.record.sha256.slice(0, 6) }), /at least the first 12/);
  await assert.rejects(approve(dir, c, { approvedBy: '' }), /--approved-by is required/);
  appendFileSync(c.file, 'edited after QA');
  await assert.rejects(approve(dir, c), /changed after QA/);
  // v003 has no QA of its own; copying v002's verified record into place must not authorise it.
  const v3 = join(dir, `renders/${SLUG}-candidate-v003.mp4`);
  copyFileSync(c.file, v3);
  await assert.rejects(approveCandidate(dir, { candidate: `renders/${SLUG}-candidate-v003.mp4`, sha: c.record.sha256.slice(0, 12), approvedBy: 'R' }), /No QA record/);
  mkdirSync(core.qaDirFor(dir, v3), { recursive: true });
  copyFileSync(core.recordPathFor(dir, c.file), core.recordPathFor(dir, v3));
  await assert.rejects(approveCandidate(dir, { candidate: `renders/${SLUG}-candidate-v003.mp4`, sha: c.record.sha256.slice(0, 12), approvedBy: 'R' }), /is for renders\/pipe-test-candidate-v002\.mp4/);
  writeFileSync(join(dir, `renders/${SLUG}-draft-v001.mp4`), 'draft');
  await assert.rejects(approveCandidate(dir, { candidate: `renders/${SLUG}-draft-v001.mp4`, sha: 'a'.repeat(12), approvedBy: 'R' }), /not a candidate/);
  assert.ok(!existsSync(core.finalPath(dir)), 'nothing was promoted');
});

test('a newer approval archives the previous final; a failed copy changes nothing', async () => {
  const dir = project();
  const v1 = await candidateWithRecord(dir, 1);
  await approve(dir, v1);
  const v2 = await candidateWithRecord(dir, 2);
  const r = await approve(dir, v2);
  assert.match(r.archived, /^renders\/approved\/final-.*-[a-f0-9]{12}\.mp4$/);
  assert.equal(await core.sha256File(join(dir, r.archived)), v1.record.sha256, 'previous approved final preserved');
  assert.equal(await core.sha256File(core.finalPath(dir)), v2.record.sha256);
  const v3 = await candidateWithRecord(dir, 3);
  const corrupt = (from, to) => writeFileSync(to, 'truncated');
  await assert.rejects(approve(dir, v3, { copy: corrupt }), /final\.mp4 was not changed/);
  const throwing = () => { throw new Error('disk full'); };
  await assert.rejects(approve(dir, v3, { copy: throwing }), /not changed\. disk full/);
  assert.equal(await core.sha256File(core.finalPath(dir)), v2.record.sha256, 'final still the last approved candidate');
  assert.equal(core.readJson(core.recordPathFor(dir, v3.file)).approval.status, 'pending');
  assert.ok(!readdirSync(join(dir, 'renders')).some(f => f.includes('.tmp-')), 'no temp files left behind');
});

test('human approval is on by default for every mode and can be relaxed only outside footage', async () => {
  assert.equal(core.humanApprovalRequired({ mode: 'faceless' }), true);
  assert.equal(core.humanApprovalRequired({ mode: 'brand', requireHumanApproval: false }), false);
  assert.equal(core.humanApprovalRequired({ mode: 'footage', requireHumanApproval: false }), true);
  const brand = project({ mode: 'brand', requireHumanApproval: false });
  const c = await candidateWithRecord(brand, 1);
  const r = await approveCandidate(brand, { candidate: c.rel, sha: c.record.sha256.slice(0, 12) });
  assert.equal(r.approval.status, 'promoted-without-human-approval');
  const footage = project({ mode: 'footage', requireHumanApproval: false });
  const f = await candidateWithRecord(footage, 1);
  await assert.rejects(approveCandidate(footage, { candidate: f.rel, sha: f.record.sha256.slice(0, 12) }), /--approved-by is required/);
});

// ---------- Gate B: the creative preflight
const draftFile = (dir, v = 1) => join(dir, 'renders', `${SLUG}-draft-v${String(v).padStart(3, '0')}.mp4`);
const editPlan = (dir, change) => { const p = join(dir, 'assets/plan.json'), plan = JSON.parse(readFileSync(p, 'utf8')); change(plan); writeFileSync(p, JSON.stringify(plan, null, 2)); };
const editReel = (dir, change) => { const p = join(dir, 'reel.json'), reel = JSON.parse(readFileSync(p, 'utf8')); change(reel); writeFileSync(p, JSON.stringify(reel, null, 2)); };

test('Gate B: a legacy reel (no preflightRequired, no v2 plan) renders exactly as before', () => {
  requireFfmpeg();
  const dir = project({ preflight: 'legacy' });
  const r = render(dir, 'draft');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stderr, /preflight/i);
  assert.ok(existsSync(draftFile(dir)));
});

test('Gate B: a new reel is refused, draft and final, until its creative plan is valid and approved, with the reason named', () => {
  const dir = project({ preflight: 'none' });
  assert.equal(core.readJson(join(dir, 'reel.json')).preflightRequired, true, 'new-reel scaffolds the requirement');
  const refused = (kind, why) => {
    const r = render(dir, kind);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /Render refused: the creative preflight \(Gate B\)/);
    assert.match(r.stderr, why);
    assert.match(r.stderr, /npm run preflight-reel -- /);
    assert.deepEqual(readdirSync(join(dir, 'renders')).filter(f => f.endsWith('.mp4')), [], 'nothing was rendered');
  };
  refused('draft', /no assets\/plan\.json/);
  writePlan(dir, sf('plan.json'));
  refused('draft', /schema 1; a new reel needs "schemaVersion": 2/);
  writePlan(dir, facelessPlan(2));
  refused('draft', /no approved creative preflight/);
  refused('final', /no approved creative preflight/);
  editPlan(dir, p => { p.scenes[0].brollMode = 'hologram'; });
  refused('draft', /brollMode "hologram" is not one of/);
});

test('Gate B: an approved reel renders, keeps its approval through technical revisions, and needs re-approval for creative changes', () => {
  requireFfmpeg();
  const dir = project();
  assert.equal(render(dir, 'draft').status, 0);
  // Technical revision: timing, layout, kind, events, anchors and asset production fields.
  editPlan(dir, p => {
    p.scenes[0].end = p.scenes[1].start = 0.8; p.scenes[1].layout = 'split'; p.scenes[1].kind = 'calendar-v2';
    p.events.push({ time: 1.5, type: 'tick', visual: 's02' }); p.scenes[0].anchor = 'Most';
    Object.assign(p.scenes[1].asset, { status: 'ready', file: 'assets/cal.png', sha256: 'a'.repeat(64) });
  });
  const r2 = render(dir, 'draft');
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.ok(existsSync(draftFile(dir, 2)));
  // Creative change: the B-roll strategy of scene 2.
  editPlan(dir, p => { Object.assign(p.scenes[1], { brollMode: 'generated-video', evidenceType: 'simulated' }); });
  const r3 = render(dir, 'draft');
  assert.equal(r3.status, 1);
  assert.match(r3.stderr, /creative plan changed since it was approved/);
  assert.match(r3.stderr, /scene 2 \(s02\) brollMode "ui-mock" -> "generated-video"/);
  approvePlan(dir);
  assert.equal(render(dir, 'draft').status, 0, 're-approved plan renders');
  // Creative change: the direction.
  editReel(dir, reel => { reel.direction.motif = 'a paper boat'; });
  const r5 = render(dir, 'final');
  assert.equal(r5.status, 1);
  assert.match(r5.stderr, /direction\.motif/);
});

test('Gate B: the script keeps its approval through filler and stutter cuts, never through a meaning change', () => {
  requireFfmpeg();
  const dir = project({ preflight: 'pending' });
  editPlan(dir, p => { p.script = 'So most to-do lists, um, fail fail on day three.'; });
  approvePlan(dir);
  editPlan(dir, p => { p.script = 'Most to-do lists fail on day three.'; });
  const ok = render(dir, 'draft');
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  editPlan(dir, p => { p.script = 'Most to-do lists never fail on day three.'; });
  const bad = render(dir, 'draft');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /the script changed since approval: added "never" at word 4 \(negation\)/);
});

test('Gate B: every mode (faceless, footage, brand) is refused before approval and renders after it', () => {
  requireFfmpeg();
  for (const mode of ['faceless', 'footage', 'brand']) {
    const dir = project({ mode, preflight: 'pending' });
    const before = render(dir, 'draft');
    assert.equal(before.status, 1, `${mode}: refused`);
    assert.match(before.stderr, /no approved creative preflight/);
    approvePlan(dir);
    const after = render(dir, 'draft');
    assert.doesNotMatch(after.stderr, /Render refused/, `${mode}: ${after.stderr}`);
    assert.ok(existsSync(draftFile(dir)), `${mode}: rendered`); // footage drafts then fail quick checks (no audio in the fake render)
    if (mode === 'brand') assert.match(after.stderr, /Preflight note: .*paid assets planned \(s01\) but no paid provider and spending limit are approved/);
  }
});

test('preflight-reel: read-only report changes nothing; --approve refuses a wrong fingerprint, no name, an invalid plan or half a paid scope', () => {
  const dir = project({ mode: 'brand', preflight: 'pending' });
  const before = readFileSync(join(dir, 'reel.json'));
  const report = preflight(dir);
  assert.equal(report.status, 0, report.stdout + report.stderr);
  assert.match(report.stdout, /Simulated \(not real evidence\): none/);
  assert.match(report.stdout, /Planned callbacks \(declared, not verified as rendered transitions\): s01 -> s02 mark #grinder-mark/);
  assert.match(report.stdout, /Approval: not approved/);
  assert.ok(readFileSync(join(dir, 'reel.json')).equals(before), 'the report wrote nothing');
  const fp = JSON.parse(preflight(dir, '--json').stdout).fingerprint;
  const refuse = (args, why) => { const r = preflight(dir, '--approve', ...args); assert.equal(r.status, 1, r.stdout); assert.match(r.stderr, why); };
  refuse(['--fingerprint', '0'.repeat(12), '--approved-by', 'x'], /does not match the current plan/);
  refuse(['--fingerprint', fp.slice(0, 12)], /--approved-by is required/);
  refuse(['--fingerprint', fp.slice(0, 12), '--approved-by', 'x', '--paid-provider', 'kie'], /needs both --paid-provider and --spend-limit/);
  assert.ok(readFileSync(join(dir, 'reel.json')).equals(before), 'refusals wrote nothing');
  approvePlan(dir, ['--paid-provider', 'kie', '--spend-limit', 'USD 5', '--max-calls', '3']);
  const p = core.readJson(join(dir, 'reel.json')).preflight;
  assert.deepEqual([p.status, p.approvedBy, p.fingerprint, p.paidScope], ['approved', 'test person', fp, { provider: 'kie', spendLimit: 'USD 5', maxCalls: 3 }]);
  assert.match(p.safeguard, /not proof of identity/);
  editPlan(dir, plan => { plan.scenes[0].visualIntent = 'interesting animation'; });
  refuse(['--fingerprint', fp.slice(0, 12), '--approved-by', 'x'], /only a generic description/);
});
