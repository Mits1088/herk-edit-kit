// Content dashboard, phase 1: the state reader, the manifest writer and the file server guard.
// Runs against a throwaway copy of the workflow's folder layout; never touches real projects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
const { loadConfig } = await import('../dashboard/lib/config.mjs');
const { buildState, itemDetail, dueDate } = await import('../dashboard/lib/state.mjs');
const { applyAction } = await import('../dashboard/lib/manifest.mjs');
const { parseApproved, parseYoutube, parseResources, keywordFrom } = await import('../dashboard/lib/parse.mjs');
const { safeFile, linkedMedia } = await import('../dashboard/server.mjs');

process.env.DASH_TRACK_FROM = '2026-01-01'; // fixtures post in 2026; the backlog rule has its own test
const NOW = new Date('2026-11-16T10:00:00');
const bar = '='.repeat(60);
const sec = (name, body) => `${bar}\n${name}\n${bar}\n\n${body}\n\n`;
const generated = n => `REEL ${n}: SAMPLE REEL ${n}\nStatus: READY TO RECORD\n\n${sec('VERSION A - FAITHFUL REWRITE', 'Line A one.\nLine A two.')}${sec('VERSION B - STRONGER ALTERNATIVE', 'Line B one.')}${sec('INSTAGRAM CAPTION', 'IG text')}`;
const approved = cta => `Status at approval: READY TO RECORD\nBatch: batch-2026-11-14-001\n\n${sec('SCRIPT', 'Line A one.\nLine A two.')}${sec('INSTAGRAM CAPTION', 'IG caption text')}${sec('TIKTOK CAPTION', 'TT caption text')}${sec('YOUTUBE SHORTS', 'Title: A short title\n\nDescription:\nFirst line.\nSecond line.\n\nTags: one, two, three')}${sec('CTA', cta)}`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dash-'));
  const w = (p, t) => { const f = join(root, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, typeof t === 'string' ? t : JSON.stringify(t, null, 2)); };
  // batch 001: reel 1 approved with a keyword and a finished video; reel 2 approved, nothing recorded; reel 3 undecided
  for (const n of [1, 2, 3]) w(`instagram_scripts_output/batch-2026-11-14-001/0${n}-sample-reel-${n}.txt`, generated(n));
  for (const n of [1, 2, 3]) w(`reels-data/inputs/batch-2026-11-14-001/input-${n}.md`, `## Reel: source ${n}\n\nDuration: 40s\n\nWords.`);
  w('instagram_scripts_output/approved/batch-2026-11-14-001/01-sample-reel-1-version-a.txt', approved('Comment GUIDE for the steps.'));
  w('instagram_scripts_output/approved/batch-2026-11-14-001/02-sample-reel-2-version-b.txt', approved('Share this with a friend.'));
  // batch 002: inputs only
  w('reels-data/inputs/batch-2026-11-15-001/fresh.md', '## Reel: fresh one\n\nWords.');
  // a transcript dropped and not yet batched
  w('Instagram_transcript/new-idea.md', '## Reel: new idea\n\nWords.');
  w('reels-data/resources.md', '# Resources\n\n- KEYWORD: what the viewer receives | delivery | resource file | draft or live\n- GUIDE: the steps | to confirm | instagram_scripts_output/resources/Guide.pdf | draft\n');
  w('instagram_scripts_output/resources/Guide.pdf', '%PDF-1.4 sample');
  w('reels-data/resource-sources/guide.pdf.json', { keyword: 'GUIDE', reel: { approved: 'instagram_scripts_output/approved/batch-2026-11-14-001/01-sample-reel-1-version-a.txt' } });
  const sha = 'a'.repeat(64);
  const reel = (extra) => ({ slug: 'x', mode: 'footage', preflightRequired: true, preflight: { status: 'approved', approvedBy: 'Mits', approvedAt: '2026-11-14T10:00:00Z', fingerprint: 'f'.repeat(64) }, ...extra });
  // finished video for reel 1
  w('video-projects/sample-one/reel.json', reel({ renders: [{ file: 'renders/sample-one-draft-v001.mp4', kind: 'draft', version: 1 }, { file: 'renders/sample-one-candidate-v001.mp4', kind: 'candidate', version: 1, sha256: sha }], approvals: [{ candidate: 'renders/sample-one-candidate-v001.mp4', status: 'approved', approvedBy: 'Mits', approvedAt: '2026-11-14T12:00:00Z', sha256: sha }] }));
  w('video-projects/sample-one/renders/sample-one-candidate-v001.mp4', 'video');
  w('video-projects/sample-one/renders/sample-one-candidate-v001.qa/qa.json', { passed: true, verdict: 'VERIFIED', sha256: sha });
  w('video-projects/sample-one/renders/final.mp4', 'video');
  // unlinked projects: one with failed QA, one with a passed candidate awaiting approval, one waiting at the hook
  w('video-projects/failed-qa/reel.json', reel({ renders: [{ file: 'renders/failed-qa-candidate-v002.mp4', kind: 'candidate', version: 2, sha256: sha }] }));
  w('video-projects/failed-qa/renders/failed-qa-candidate-v002.mp4', 'video');
  w('video-projects/failed-qa/renders/failed-qa-candidate-v002.qa/qa.json', { passed: false, verdict: 'BLOCKED', sha256: sha, blocking: ['audio stream'] });
  w('video-projects/awaiting/reel.json', reel({ renders: [{ file: 'renders/awaiting-candidate-v001.mp4', kind: 'candidate', version: 1, sha256: sha }] }));
  w('video-projects/awaiting/renders/awaiting-candidate-v001.mp4', 'video');
  w('video-projects/awaiting/renders/awaiting-candidate-v001.qa/qa.json', { passed: true, verdict: 'VERIFIED', sha256: sha });
  w('video-projects/at-hook/reel.json', { slug: 'at-hook', preflightRequired: true, preflight: { status: null }, openingPreview: { end: 5, recordedAt: '2026-11-15T10:00:00Z' } });
  w('video-projects/not-a-reel/index.html', '<html></html>');
  w('reels-data/insights/links.json', { schema: 1, entries: {
    1: { ig_media_id: '1', status: 'pending-publication', project: { slug: 'sample-one' }, approved: { file: 'instagram_scripts_output/approved/batch-2026-11-14-001/01-sample-reel-1-version-a.txt' } },
    2: { ig_media_id: '2', status: 'proposed', permalink: 'https://www.instagram.com/reel/x/', published_at: '2026-11-15T09:00:00Z', project: { slug: 'awaiting' }, approved: { file: 'instagram_scripts_output/approved/batch-2026-11-14-001/02-sample-reel-2-version-b.txt' } },
  } });
  w('raw-media/voice.wav', 'audio'); w('raw-media/avatar.mp4', 'video'); w('raw-media/Processed/old.mp4', 'video');
  w('Uploads/All social media/posted.mp4', 'video');
  const cfg = loadConfig({ root, uploadsDir: join(root, 'Uploads'), missionCli: false });
  return { root, cfg };
}
const hashTree = (dir, skip) => { const out = {}; const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (p === skip) continue; if (e.isDirectory()) walk(p); else out[p] = createHash('sha1').update(readFileSync(p)).digest('hex') + ':' + statSync(p).mtimeMs; } }; walk(dir); return out; };
const by = (s, id) => s.items.find(i => i.id === id);

test('parsers read the approved file sections, the keyword and resources.md', () => {
  const a = parseApproved(approved('Comment GUIDE for the steps.'), 'x.txt');
  assert.equal(a.script, 'Line A one.\nLine A two.'); assert.equal(a.instagram, 'IG caption text'); assert.equal(a.tiktok, 'TT caption text'); assert.equal(a.keyword, 'GUIDE');
  assert.deepEqual(parseYoutube(a.youtube), { title: 'A short title', description: 'First line.\nSecond line.', tags: 'one, two, three' });
  assert.equal(keywordFrom('Share this with a friend.'), null);
  const md = parseApproved('# T - Version A (approved)\n\n**Status at approval:** REVIEW REQUIRED\n**CTA:** Comment ADDONS for the guide\n\n## Script\n\nHello.\n\n## Caption\n\nCap.\n\n## TikTok\n\nTT.', 'x.md');
  assert.equal(md.script, 'Hello.'); assert.equal(md.instagram, 'Cap.'); assert.equal(md.keyword, 'ADDONS'); assert.equal(md.status, 'REVIEW REQUIRED');
  assert.deepEqual(Object.keys(parseResources('- KEYWORD: a | b | c | draft or live\n- GUIDE: a | b | c | live\n')), ['GUIDE']);
});

test('each item lands on the stage its files prove, and nothing is guessed', () => {
  const { cfg } = fixture(); const s = buildState(cfg, NOW);
  assert.equal(by(s, 'src-new-idea').stage, 'source');
  assert.equal(by(s, '2026-11-15-001-01').stage, 'rewrite');
  const undecided = by(s, '2026-11-14-001-03'); assert.equal(undecided.stage, 'choose'); assert.equal(undecided.needs[0].label, 'Choose Version A, B or C');
  // reel 1: finished video, keyword resource still a draft, so Instagram is blocked
  const one = by(s, '2026-11-14-001-01');
  assert.equal(one.stage, 'instagram'); assert.equal(one.version, 'A'); assert.equal(one.project.slug, 'sample-one');
  assert.equal(one.resource.keyword, 'GUIDE'); assert.equal(one.resource.state, 'draft'); assert.equal(one.platforms.ig.state, 'blocked');
  assert.ok(one.needs.some(n => n.label === 'Make the resource live before posting')); assert.ok(!one.needs.some(n => n.label === 'Post to Instagram'));
  assert.equal(one.platforms.yt.state, 'not-yet'); assert.equal(one.files.source, 'reels-data/inputs/batch-2026-11-14-001/input-1.md');
  // reel 2: a proposed link is offered, never applied
  const two = by(s, '2026-11-14-001-02');
  assert.equal(two.project, null); assert.equal(two.resource.state, 'not-required'); assert.equal(two.platforms.ig.state, 'not-yet');
  assert.deepEqual(two.needs.map(n => n.group), ['Needs linking']);
  // unlinked video projects are shown as such
  assert.equal(by(s, 'video-failed-qa').stage, 'qa'); assert.match(by(s, 'video-failed-qa').fail, /failed QA: audio stream/);
  assert.equal(by(s, 'video-awaiting').stage, 'candidate'); assert.equal(by(s, 'video-at-hook').stage, 'hook');
  assert.ok(by(s, 'video-awaiting').unknowns.includes('No script is linked to this video project'));
  assert.equal(by(s, 'video-not-a-reel'), undefined);
  assert.deepEqual(s.files.rawMedia, ['avatar.mp4', 'voice.wav', 'Processed/old.mp4']); assert.deepEqual(s.files.uploads, ['All social media/posted.mp4']);
});

test('a failed or missing QA result never produces a review-the-candidate task', () => {
  const { cfg } = fixture(); const s = buildState(cfg, NOW);
  for (const it of s.items) if (it.stage === 'qa') assert.ok(!it.needs.some(n => /Review the candidate/.test(n.label)));
});

test('confirmed publication sets the second-calendar-day due date; a proposal does not', () => {
  const { root, cfg } = fixture();
  const f = join(root, 'reels-data/insights/links.json'); const j = JSON.parse(readFileSync(f, 'utf8'));
  j.entries[1].status = 'confirmed'; j.entries[1].published_at = '2026-11-14T21:30:00Z'; j.entries[1].permalink = 'https://www.instagram.com/reel/y/';
  writeFileSync(f, JSON.stringify(j));
  const s = buildState(cfg, new Date('2026-11-16T10:00:00Z')); const one = by(s, '2026-11-14-001-01');
  assert.equal(one.stage, 'distribute'); assert.equal(one.platforms.ig.state, 'published');
  assert.equal(one.due, '2026-11-16T09:00:00.000Z'); assert.equal(s.dueTimeZone, 'Europe/London'); assert.equal(s.dueProvisional, true);
  assert.equal(one.platforms.yt.state, 'due'); assert.equal(one.platforms.tt.state, 'due');
  assert.equal(by(s, '2026-11-14-001-02').due, null);
});

test('due dates use the configured timezone, not the PC clock', () => {
  const c = { dueHour: 9, dueTimeZone: 'Europe/London' };
  assert.equal(dueDate(c, '2026-11-14T21:30:00Z').toISOString(), '2026-11-16T09:00:00.000Z'); // winter: London is UTC
  assert.equal(dueDate(c, '2026-07-01T23:30:00Z').toISOString(), '2026-07-04T08:00:00.000Z'); // 00:30 on 2 July in London, so 4 July 09:00 BST
  assert.equal(dueDate(c, '2026-10-23T12:00:00Z').toISOString(), '2026-10-25T09:00:00.000Z'); // due on the day the clocks go back
  assert.equal(dueDate({ dueHour: 18, dueTimeZone: 'America/New_York' }, '2026-11-14T21:30:00Z').toISOString(), '2026-11-16T23:00:00.000Z');
});

test('raw-media is served only for a file you linked to a project', () => {
  const { cfg } = fixture(); let s = buildState(cfg, NOW);
  assert.equal(linkedMedia(cfg, 'raw-media/voice.wav'), null, 'not linked yet');
  applyAction(cfg, s, { id: '2026-11-14-001-02', type: 'link', kind: 'voiceover', value: 'voice.wav' }, NOW);
  assert.ok(linkedMedia(cfg, 'raw-media/voice.wav')); assert.equal(linkedMedia(cfg, 'raw-media/avatar.mp4'), null);
  assert.equal(linkedMedia(cfg, 'raw-media/../.env'), null); assert.equal(linkedMedia(cfg, 'video-projects/x.mp4'), null);
  applyAction(cfg, buildState(cfg, NOW), { id: '2026-11-14-001-02', type: 'link', kind: 'voiceover', value: null }, NOW);
  assert.equal(linkedMedia(cfg, 'raw-media/voice.wav'), null, 'unlinking withdraws access');
});

test('reading state changes no file, and actions write only inside reels-data/content', () => {
  const { root, cfg } = fixture(); const before = hashTree(root);
  const s = buildState(cfg, NOW); itemDetail(cfg, s, '2026-11-14-001-01');
  assert.deepEqual(hashTree(root), before, 'buildState and itemDetail must not write');
  applyAction(cfg, s, { id: '2026-11-14-001-02', type: 'task', task: 'voiceover', done: true }, NOW);
  applyAction(cfg, s, { id: '2026-11-14-001-02', type: 'link', kind: 'voiceover', value: 'voice.wav' }, NOW);
  assert.deepEqual(hashTree(root, cfg.contentDir), before, 'nothing outside the content folder may change');
  assert.deepEqual(readdirSync(cfg.contentDir).sort(), ['2026-11-14-001-02.json', 'history.jsonl']);
  assert.equal(readFileSync(join(cfg.contentDir, 'history.jsonl'), 'utf8').trim().split('\n').length, 2);
});

test('manual tasks and explicit links move a script forward one step at a time', () => {
  const { root, cfg } = fixture(); const id = '2026-11-14-001-03';
  writeFileSync(join(root, 'instagram_scripts_output/approved/batch-2026-11-14-001/03-sample-reel-3-version-a.txt'), approved('Save this.'));
  let s = buildState(cfg, NOW); assert.equal(by(s, id).stage, 'record');
  applyAction(cfg, s, { id, type: 'task', task: 'voiceover', done: true }, NOW); s = buildState(cfg, NOW); assert.equal(by(s, id).stage, 'avatar');
  applyAction(cfg, s, { id, type: 'task', task: 'avatar', done: true }, NOW); s = buildState(cfg, NOW); assert.equal(by(s, id).stage, 'hook');
  applyAction(cfg, s, { id, type: 'link', kind: 'project', value: 'awaiting' }, NOW); s = buildState(cfg, NOW);
  assert.equal(by(s, id).stage, 'candidate'); assert.equal(by(s, id).linkSource, 'linked in the dashboard'); assert.equal(by(s, 'video-awaiting'), undefined);
  applyAction(cfg, s, { id, type: 'task', task: 'voiceover', done: false }, NOW);
  applyAction(cfg, s, { id, type: 'hide', hidden: true }, NOW); s = buildState(cfg, NOW); assert.equal(by(s, id).active, false);
});

test('actions refuse unknown projects, unknown files and a project that is already linked', () => {
  const { cfg } = fixture(); const s = buildState(cfg, NOW); const id = '2026-11-14-001-02';
  assert.throws(() => applyAction(cfg, s, { id: '../evil', type: 'hide', hidden: true }, NOW), /Unknown project/);
  assert.throws(() => applyAction(cfg, s, { id, type: 'link', kind: 'project', value: 'no-such' }, NOW), /No such video project/);
  assert.throws(() => applyAction(cfg, s, { id, type: 'link', kind: 'project', value: 'sample-one' }, NOW), /already linked/);
  assert.throws(() => applyAction(cfg, s, { id, type: 'link', kind: 'footage', value: '../../secret.mp4' }, NOW), /not in raw-media/);
  assert.throws(() => applyAction(cfg, s, { id, type: 'nonsense' }, NOW), /Unknown action/);
  assert.equal(existsSync(cfg.contentDir), false);
});

test('the file route serves finished assets only', () => {
  const { root, cfg } = fixture(); writeFileSync(join(root, 'secret.mp4'), 'x'); writeFileSync(join(root, '.env'), 'KEY=1');
  assert.ok(safeFile(cfg, 'video-projects/sample-one/renders/final.mp4'));
  assert.ok(safeFile(cfg, 'instagram_scripts_output/resources/Guide.pdf'));
  for (const p of ['secret.mp4', '.env', '../outside.mp4', 'video-projects/../secret.mp4', 'video-projects/sample-one/reel.json', 'raw-media/avatar.mp4', 'instagram_scripts_output/approved/batch-2026-11-14-001/01-sample-reel-1-version-a.txt', '', null])
    assert.equal(safeFile(cfg, p), null, `must refuse ${p}`);
});

// ---------------------------------------------------------------- phase 2: script choice, PDF gate, feedback, jobs
const { handleAction } = await import('../dashboard/server.mjs');
const { parseMissions, classifyUpload, probeQueue, checkUpload } = await import('../dashboard/lib/jobs.mjs');
const { spawnSync } = await import('node:child_process');
const { copyFileSync } = await import('node:fs');

function fixture2() {
  const { root } = fixture();
  const w = (p, t) => { const f = join(root, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
  w('fake/gumroad.mjs', `console.log('Dry run OK'); console.log('Uploaded 1, skipped 0, to check 0, failed 0'); console.log('  + Guide');`);
  w('claw/dist/mission-cli.js', `if (process.argv[2] === 'create') console.log('Mission task created: m42\\n  Title:    ' + process.argv[6]); else console.log('1 mission task:\\n\\nm42 [queued] @main\\n  Title:   Approve reel 3 version B (batch-2026-11-14-001)\\n');`);
  const cfg = loadConfig({ root, uploadsDir: join(root, 'Uploads'), missionCli: join(root, 'claw/dist/mission-cli.js'), gumroadScript: join(root, 'fake/gumroad.mjs'), queueHealthUrl: null });
  return { root, cfg, pdf: join(root, 'instagram_scripts_output/resources/Guide.pdf') };
}
const ONE = '2026-11-14-001-01';

test('a PDF is held for approval, and the approval is tied to the exact file', async () => {
  const { cfg, pdf } = fixture2(); let s = buildState(cfg, NOW); let one = by(s, ONE);
  assert.equal(one.resource.gate, 'awaiting'); assert.ok(one.needs.some(n => n.label === 'Review the PDF guide'));
  assert.equal(existsSync(cfg.approvalsFile), false);
  await assert.rejects(handleAction(cfg, { id: ONE, type: 'approve-pdf', sha: 'f'.repeat(64) }), /changed since you opened it/);
  assert.equal(existsSync(cfg.approvalsFile), false, 'a stale hash must not record an approval');
  const sha1 = one.resource.sha;
  await assert.rejects(handleAction(cfg, { id: ONE, type: 'upload-pdf', sha: sha1 }), /Only an approved PDF/);
  assert.match(await handleAction(cfg, { id: ONE, type: 'approve-pdf', sha: sha1 }, { wait: true }), /Nothing was uploaded/);
  assert.equal(JSON.parse(readFileSync(cfg.approvalsFile, 'utf8')).GUIDE.sha256, sha1);
  one = by(buildState(cfg, NOW), ONE);
  assert.equal(one.resource.gate, 'approved'); assert.equal(one.resource.upload, null, 'approving uploads nothing');
  assert.deepEqual(one.needs.filter(n => /PDF/.test(n.label)).map(n => n.label), ['Upload the approved PDF to Gumroad']);
  await assert.rejects(handleAction(cfg, { id: ONE, type: 'upload-pdf', sha: 'f'.repeat(64) }), /changed since you opened it/);
  assert.match(await handleAction(cfg, { id: ONE, type: 'upload-pdf', sha: sha1 }, { wait: true }), /Uploading this exact approved PDF/);
  one = by(buildState(cfg, NOW), ONE); assert.equal(one.resource.upload.state, 'uploaded'); assert.ok(!one.needs.some(n => /PDF/.test(n.label)));
  assert.equal(one.resource.state, 'live', 'a verified Gumroad upload makes the keyword live (Mits, 2026-11-16)');
  assert.match(readFileSync(cfg.resourcesMd, 'utf8'), /Guide\.pdf \| live/); assert.notEqual(one.platforms.ig.state, 'blocked');
  writeFileSync(pdf, '%PDF-1.4 rebuilt guide');
  one = by(buildState(cfg, NOW), ONE);
  assert.equal(one.resource.gate, 'changed'); assert.notEqual(one.resource.sha, sha1); assert.equal(one.resource.upload, null);
  assert.ok(one.needs.some(n => n.label === 'Review the PDF guide' && /rebuilt after you approved/.test(n.why)));
  await assert.rejects(handleAction(cfg, { id: ONE, type: 'retry-upload' }), /Only an approved PDF/);
});

test('request changes records feedback only; starting the revision is a separate step', async () => {
  const { cfg, pdf } = fixture2(); const sha = by(buildState(cfg, NOW), ONE).resource.sha;
  assert.match(await handleAction(cfg, { id: ONE, type: 'feedback', asset: 'pdf', text: 'Step 3 needs the menu name' }), /Nothing has started/);
  let one = by(buildState(cfg, NOW), ONE);
  assert.equal(one.resource.gate, 'awaiting'); assert.equal(existsSync(cfg.approvalsFile), false); assert.equal(one.feedback[0].started, null);
  assert.deepEqual(one.needs.filter(n => /PDF/.test(n.label)).map(n => n.label), ['PDF feedback recorded, revision not started']);
  await assert.rejects(handleAction(cfg, { id: ONE, type: 'approve-pdf', sha }), /asked for changes to this version/);
  await assert.rejects(handleAction(cfg, { id: ONE, type: 'feedback', asset: 'pdf', text: '  ' }), /Write what should change/);
  const msg = await handleAction(cfg, { id: ONE, type: 'start-revision', index: 0 });
  assert.match(msg, /No job was started/); assert.match(msg, /Revise the resource guide for keyword GUIDE/); assert.match(msg, /Do not upload to Gumroad/);
  one = by(buildState(cfg, NOW), ONE);
  assert.ok(one.feedback[0].started); assert.ok(!one.needs.some(n => /PDF/.test(n.label)), 'no approval is asked while the revision is out');
  await assert.rejects(handleAction(cfg, { id: ONE, type: 'start-revision', index: 0 }), /already started/);
  writeFileSync(pdf, '%PDF-1.4 revised guide');
  one = by(buildState(cfg, NOW), ONE);
  assert.equal(one.feedback[0].current, false); assert.equal(one.resource.gate, 'awaiting'); assert.ok(one.needs.some(n => n.label === 'Review the PDF guide'));
});

test('choosing a script records the choice and hands over the exact version; a queued job is tracked', async () => {
  const { cfg } = fixture2(); const id = '2026-11-14-001-03';
  await assert.rejects(handleAction(cfg, { id, type: 'decide', version: 'D' }), /Choose version A, B or C/);
  await assert.rejects(handleAction(cfg, { id, type: 'decide', version: 'C' }), /Version C is empty/);
  await assert.rejects(handleAction(cfg, { id: ONE, type: 'decide', version: 'A' }), /not waiting for a script choice/);
  let msg = await handleAction(cfg, { id, type: 'decide', version: 'B' });
  assert.match(msg, /No job was started/); assert.match(msg, /\/approve-reel reel 3 version B, batch batch-2026-11-14-001/);
  let it = by(buildState(cfg, NOW), id);
  assert.equal(it.stage, 'choose', 'the stage moves only when the approved file exists');
  assert.equal(it.decision.version, 'B'); assert.equal(it.decision.command, '/approve-reel reel 3 version B, batch batch-2026-11-14-001'); assert.equal(it.needs[0].label, 'Finish approving Version B');
  await handleAction(cfg, { id, type: 'decide', version: null }); assert.equal(by(buildState(cfg, NOW), id).decision, null);
  await probeQueue(cfg); cfg.runtime.queue.running = true; // pretend ClaudeClaw is up; the fake CLI answers
  msg = await handleAction(cfg, { id, type: 'decide', version: 'A' }); assert.match(msg, /queued in ClaudeClaw/);
  it = by(buildState(cfg, NOW), id); assert.deepEqual(it.jobs.map(j => [j.id, j.kind, j.status]), [['m42', 'approve', 'queued']]);
});

test('Version C: Mits writes his own script, saves it, approves it, and it is locked while chosen', async () => {
  const { cfg } = fixture2(); const id = '2026-11-14-001-03'; const file = join(cfg.root, 'reels-data/content/version-c', id + '.txt');
  assert.equal(itemDetail(cfg, buildState(cfg, NOW), id).versionC, null, 'empty until written');
  await assert.rejects(handleAction(cfg, { id: ONE, type: 'version-c', text: 'x' }), /not waiting for a script choice/);
  let msg = await handleAction(cfg, { id, type: 'version-c', text: 'My own hook.\r\nMy own payoff.\n\n' });
  assert.match(msg, /Version C saved/); assert.equal(readFileSync(file, 'utf8'), 'My own hook.\nMy own payoff.\n');
  assert.equal(itemDetail(cfg, buildState(cfg, NOW), id).versionC.text, 'My own hook.\nMy own payoff.');
  msg = await handleAction(cfg, { id, type: 'decide', version: 'C' });
  assert.match(msg, /approve-reel reel 3 version C, batch batch-2026-11-14-001 \(Mits's own script, in reels-data\/content\/version-c\/2026-11-14-001-03\.txt/);
  let it = by(buildState(cfg, NOW), id); assert.equal(it.decision.version, 'C'); assert.match(it.decision.sha, /^[a-f0-9]{64}$/); assert.equal(it.needs[0].label, 'Finish approving Version C');
  await assert.rejects(handleAction(cfg, { id, type: 'version-c', text: 'changed' }), /Change your choice first/);
  await handleAction(cfg, { id, type: 'decide', version: null });
  msg = await handleAction(cfg, { id, type: 'version-c', text: '   ' }); assert.match(msg, /Version C cleared/);
  assert.equal(itemDetail(cfg, buildState(cfg, NOW), id).versionC, null);
  await assert.rejects(handleAction(cfg, { id, type: 'decide', version: 'C' }), /Version C is empty/);
  // An approved Version C file is read like A or B.
  writeFileSync(join(cfg.root, 'instagram_scripts_output/approved/batch-2026-11-14-001/03-sample-reel-3-version-c.txt'), 'Status at approval: READY TO RECORD\n');
  it = by(buildState(cfg, NOW), id); assert.equal(it.version, 'C'); assert.notEqual(it.stage, 'choose');
});

test('queue output and upload results are read correctly', () => {
  assert.deepEqual(parseMissions('2 mission tasks:\n\nabc [running] @main\n  Title:   One\n  Created: x\n\ndef [queued] @\n  Title:   Two\n'), [{ id: 'abc', status: 'running', agent: 'main', title: 'One' }, { id: 'def', status: 'queued', agent: '', title: 'Two' }]);
  assert.equal(classifyUpload({ code: 0, log: 'Uploaded 1, skipped 0' }), 'uploaded'); assert.equal(classifyUpload({ code: 0, log: 'SKIP  x: already on Gumroad, same size' }), 'already-there');
  assert.equal(classifyUpload({ code: 0, log: 'SKIP  x: not Claude-related (set ...)' }), 'not-applicable'); assert.equal(classifyUpload({ code: 0, log: 'Uploaded 0, skipped 0' }), 'nothing-uploaded');
  assert.equal(classifyUpload({ code: 3, log: '' }), 'login-needed'); assert.equal(classifyUpload({ code: 4, log: '' }), 'held'); assert.equal(classifyUpload({ code: 1, log: '' }), 'failed');
  assert.equal(classifyUpload({ code: 0, log: 'Uploaded 0, skipped 0, to check 1, failed 0\n  ? Guide (uploaded, Gumroad still processing; check its size later)' }), 'processing');
  assert.equal(classifyUpload({ code: 0, log: 'Uploaded 1, skipped 0, to check 1, failed 0\n  ? Guide (attached but not shown on a content page)' }), 'needs-check');
});

test('checking a processing upload is read-only and verifies size and the content-page listing', async () => {
  const { root, cfg } = fixture2();
  await approvePdf(cfg);
  const resource = by(buildState(cfg, NOW), ONE).resource;
  const manifestFile = join(cfg.contentDir, ONE + '.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  manifest.upload = { state: 'nothing-uploaded', code: 0, sha: resource.sha, log: 'Uploaded 0, skipped 0, to check 1, failed 0\n  ? Guide (uploaded, Gumroad still processing; check its size later)' };
  writeFileSync(manifestFile, JSON.stringify(manifest));
  assert.equal(by(buildState(cfg, NOW), ONE).resource.upload.state, 'processing', 'older saved logs are classified correctly without another upload');
  const script = join(root, 'fake/check-gumroad.mjs');
  const fileSize = statSync(join(root, resource.pdf)).size;
  writeFileSync(join(root, 'reels-data/gumroad.json'), JSON.stringify({ productId: 'sample-product' }));
  writeFileSync(script, `import {readFileSync,appendFileSync} from 'node:fs';
const args=process.argv.slice(2); appendFileSync(${JSON.stringify(join(root, 'fake/check-calls.jsonl'))},JSON.stringify(args)+'\\n');
if(args[0]!=='products'||!['view','content'].includes(args[1])) process.exit(1);
const reply=JSON.parse(readFileSync(${JSON.stringify(join(root, 'fake/check-reply.json'))},'utf8'));
console.log(JSON.stringify(args[1]==='view'?{product:{id:'sample-product',files:[{id:'sample-file',name:'Guide',size:reply.size}]}}:reply.content));`);
  cfg.gumroadCommand = [process.execPath, script];
  const reply = value => writeFileSync(join(root, 'fake/check-reply.json'), JSON.stringify(value));
  reply({ size: null, content: ['sample-file'] });
  assert.equal(classifyUpload(checkUpload(cfg, resource)), 'processing');
  reply({ size: fileSize + 1, content: ['sample-file'] });
  assert.equal(classifyUpload(checkUpload(cfg, resource)), 'needs-check');
  reply({ size: fileSize, content: [] });
  assert.equal(classifyUpload(checkUpload(cfg, resource)), 'needs-check');
  assert.match(await handleAction(cfg, { id: ONE, type: 'check-upload', sha: resource.sha }), /nothing was uploaded/);
  assert.equal(by(buildState(cfg, NOW), ONE).resource.state, 'draft', 'an upload that still needs checking does not make the keyword live');
  reply({ size: fileSize, content: ['sample-file'] });
  assert.match(await handleAction(cfg, { id: ONE, type: 'check-upload', sha: resource.sha }), /Verified.*GUIDE is now live/);
  assert.equal(by(buildState(cfg, NOW), ONE).resource.upload.state, 'uploaded');
  assert.equal(by(buildState(cfg, NOW), ONE).resource.state, 'live');
  assert.match(readFileSync(join(cfg.contentDir, 'history.jsonl'), 'utf8'), /"by":"verified Gumroad upload"/);
  const calls = readFileSync(join(root, 'fake/check-calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.ok(calls.every(args => args[0] === 'products' && (args[1] === 'view' || args.slice(1, 3).join(' ') === 'content get')));
  await assert.rejects(handleAction(cfg, { id: ONE, type: 'check-upload', sha: 'f'.repeat(64) }), /PDF changed/);
  writeFileSync(join(root, resource.pdf), '%PDF-changed');
  assert.throws(() => checkUpload(cfg, resource), /PDF changed/);
});

test('the real upload script holds a PDF that is unapproved or changed since approval', (t) => {
  const { root } = fixture();
  const w = (p, b) => { const f = join(root, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, b); };
  mkdirSync(join(root, '.claude/skills/approve-reel'), { recursive: true });
  copyFileSync(join(import.meta.dirname, '../.claude/skills/approve-reel/gumroad_upload.mjs'), join(root, '.claude/skills/approve-reel/gumroad_upload.mjs'));
  w('reels-data/gumroad.json', JSON.stringify({ productId: 'not-a-real-product', productNameStartsWith: 'x', pageId: 'p', url: 'u' }));
  w('reels-data/resource-sources/held.pdf.json', JSON.stringify({ keyword: 'HELD', name: 'Claude Held', topic: 'A Test Guide' }));
  w('instagram_scripts_output/resources/Claude Held - A Test Guide.pdf', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2000, 32)]));
  const run = () => spawnSync(process.execPath, [join(root, '.claude/skills/approve-reel/gumroad_upload.mjs'), 'held', '--dry-run'], { encoding: 'utf8' });
  let r = run(); if (/Gumroad CLI not found/.test(r.stderr + r.stdout)) return t.skip('Gumroad CLI is not installed on this machine');
  assert.equal(r.status, 4); assert.match(r.stdout, /HOLD\s+held: this PDF has not been approved/);
  w('reels-data/content/pdf-approvals.json', JSON.stringify({ HELD: { sha256: '0'.repeat(64) } }));
  r = run(); assert.equal(r.status, 4); assert.match(r.stdout, /HOLD\s+held: the PDF changed after it was approved/);
});

// ---------------------------------------------------------------- phase 3: publishing
const { classify, createServer, lanAddresses } = await import('../dashboard/server.mjs');
const T = s => new Date(s);
const approvePdf = async cfg => handleAction(cfg, { id: ONE, type: 'approve-pdf', sha: by(buildState(cfg, NOW), ONE).resource.sha }, { wait: true });
const goLive = cfg => handleAction(cfg, { id: ONE, type: 'resource-status', keyword: 'GUIDE', to: 'live', confirmed: true });

test('marking a keyword live changes that one line of resources.md and nothing else', async () => {
  const { root, cfg } = fixture2(); const md = join(root, 'reels-data/resources.md');
  writeFileSync(md, '# Resources\r\n\r\n- KEYWORD: what | delivery | file | draft or live\r\n- OTHER: a draft thing | to confirm | x.pdf | draft\r\n- GUIDE: the steps | to confirm | instagram_scripts_output/resources/Guide.pdf | draft\r\n\r\nNotes mention draft too.\r\n');
  const text0 = readFileSync(md, 'utf8');
  await assert.rejects(goLive(cfg), /Approve this PDF first/);
  await approvePdf(cfg);
  await assert.rejects(handleAction(cfg, { id: ONE, type: 'resource-status', keyword: 'GUIDE', to: 'live' }), /Tick the box/);
  await assert.rejects(handleAction(cfg, { id: ONE, type: 'resource-status', keyword: 'OTHER', to: 'live', confirmed: true }), /does not belong to this reel/);
  assert.equal(readFileSync(md, 'utf8'), text0, 'a refused request must not touch the file');
  const before = hashTree(root, cfg.contentDir);
  assert.match(await goLive(cfg), /GUIDE is now live/);
  assert.equal(readFileSync(md, 'utf8'), text0.replace('Guide.pdf | draft', 'Guide.pdf | live'));
  const after = hashTree(root, cfg.contentDir); const changed = Object.keys(after).filter(k => after[k] !== before[k]).concat(Object.keys(before).filter(k => !(k in after)));
  assert.deepEqual(changed, [md], 'only resources.md may change outside the content folder');
  const one = by(buildState(cfg, NOW), ONE); assert.equal(one.resource.state, 'live'); assert.equal(one.platforms.ig.state, 'ready');
  await assert.rejects(goLive(cfg), /already live/);
  await handleAction(cfg, { id: ONE, type: 'resource-status', keyword: 'GUIDE', to: 'draft' });
  assert.equal(readFileSync(md, 'utf8'), text0); assert.equal(by(buildState(cfg, NOW), ONE).platforms.ig.state, 'blocked');
});

test('Instagram, Shorts and TikTok are recorded one at a time; one never marks another', async () => {
  const { cfg } = fixture2(); const at = '2026-11-14T21:30:00.000Z'; const pub = (platform, extra) => handleAction(cfg, { id: ONE, type: 'publish', platform, at, ...extra });
  await assert.rejects(pub('instagram'), /Keyword GUIDE is not live yet/);
  await assert.rejects(pub('youtube'), /Record the Instagram post first/);
  await approvePdf(cfg); await goLive(cfg);
  await assert.rejects(pub('instagram', { at: '2099-01-01T00:00:00Z' }), /in the future/);
  await assert.rejects(pub('instagram', { at: 'soon' }), /Enter the time/);
  await assert.rejects(pub('instagram', { url: 'https://example.com/reel/x' }), /not from instagram.com/);
  await assert.rejects(pub('instagram', { url: 'https://instagram.com.evil.test/reel/x' }), /not from instagram.com/);
  await assert.rejects(pub('linkedin'), /Unknown platform/); // Facebook became a real, separately recorded destination
  assert.equal(by(buildState(cfg, NOW), ONE).stage, 'instagram', 'refused requests record nothing');
  assert.match(await pub('instagram', { url: 'https://www.instagram.com/reel/abc/' }), /Shorts and TikTok now have a due date/);
  let one = by(buildState(cfg, T('2026-11-15T12:00:00Z')), ONE);
  assert.equal(one.stage, 'distribute'); assert.equal(one.platforms.ig.state, 'published'); assert.equal(one.platforms.ig.manual, true); assert.equal(one.due, '2026-11-16T09:00:00.000Z');
  assert.deepEqual([one.platforms.yt.state, one.platforms.tt.state, one.platforms.yt.bucket], ['waiting', 'waiting', 'upcoming']);
  assert.ok(!one.needs.some(n => /Post to/.test(n.label)), 'nothing is asked before the due time');
  assert.ok(one.unknowns.some(u => /entered by you/.test(u)));
  one = by(buildState(cfg, T('2026-11-16T08:59:00Z')), ONE); assert.deepEqual([one.platforms.yt.state, one.platforms.yt.bucket], ['waiting', 'today']);
  one = by(buildState(cfg, T('2026-11-16T09:00:00Z')), ONE);
  assert.deepEqual(one.needs.filter(n => /Post to/.test(n.label)).map(n => n.label), ['Post to YouTube Shorts', 'Post to TikTok']);
  one = by(buildState(cfg, T('2026-11-17T00:30:00Z')), ONE); assert.equal(one.platforms.tt.bucket, 'overdue');
  await assert.rejects(pub('instagram'), /already recorded/);
  await pub('youtube', { at: '2026-11-16T09:30:00Z', url: 'https://youtube.com/shorts/abc' });
  one = by(buildState(cfg, T('2026-11-16T10:00:00Z')), ONE);
  assert.equal(one.platforms.yt.state, 'published'); assert.equal(one.platforms.tt.state, 'due'); assert.equal(one.stage, 'distribute');
  assert.deepEqual(one.needs.filter(n => /Post to/.test(n.label)).map(n => n.label), ['Post to TikTok']);
  await assert.rejects(handleAction(cfg, { id: ONE, type: 'unpublish', platform: 'instagram' }), /Withdraw the Shorts and TikTok records first/);
  await pub('tiktok', { at: '2026-11-16T09:40:00Z' });
  one = by(buildState(cfg, T('2026-11-16T10:00:00Z')), ONE); assert.equal(one.stage, 'done'); assert.equal(one.platforms.tt.url, null); assert.equal(one.needs.length, 0);
  await handleAction(cfg, { id: ONE, type: 'unpublish', platform: 'tiktok' });
  one = by(buildState(cfg, T('2026-11-16T10:00:00Z')), ONE); assert.equal(one.stage, 'distribute'); assert.equal(one.platforms.yt.state, 'published'); assert.equal(one.platforms.tt.state, 'due');
});

test('the overdue, today and upcoming buckets follow the calendar day in the due timezone', () => {
  const { root, cfg } = fixture(); const f = join(root, 'reels-data/insights/links.json'); const j = JSON.parse(readFileSync(f, 'utf8'));
  j.entries[1].status = 'confirmed'; j.entries[1].published_at = '2026-07-01T23:30:00Z'; writeFileSync(f, JSON.stringify(j)); // 00:30 on 2 July in London, due 4 July 09:00 BST
  const b = now => { const y = by(buildState(cfg, T(now)), ONE).platforms.yt; return [y.bucket, y.state]; };
  assert.deepEqual(b('2026-07-03T22:59:00Z'), ['upcoming', 'waiting']); // 23:59 on 3 July in London
  assert.deepEqual(b('2026-07-03T23:01:00Z'), ['today', 'waiting']);    // 00:01 on 4 July
  assert.deepEqual(b('2026-07-04T08:00:00Z'), ['today', 'due']);
  assert.deepEqual(b('2026-07-04T23:01:00Z'), ['overdue', 'due']);
});

test('an Instagram post from before Shorts and TikTok were recorded reads "not recorded" and asks for nothing', async () => {
  const { root, cfg } = fixture(); const f = join(root, 'reels-data/insights/links.json'); const j = JSON.parse(readFileSync(f, 'utf8'));
  j.entries[1].status = 'confirmed'; j.entries[1].published_at = '2026-11-10T12:00:00Z'; writeFileSync(f, JSON.stringify(j));
  const old = { ...cfg, trackFrom: T('2026-11-16T00:00:00Z') }; const at = T('2026-11-16T10:00:00Z');
  let one = by(buildState(old, at), ONE);
  assert.equal(one.stage, 'distribute'); assert.deepEqual([one.platforms.yt.state, one.platforms.tt.state], ['not-recorded', 'not-recorded']);
  assert.ok(!one.needs.some(n => /Post to/.test(n.label))); assert.ok(one.unknowns.some(u => /before the dashboard recorded Shorts and TikTok/.test(u)));
  await handleAction(old, { id: ONE, type: 'publish', platform: 'youtube', at: '2026-11-12T09:00:00Z' });
  one = by(buildState(old, at), ONE); assert.deepEqual([one.platforms.yt.state, one.platforms.tt.state], ['published', 'not-recorded']);
  assert.equal(by(buildState(cfg, at), ONE).platforms.tt.state, 'due', 'the same post after the tracking date is due');
});

test('a linked Uploads file says where the reel is: root is Instagram only, the all-platforms folder is everywhere', async () => {
  const { root, cfg } = fixture(); const { renameSync } = await import('node:fs'); const at = T('2026-11-16T10:00:00Z');
  writeFileSync(join(root, 'Uploads/one.mp4'), 'video');
  assert.equal(by(buildState(cfg, at), ONE).stage, 'instagram', 'an unlinked file says nothing');
  await handleAction(cfg, { id: ONE, type: 'link', kind: 'uploadsFile', value: 'one.mp4' });
  let one = by(buildState(cfg, at), ONE);
  assert.equal(one.stage, 'distribute'); assert.deepEqual([one.platforms.ig.state, one.platforms.ig.source, one.platforms.yt.state, one.platforms.tt.state], ['published', 'folder', 'due', 'due']);
  assert.deepEqual(one.needs.filter(n => /Post to/.test(n.label)).map(n => n.label), ['Post to YouTube Shorts', 'Post to TikTok']); assert.equal(one.active, true);
  renameSync(join(root, 'Uploads/one.mp4'), join(root, 'Uploads/All social media/one.mp4'));
  assert.equal(by(buildState(cfg, at), ONE).stage, 'instagram', 'a link to a file that moved is not followed by guesswork');
  await handleAction(cfg, { id: ONE, type: 'link', kind: 'uploadsFile', value: 'All social media/one.mp4' });
  one = by(buildState(cfg, at), ONE);
  assert.equal(one.stage, 'done'); assert.deepEqual([one.platforms.yt.state, one.platforms.yt.source, one.platforms.tt.state], ['published', 'folder', 'published']); assert.equal(one.needs.filter(n => /Post to/.test(n.label)).length, 0);
});

test('a post confirmed for a video project counts for the script that holds that project', () => {
  const { root, cfg } = fixture(); const f = join(root, 'reels-data/insights/links.json'); const j = JSON.parse(readFileSync(f, 'utf8'));
  j.entries[9] = { ig_media_id: '9', status: 'confirmed', published_at: '2026-11-14T21:30:00Z', permalink: 'https://www.instagram.com/reel/z/', project: { slug: 'sample-one' }, approved: null }; writeFileSync(f, JSON.stringify(j));
  const one = by(buildState(cfg, T('2026-11-16T10:00:00Z')), ONE);
  assert.equal(one.stage, 'distribute'); assert.equal(one.platforms.ig.state, 'published'); assert.equal(one.platforms.ig.url, 'https://www.instagram.com/reel/z/');
});

test('a proposed Instagram post counts only after it is confirmed through ig-insights', async () => {
  const { root } = fixture(); const KEY = '17900000000000002'; const TWO = '2026-11-14-001-02'; const links = join(root, 'reels-data/insights/links.json');
  const j = JSON.parse(readFileSync(links, 'utf8')); j.entries[KEY] = { ...j.entries[2], ig_media_id: KEY }; delete j.entries[2]; writeFileSync(links, JSON.stringify(j));
  const fake = join(root, 'fake/link.mjs'); mkdirSync(dirname(fake), { recursive: true });
  writeFileSync(fake, `import { readFileSync, writeFileSync } from 'node:fs'; const [cmd, key, flag, slug] = process.argv.slice(2);
    const f = process.env.HERK_BASE + '/reels-data/insights/links.json'; const j = JSON.parse(readFileSync(f, 'utf8'));
    if (cmd !== 'confirm' || flag !== '--project' || !j.entries[key]) { console.error('No entry ' + key); process.exit(1); }
    j.entries[key].status = 'confirmed'; j.entries[key].project = { slug }; writeFileSync(f, JSON.stringify(j));`);
  const opts = { root, uploadsDir: join(root, 'Uploads'), missionCli: false };
  const cfg = loadConfig({ ...opts, linkCommand: [process.execPath, fake] });
  let two = by(buildState(cfg, NOW), TWO); assert.equal(two.platforms.ig.state, 'not-yet'); assert.equal(two.suggestions[0].key, KEY);
  await assert.rejects(handleAction(cfg, { id: TWO, type: 'confirm-post', key: '999999' }), /no longer proposed/);
  await assert.rejects(handleAction(cfg, { id: ONE, type: 'confirm-post', key: KEY }), /no longer proposed/);
  const links0 = readFileSync(links, 'utf8');
  const broken = loadConfig({ ...opts, linkCommand: [process.execPath, join(root, 'fake/missing.mjs')] });
  await assert.rejects(handleAction(broken, { id: TWO, type: 'confirm-post', key: KEY }), /ig-insights did not confirm the post/);
  assert.equal(readFileSync(links, 'utf8'), links0); assert.equal(existsSync(cfg.contentDir), false, 'a failed confirmation records nothing');
  assert.match(await handleAction(cfg, { id: TWO, type: 'confirm-post', key: KEY }), /Confirmed in ig-insights/);
  two = by(buildState(cfg, T('2026-11-16T10:00:00Z')), TWO);
  assert.equal(two.platforms.ig.state, 'published'); assert.equal(two.platforms.ig.manual, false); assert.equal(two.project.slug, 'awaiting'); assert.equal(two.due, '2026-11-17T09:00:00.000Z');
});

test('phone access needs the home network, the address of this machine and the token; the PC needs none', () => {
  const { cfg } = fixture(); const req = (addr, host, cookie) => ({ headers: { host, cookie }, socket: { remoteAddress: addr } }); const u = q => new URL('http://x/' + (q || ''));
  assert.deepEqual(classify(cfg, req('127.0.0.1', 'localhost:4319'), u()), { who: 'local' });
  assert.ok(classify(cfg, req('127.0.0.1', 'evil.test'), u()).refuse, 'a rebinding host name is refused');
  assert.ok(classify(cfg, req('192.168.1.50', 'localhost:4319'), u()).refuse, 'a forged Host header does not make a remote device local');
  const ip = lanAddresses()[0]; const tok = 'A'.repeat(43); const host = (ip || '192.168.1.2') + ':4319';
  const lan = { ...cfg, lan: true, token: tok };
  assert.ok(classify({ ...cfg, lan: true }, req('192.168.1.50', host), u('?k=' + tok)).refuse, 'no token configured');
  assert.ok(classify(lan, req('8.8.8.8', host), u('?k=' + tok)).refuse, 'not a home-network address');
  assert.ok(classify(lan, req('192.168.1.50', 'evil.test'), u('?k=' + tok)).refuse, 'wrong host');
  if (!ip) return; // no network on this machine: the token path cannot be exercised
  assert.ok(classify(lan, req('192.168.1.50', host), u()).refuse); assert.ok(classify(lan, req('192.168.1.50', host), u('?k=' + 'B'.repeat(43))).refuse);
  assert.deepEqual(classify(lan, req('192.168.1.50', host), u('?k=' + tok)), { who: 'remote', setCookie: true });
  assert.deepEqual(classify(lan, req('::ffff:192.168.1.50', host, 'a=1; dash_k=' + tok), u()), { who: 'remote' });
});

test('the final video downloads under the project name', async () => {
  const { cfg } = fixture(); const srv = createServer(cfg); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const base = 'http://localhost:' + srv.address().port; const p = encodeURIComponent('video-projects/sample-one/renders/final.mp4');
    const r = await fetch(`${base}/file?p=${p}&dl=1`); assert.equal(r.status, 200); assert.equal(r.headers.get('content-disposition'), 'attachment; filename="sample-one.mp4"'); await r.arrayBuffer();
    const plain = await fetch(`${base}/file?p=${p}`); assert.equal(plain.headers.get('content-disposition'), null); await plain.arrayBuffer();
    const s = await (await fetch(base + '/api/state')).json(); assert.equal(s.remote, false);
  } finally { srv.close(); }
});

// ---------------------------------------------------------------- phase 4: hook and candidate approvals
// These run the real Reel Studio scripts (preflight-reel.mjs, approve-reel.mjs) against a scratch project in the
// temp folder. The video file is synthetic bytes and its QA record is built with the real evaluate(); rendering
// and full QA are not exercised here (npm run test:reel-smoke does that).
const { cpSync, renameSync: mv } = await import('node:fs');
const repo = join(import.meta.dirname, '..'); const reelScripts = join(repo, '.claude/skills/create-reel/scripts');
const { getProfile } = await import('../.claude/skills/create-reel/scripts/lib.mjs');
const { convertToVertical } = await import('../.claude/skills/create-reel/scripts/new-reel.mjs');
const qaCore = await import('../.claude/skills/create-reel/scripts/qa-core.mjs');
const { facelessPlan, writePlan } = await import('./fixtures/visual-plans.mjs');
const cli = (script, ...args) => spawnSync(process.execPath, [join(reelScripts, script), ...args], { encoding: 'utf8', windowsHide: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha256 = p => createHash('sha256').update(readFileSync(p)).digest('hex');
function scratchReel(root, slug) {
  const dir = join(root, 'video-projects', slug); cpSync(join(repo, 'examples/starter'), dir, { recursive: true });
  mkdirSync(join(dir, 'assets'), { recursive: true }); mkdirSync(join(dir, 'renders'), { recursive: true }); writeFileSync(join(dir, 'assets/gsap.min.js'), '');
  convertToVertical(dir, { slug, profile: getProfile('organic'), duration: 2, mode: 'faceless', title: 'Scratch reel' });
  const reel = JSON.parse(readFileSync(join(dir, 'reel.json'), 'utf8')); reel.direction = { hook: 'h', coreClaim: 'c', heroBeat: 'b', motif: 'm', style: 'kallaway' }; writeFileSync(join(dir, 'reel.json'), JSON.stringify(reel, null, 2));
  writePlan(dir, facelessPlan(2)); return dir;
}
const recordOpening = dir => { const r = cli('preflight-reel.mjs', dir, '--record-opening', '--end', '2', '--url', 'http://localhost:3002/#scratch'); assert.equal(r.status, 0, r.stdout + r.stderr); };

test('the hook is approved by the real preflight script, only for the plan on screen, and only after it is saved', async () => {
  const { root, cfg } = fixture2(); const dir = scratchReel(root, 'hookreel'); const TWO = '2026-11-14-001-02'; const reelJson = join(dir, 'reel.json');
  await handleAction(cfg, { id: TWO, type: 'link', kind: 'project', value: 'hookreel' });
  let it = by(buildState(cfg, NOW), TWO); const fp = it.project.hook.fingerprint;
  assert.equal(it.stage, 'hook'); assert.equal(it.project.hook.valid, true); assert.match(fp, /^[a-f0-9]{64}$/); assert.equal(it.project.hook.openingOk, false);
  assert.ok(!it.needs.some(n => /hook/i.test(n.label)), 'nothing to review until the opening is recorded');
  await assert.rejects(handleAction(cfg, { id: TWO, type: 'approve-hook', fingerprint: fp, watched: true }), /opening preview has not been recorded/);
  recordOpening(dir);
  it = by(buildState(cfg, NOW), TWO); assert.ok(it.needs.some(n => n.label === 'Review the hook preview')); assert.equal(it.project.opening.url, 'http://localhost:3002/#scratch');
  const before = readFileSync(reelJson, 'utf8');
  await assert.rejects(handleAction(cfg, { id: TWO, type: 'approve-hook', fingerprint: 'f'.repeat(64), watched: true }), /plan changed since you opened it/);
  await assert.rejects(handleAction(cfg, { id: ONE, type: 'approve-hook', fingerprint: fp, watched: true }), /not waiting for a hook approval/);
  // request changes: feedback only, approval held, the revision is a separate step and stays visibly unfinished
  assert.match(await handleAction(cfg, { id: TWO, type: 'feedback', asset: 'hook', text: 'The first line lands too late' }), /Nothing has started/);
  await assert.rejects(handleAction(cfg, { id: TWO, type: 'approve-hook', fingerprint: fp, watched: true }), /asked for changes to this hook/);
  assert.equal(readFileSync(reelJson, 'utf8'), before, 'refused requests and feedback leave reel.json alone');
  const msg = await handleAction(cfg, { id: TWO, type: 'start-revision', index: 0 });
  assert.match(msg, /paste this there: \/create-reel Revise the opening of video-projects\/hookreel/); assert.match(msg, /Do not approve it/);
  it = by(buildState(cfg, NOW), TWO); assert.equal(it.jobs.length, 0, 'video revisions are never queued'); assert.equal(it.stage, 'hook');
  assert.ok(!it.needs.some(n => /hook/i.test(n.label))); assert.match(it.note, /no new preview has been recorded yet/);
  await sleep(15); recordOpening(dir);
  it = by(buildState(cfg, NOW), TWO); assert.ok(it.needs.some(n => n.label === 'Review the hook preview'), 'a re-recorded opening asks for review again');
  // a creative change makes a new fingerprint; the old one can no longer be approved
  const planFile = join(dir, 'assets/plan.json'); const plan = JSON.parse(readFileSync(planFile, 'utf8'));
  plan.scenes[0].visualIntent = 'A long to-do list tears itself in half on "fail", so the viewer sees the plan break before the claim lands.'; await sleep(15); writeFileSync(planFile, JSON.stringify(plan, null, 2));
  it = by(buildState(cfg, NOW), TWO); const fp2 = it.project.hook.fingerprint; assert.notEqual(fp2, fp); assert.equal(it.project.hook.valid, true);
  await assert.rejects(handleAction(cfg, { id: TWO, type: 'approve-hook', fingerprint: fp, watched: true }), /plan changed since you opened it/);
  // the preview on record was shown before this plan existed, so it cannot stand in for it
  assert.equal(it.project.hook.planAfterPreview, true);
  await assert.rejects(handleAction(cfg, { id: TWO, type: 'approve-hook', fingerprint: fp2, watched: true }), /shown for a different plan/);
  assert.equal(JSON.parse(readFileSync(reelJson, 'utf8')).openingPreview.planFingerprint, fp, 'the opening record names the plan it was shown for');
  await sleep(15); recordOpening(dir); assert.equal(by(buildState(cfg, NOW), TWO).project.hook.planAfterPreview, false);
  await assert.rejects(handleAction(cfg, { id: TWO, type: 'approve-hook', fingerprint: fp2 }), /confirm you watched this opening/);
  const outside = hashTree(root, cfg.contentDir);
  assert.match(await handleAction(cfg, { id: TWO, type: 'approve-hook', fingerprint: fp2, watched: true }), /Hook approved and saved in reel.json/);
  const pf = JSON.parse(readFileSync(reelJson, 'utf8')).preflight; assert.equal(pf.status, 'approved'); assert.equal(pf.fingerprint, fp2); assert.equal(pf.approvedBy, 'Mits'); assert.equal(pf.paidScope, null);
  const after = hashTree(root, cfg.contentDir); assert.deepEqual(Object.keys(after).filter(k => after[k] !== outside[k]), [reelJson], 'only that reel.json changes');
  assert.equal(cli('preflight-reel.mjs', dir, '--json').status, 0); assert.equal(JSON.parse(cli('preflight-reel.mjs', dir, '--json').stdout).approved, true, 'the script itself now reports the plan as approved');
  it = by(buildState(cfg, NOW), TWO); assert.equal(it.stage, 'build'); assert.equal(it.project.hook, null);
  await assert.rejects(handleAction(cfg, { id: TWO, type: 'approve-hook', fingerprint: fp2, watched: true }), /not waiting for a hook approval/);
});

test('a QA-passed candidate becomes the named final byte for byte and a missing final reuses its original approval', async () => {
  const { root, cfg } = fixture2(); const dir = scratchReel(root, 'candreel'); const TWO = '2026-11-14-001-02'; const reelJson = join(dir, 'reel.json');
  recordOpening(dir); const fp = JSON.parse(cli('preflight-reel.mjs', dir, '--json').stdout).fingerprint;
  assert.equal(cli('preflight-reel.mjs', dir, '--approve', '--fingerprint', fp.slice(0, 12), '--approved-by', 'test person').status, 0);
  const candidate = async (version, rows) => { const rel = `renders/candreel-candidate-v00${version}.mp4`; const file = join(dir, rel); writeFileSync(file, `candidate ${version} ${Math.random()}`); const sha = await qaCore.sha256File(file);
    rows = rows || [{ area: 'Render', check: 'duration', status: 'PASS', detail: '', required: true, kind: 'technical' }];
    mkdirSync(qaCore.qaDirFor(dir, file), { recursive: true }); qaCore.writeJson(qaCore.recordPathFor(dir, file), { schema: 'reel-qa/2', project: 'candreel', render: rel, candidate: true, sha256: sha, qaAt: new Date().toISOString(), ...qaCore.evaluate(rows), approval: { status: 'pending' }, results: rows });
    const reel = JSON.parse(readFileSync(reelJson, 'utf8')); (reel.renders ||= []).push({ file: rel, kind: 'candidate', version, sha256: sha, renderedAt: new Date().toISOString() }); writeFileSync(reelJson, JSON.stringify(reel, null, 2)); return { rel, file, sha }; };
  await handleAction(cfg, { id: TWO, type: 'link', kind: 'project', value: 'candreel' });
  // a candidate that failed QA has no approve route at all
  const bad = await candidate(1, [{ area: 'Render', check: 'duration', status: 'FAIL', detail: 'too short', required: true, kind: 'technical' }]);
  let it = by(buildState(cfg, NOW), TWO); assert.equal(it.stage, 'qa'); assert.equal(it.candidate, null);
  await assert.rejects(handleAction(cfg, { id: TWO, type: 'approve-candidate', sha: bad.sha }), /no QA-passed candidate/);
  await assert.rejects(handleAction(cfg, { id: TWO, type: 'feedback', asset: 'candidate', text: 'x' }), /no QA-passed candidate/);
  const c = await candidate(2);
  it = by(buildState(cfg, NOW), TWO); assert.equal(it.stage, 'candidate'); assert.deepEqual(it.candidate, { file: c.rel, sha: c.sha, version: 2 }); assert.ok(it.needs.some(n => n.label === 'Review the candidate'));
  await assert.rejects(handleAction(cfg, { id: TWO, type: 'approve-candidate', sha: bad.sha }), /different candidate is waiting/);
  await handleAction(cfg, { id: TWO, type: 'feedback', asset: 'candidate', text: 'Caption covers the face at 0:12' });
  await assert.rejects(handleAction(cfg, { id: TWO, type: 'approve-candidate', sha: c.sha }), /asked for changes to this candidate/);
  it = by(buildState(cfg, NOW), TWO); assert.deepEqual(it.needs.filter(n => /andidate/.test(n.label)).map(n => n.label), ['Candidate feedback recorded, revision not started']);
  assert.match(await handleAction(cfg, { id: TWO, type: 'start-revision', index: 0 }), /\/create-reel Revise video-projects\/candreel/);
  it = by(buildState(cfg, NOW), TWO); assert.equal(it.stage, 'candidate'); assert.match(it.note, /no new candidate has been rendered yet/); assert.ok(!it.needs.some(n => /andidate/.test(n.label)));
  const final = join(dir, 'renders/candreel-final.mp4');
  assert.equal(existsSync(final), false, 'feedback and a started revision promote nothing');
  // the file changed on disk after QA: the script re-hashes it and refuses, and nothing is promoted
  const good = readFileSync(c.file); writeFileSync(c.file, 'tampered after QA');
  await assert.rejects(handleAction(cfg, { id: TWO, type: 'approve-candidate', sha: c.sha }), /The candidate was not approved: .*changed after QA/);
  assert.equal(existsSync(final), false); assert.equal((JSON.parse(readFileSync(reelJson, 'utf8')).approvals || []).length, 0);
  writeFileSync(c.file, good);
  assert.match(await handleAction(cfg, { id: TWO, type: 'approve-candidate', sha: c.sha }), /That exact file is now renders\/candreel-final.mp4/);
  assert.equal(sha256(final), c.sha, 'the named final is the approved candidate, unchanged'); assert.equal(sha256(c.file), c.sha);
  const ap = JSON.parse(readFileSync(reelJson, 'utf8')).approvals; assert.equal(ap.length, 1); assert.deepEqual([ap[0].status, ap[0].approvedBy, ap[0].candidate, ap[0].sha256], ['approved', 'Mits', c.rel, c.sha]);
  assert.equal(JSON.parse(readFileSync(qaCore.recordPathFor(dir, c.file), 'utf8')).approval.status, 'approved');
  it = by(buildState(cfg, NOW), TWO); assert.equal(it.stage, 'instagram'); assert.equal(it.candidate, null); assert.equal(it.project.finalExists, true);
  await assert.rejects(handleAction(cfg, { id: TWO, type: 'approve-candidate', sha: c.sha }), /no QA-passed candidate/);
  // A missing final must reuse the recorded approval, rather than trying to approve the candidate a second time.
  const originalReel = readFileSync(reelJson, 'utf8'), originalQA = readFileSync(qaCore.recordPathFor(dir, c.file), 'utf8');
  renameSync(final, join(dir, 'renders/saved-final.mp4'));
  it = by(buildState(cfg, NOW), TWO); assert.equal(it.candidate.restore, true); assert.ok(it.needs.some(n => /Restore the approved final/.test(n.label)));
  writeFileSync(c.file, 'changed after approval');
  await assert.rejects(handleAction(cfg, { id: TWO, type: 'approve-candidate', sha: c.sha }), /changed after QA/); assert.equal(existsSync(final), false);
  writeFileSync(c.file, good);
  assert.match(await handleAction(cfg, { id: TWO, type: 'approve-candidate', sha: c.sha }), /Restored the approved final video/);
  assert.equal(sha256(final), c.sha); assert.equal(readFileSync(reelJson, 'utf8'), originalReel); assert.equal(readFileSync(qaCore.recordPathFor(dir, c.file), 'utf8'), originalQA);
  assert.equal(by(buildState(cfg, NOW), TWO).candidate, null);
});
