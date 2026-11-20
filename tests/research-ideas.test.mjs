// Research stage 4: saved ideas, the copyable brief and the short-form export. Throwaway folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const { loadConfig } = await import('../dashboard/lib/config.mjs');
const { importBatch } = await import('../dashboard/lib/research.mjs');
const { researchPost } = await import('../dashboard/lib/research-view.mjs');
const { readIdeas, ideaAction, ideaInfo, ideasView, handoff, exportText, briefText, ideaStage } = await import('../dashboard/lib/ideas.mjs');
const { buildState } = await import('../dashboard/lib/state.mjs');
const { createServer, lanAddresses } = await import('../dashboard/server.mjs');

const NOW = new Date('2026-11-17T12:00:00Z'), AT = '2026-11-17T09:00:00Z';
const SPOKEN = 'So Claude Code is actually better at N8N than N8N is itself. Let me explain.\nNote that this line is spoken: it stays in the transcript.';
const IG = '3802204658396629750', NO_T = '3789920030163839258', NO_DUR = '3803030861483167224', TT = '7708502162103438612', LONG = 'ynEEbqKQSaY', UNK = 'EuUF53Wwfm0';
const ig = (id, url, extra = {}) => ({ platform: 'instagram', id, provider: 'signal-room', url, format: 'short', creator: { handle: 'sample.creator' }, title: 'Comment “agent” for the\nClaude Code + n8n guide', caption: 'Comment agent', publishedAt: '2026-01-03T22:09:09Z', durationSeconds: 39.1, transcript: null, observation: null, ...extra });
function store() {
  const cfg = loadConfig({ root: mkdtempSync(join(tmpdir(), 'ideas-')) });
  importBatch(cfg, { schema: 1, batchId: 'b1', retrievedAt: AT, search: { query: 'n8n', windowDays: 30 }, runs: [
    { provider: 'signal-room', lane: 'instagram_short_form', status: 'ok', results: [IG, NO_T, NO_DUR].map(x => 'instagram:' + x) },
    { provider: 'signal-room', lane: 'youtube_long_form', status: 'ok', results: ['youtube:' + LONG] },
    { provider: 'last30free', lane: 'youtube_discovery', status: 'ok', results: ['youtube:' + UNK] },
    { provider: 'last30free', lane: 'tiktok_hashtag', status: 'ok', results: ['tiktok:' + TT] }],
  posts: [
    ig(IG, 'https://www.instagram.com/p/DTEJP3rEQr2/', { transcript: { text: SPOKEN, origin: 'signal-room', capturedAt: '2026-08-16T16:54:05Z' }, excerpts: [{ kind: 'hook', text: 'So Claude Code is actually better at N8N than N8N is itself.', complete: false }], observation: { measuredAt: '2026-08-16T16:54:05Z', metrics: { plays: 34999, likes: 1220, comments: 963, followers: 229922 }, outlier: { metric: 'reach_per_follower', value: 0.15 } } }),
    ig(NO_T, 'https://www.instagram.com/p/DSYgDAFDaka/', { excerpts: [{ kind: 'snippet', text: 'If you are someone who uses N8N.' }] }), // caption and excerpt, no transcript
    ig(NO_DUR, 'https://www.instagram.com/p/DTHFGtQjU34/', { durationSeconds: null, transcript: { text: 'Spoken words here.', origin: 'signal-room', capturedAt: null } }),
    { platform: 'youtube', id: LONG, provider: 'signal-room', url: 'https://www.youtube.com/watch?v=' + LONG, format: 'long', creator: { name: 'A Channel' }, title: 'n8n released an agent', caption: 'Description text', publishedAt: '2026-11-14T22:20:30Z', durationSeconds: 754, transcript: { text: Array.from({ length: 300 }, (_, i) => 'word' + i).join(' '), origin: 'signal-room', capturedAt: null }, observation: { measuredAt: null, metrics: { views: 151632 }, outlier: { metric: 'bounded_velocity_signal', value: 90.4 } } },
    { platform: 'youtube', id: UNK, provider: 'last30free', url: 'https://www.youtube.com/watch?v=' + UNK, format: 'unknown', title: 'Short-ish video', publishedAt: '2026-11-16T12:59:18Z', durationSeconds: 45, transcript: { text: 'Subtitle words.', origin: 'subtitles', capturedAt: AT }, observation: null },
    { platform: 'tiktok', id: TT, provider: 'last30free', url: `https://www.tiktok.com/@someone/video/${TT}`, format: 'short', title: 'my system #n8n', caption: 'my system #n8n', publishedAt: '2026-11-15T20:45:31Z', durationSeconds: 66, transcript: null, observation: { measuredAt: AT, metrics: { views: 3260 }, discoveryScore: 7.6 } }] });
  return cfg;
}
const post = (cfg, id) => researchPost(cfg, id, '', NOW);
const ideasFile = cfg => join(cfg.researchDir, 'ideas.json');
const drop = cfg => (existsSync(cfg.dropDir) ? readdirSync(cfg.dropDir) : []);

test('any post can be saved, with or without a transcript, and a repeated save duplicates nothing', () => {
  const cfg = store();
  const r = ideaAction(cfg, { type: 'save-idea', postId: 'tiktok-' + TT, angle: '  Show the build live.  ' }, NOW);
  assert.equal(r.message, 'Idea saved.');
  assert.deepEqual(readIdeas(cfg), [{ id: 'idea-tiktok-' + TT, postId: 'tiktok-' + TT, angle: 'Show the build live.', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), exports: [] }]);
  const before = readFileSync(ideasFile(cfg), 'utf8');
  // a second and third click, even with different text in the box, change nothing
  for (const angle of ['Show the build live.', 'something else', '']) assert.match(ideaAction(cfg, { type: 'save-idea', postId: 'tiktok-' + TT, angle }, new Date('2026-11-18T12:00:00Z')).message, /Already saved/);
  assert.equal(readFileSync(ideasFile(cfg), 'utf8'), before);
  ideaAction(cfg, { type: 'save-idea', postId: 'youtube-' + Buffer.from(LONG).toString('hex') }, NOW); // long-form, no angle yet
  assert.equal(readIdeas(cfg).length, 2); assert.equal(readIdeas(cfg)[1].angle, '');
  assert.throws(() => ideaAction(cfg, { type: 'save-idea', postId: 'tiktok-1' }, NOW), /Unknown post/);
  assert.throws(() => ideaAction(cfg, { type: 'save-idea', postId: 'instagram-' + IG, angle: 'x'.repeat(2001) }, NOW), /under 2,000 characters/);
  assert.throws(() => ideaAction(cfg, { type: 'nonsense' }, NOW), /Unknown action/);
});

test('a note can be edited, and it survives research imports byte for byte', () => {
  const cfg = store(); const id = 'idea-instagram-' + IG;
  ideaAction(cfg, { type: 'save-idea', postId: 'instagram-' + IG, angle: 'First angle' }, NOW);
  const later = new Date('2026-11-18T08:00:00Z');
  assert.equal(ideaAction(cfg, { type: 'set-angle', ideaId: id, angle: 'Second angle,\nover two lines' }, later).message, 'Angle saved.');
  assert.equal(ideaAction(cfg, { type: 'set-angle', ideaId: id, angle: 'Second angle,\nover two lines' }, new Date('2026-11-19T08:00:00Z')).message, 'No change.');
  assert.deepEqual([readIdeas(cfg)[0].angle, readIdeas(cfg)[0].createdAt, readIdeas(cfg)[0].updatedAt], ['Second angle,\nover two lines', NOW.toISOString(), later.toISOString()]);
  const before = readFileSync(ideasFile(cfg), 'utf8');
  // a new import that re-measures the same post, and a failed one
  importBatch(cfg, { schema: 1, batchId: 'b2', retrievedAt: '2026-11-18T09:00:00Z', search: { query: 'n8n' }, runs: [{ provider: 'signal-room', lane: 'instagram_short_form', status: 'ok', results: ['instagram:' + IG] }, { provider: 'last30free', lane: 'tiktok_hashtag', status: 'error', error: 'timeout', results: [] }], posts: [ig(IG, 'https://www.instagram.com/p/DTEJP3rEQr2/', { title: 'A corrected title', observation: { measuredAt: '2026-11-18T08:00:00Z', metrics: { plays: 40000 } } })] });
  assert.equal(readFileSync(ideasFile(cfg), 'utf8'), before);
  const v = ideasView(cfg, [], later)[0];
  assert.equal(v.idea.angle, 'Second angle,\nover two lines'); assert.equal(v.post.title, 'A corrected title'); // the idea follows its post; the note is untouched
  assert.throws(() => ideaAction(cfg, { type: 'set-angle', ideaId: 'idea-nope', angle: 'x' }, NOW), /no longer exists/);
  assert.match(ideaAction(cfg, { type: 'remove-idea', ideaId: id }, NOW).message, /Idea removed/); assert.deepEqual(readIdeas(cfg), []);
});

test('export is refused for caption-only, missing-duration, unknown-format and long-form sources', () => {
  const cfg = store();
  const cases = [['tiktok-' + TT, /No full transcript was fetched\. A caption or a search excerpt is not a transcript/], ['instagram-' + NO_T, /A caption or a search excerpt is not a transcript/], ['instagram-' + NO_DUR, /duration is unknown/],
    ['youtube-' + Buffer.from(UNK).toString('hex'), /not verified as short-form/], ['youtube-' + Buffer.from(LONG).toString('hex'), /long-form\. Its production workflow is not connected yet/]];
  for (const [postId, why] of cases) {
    assert.equal(handoff(post(cfg, postId)).ok, false, postId);
    ideaAction(cfg, { type: 'save-idea', postId, angle: 'An angle' }, NOW); // saving always works
    assert.throws(() => ideaAction(cfg, { type: 'export-idea', ideaId: 'idea-' + postId }, NOW), e => /^Cannot export\./.test(e.message) && why.test(e.message), postId);
  }
  assert.deepEqual(drop(cfg), []); assert.ok(readIdeas(cfg).every(i => i.exports.length === 0));
  assert.deepEqual(handoff(post(cfg, 'instagram-' + IG)), { ok: true, reasons: [] });
});

test('the exported file is the workflow\'s input format, with the note apart from the spoken words', () => {
  const cfg = store(); const id = 'idea-instagram-' + IG;
  ideaAction(cfg, { type: 'save-idea', postId: 'instagram-' + IG, angle: 'Show the build live,\nnot a description of it.' }, NOW);
  const r = ideaAction(cfg, { type: 'export-idea', ideaId: id }, NOW);
  const name = `research-instagram-${IG}.md`;
  assert.equal(r.message, `Exported to Instagram_transcript/${name}. Run /rewrite-reels in Claude Code to start the scripts.`);
  assert.deepEqual(drop(cfg), [name]);
  const text = readFileSync(join(cfg.dropDir, name), 'utf8');
  assert.equal(text, [
    '## Reel: sample.creator — Comment “agent” for the Claude Code + n8n guide', '',
    'Source: https://www.instagram.com/p/DTEJP3rEQr2/', 'Duration: 39s',
    'Stats: published 2026-01-03, 34999 plays, 1220 likes, 963 comments (Signal Room, measured 2026-08-16)',
    'Note from Mits: Show the build live, not a description of it.', '',
    SPOKEN, ''].join('\n'));
  assert.equal(text.split('\n').filter(l => /^Stats:/.test(l)).length, 1); // one Stats line
  // what the workflow reads: the duration its checker parses, and a spoken body with no header line in it
  assert.equal(/^\s*duration\b[^:]{0,20}:\s*([\d.]+)\s*s/im.exec(text)[1], '39');
  const py = spawnSync('python', ['-I', '-c', 'import sys,importlib.util as u\ns=u.spec_from_file_location("c",sys.argv[1]);m=u.module_from_spec(s);s.loader.exec_module(m)\nsys.stdout.buffer.write(m.spoken_source(open(sys.argv[2],encoding="utf-8").read()).encode("utf-8"))', join(import.meta.dirname, '..', '.claude', 'skills', 'reel-workflow', 'check_reel.py'), join(cfg.dropDir, name)], { encoding: 'utf8' });
  if (py.status === 0) assert.equal(py.stdout.trim(), SPOKEN); // the real checker drops the note and keeps the spoken "Note that…" line
  else console.log('  (python not available: checker read-back skipped)');
  // the dashboard lists it as a dropped transcript, by its heading
  const item = buildState(cfg).items.find(i => i.files.source === 'Instagram_transcript/' + name);
  assert.ok(item); assert.equal(item.id, 'src-research-instagram-' + IG); assert.match(item.title, /sample/i);
  // the association is recorded on the idea
  const ex = readIdeas(cfg)[0].exports;
  assert.deepEqual([ex.length, ex[0].file, ex[0].postId, ex[0].sourceUrl, ex[0].at], [1, 'Instagram_transcript/' + name, 'instagram-' + IG, 'https://www.instagram.com/p/DTEJP3rEQr2/', NOW.toISOString()]);
  // an idea with no angle writes no note line
  assert.ok(!/Note from Mits/.test(exportText(post(cfg, 'instagram-' + IG), { angle: '  ' })));
});

test('export is repeat-safe and never overwrites a file', () => {
  const cfg = store(); const id = 'idea-instagram-' + IG; const name = `research-instagram-${IG}.md`;
  ideaAction(cfg, { type: 'save-idea', postId: 'instagram-' + IG, angle: 'Angle one' }, NOW);
  // a different file is already there under that name: refused, untouched, nothing recorded
  mkdirSync(cfg.dropDir, { recursive: true }); writeFileSync(join(cfg.dropDir, name), 'my own notes');
  assert.throws(() => ideaAction(cfg, { type: 'export-idea', ideaId: id }, NOW), /A different file named .* is already in Instagram_transcript\. Nothing was overwritten/);
  assert.equal(readFileSync(join(cfg.dropDir, name), 'utf8'), 'my own notes'); assert.equal(readIdeas(cfg)[0].exports.length, 0);
  // the very same file, left by an interrupted export, is adopted rather than rewritten
  writeFileSync(join(cfg.dropDir, name), exportText(post(cfg, 'instagram-' + IG), readIdeas(cfg)[0]));
  assert.match(ideaAction(cfg, { type: 'export-idea', ideaId: id }, NOW).message, /^Exported to/);
  const first = readFileSync(join(cfg.dropDir, name), 'utf8'), record = readFileSync(ideasFile(cfg), 'utf8');
  // again, and again after the angle changed and after the workflow moved the file away: nothing is written
  assert.match(ideaAction(cfg, { type: 'export-idea', ideaId: id }, new Date('2026-11-18T12:00:00Z')).message, /Already exported on 2026-11-17\. Nothing was written/);
  assert.equal(readFileSync(join(cfg.dropDir, name), 'utf8'), first); assert.equal(readFileSync(ideasFile(cfg), 'utf8'), record);
  ideaAction(cfg, { type: 'set-angle', ideaId: id, angle: 'Angle two' }, NOW);
  assert.equal(ideaInfo(cfg, post(cfg, 'instagram-' + IG), readIdeas(cfg)[0]).exported.angleChanged, true);
  mkdirSync(join(cfg.inputsDir, 'batch-2026-11-17-001'), { recursive: true }); renameSync(join(cfg.dropDir, name), join(cfg.inputsDir, 'batch-2026-11-17-001', name));
  assert.match(ideaAction(cfg, { type: 'export-idea', ideaId: id }, NOW).message, /Already exported/);
  assert.deepEqual(drop(cfg), []); assert.equal(readIdeas(cfg)[0].exports.length, 1);
  // an exported idea keeps its record
  assert.throws(() => ideaAction(cfg, { type: 'remove-idea', ideaId: id }, NOW), /its record is kept/);
});

test('the Pipeline link appears only when a real item holds the exported file', () => {
  const cfg = store(); const id = 'idea-instagram-' + IG; const name = `research-instagram-${IG}.md`;
  ideaAction(cfg, { type: 'save-idea', postId: 'instagram-' + IG }, NOW);
  const info = () => ideaInfo(cfg, post(cfg, 'instagram-' + IG), readIdeas(cfg)[0], buildState(cfg).items);
  assert.equal(info().exported, null);
  ideaAction(cfg, { type: 'export-idea', ideaId: id }, NOW);
  let x = info().exported;
  assert.deepEqual([x.waiting, x.pipelineId, x.command, x.angleChanged], [true, 'src-research-instagram-' + IG, '/rewrite-reels', false]);
  // batched by the workflow, keeping its file name: the link follows it
  mkdirSync(join(cfg.inputsDir, 'batch-2026-11-17-001'), { recursive: true }); renameSync(join(cfg.dropDir, name), join(cfg.inputsDir, 'batch-2026-11-17-001', name));
  x = info().exported; assert.deepEqual([x.waiting, x.pipelineId], [false, '2026-11-17-001-01']);
  // the file gone altogether: no link is invented
  renameSync(join(cfg.inputsDir, 'batch-2026-11-17-001', name), join(cfg.root, 'elsewhere.md'));
  x = info().exported; assert.deepEqual([x.waiting, x.pipelineId], [false, null]);
});

test('an idea moves to do -> in production -> used on its own, and can be closed or reopened by hand', () => {
  const cfg = store(); const id = 'idea-instagram-' + IG;
  ideaAction(cfg, { type: 'save-idea', postId: 'instagram-' + IG }, NOW);
  const stage = (items = buildState(cfg).items) => ideaStage(readIdeas(cfg)[0], items);
  assert.equal(stage().key, 'todo');
  ideaAction(cfg, { type: 'export-idea', ideaId: id }, NOW);
  const s = stage(); assert.deepEqual([s.key, s.manual, s.reel.id], ['production', false, 'src-research-instagram-' + IG]);
  // its reel recorded on Instagram: used, with no action from Mits
  const posted = buildState(cfg).items.map(i => i.id === s.reel.id ? { ...i, platforms: { ...i.platforms, ig: { state: 'published', at: AT } } } : i);
  assert.deepEqual([stage(posted).key, stage(posted).at, stage(posted).manual], ['used', AT, false]);
  // closed by hand wins, is repeat-safe, and reopens to where the files say it is
  assert.equal(ideaAction(cfg, { type: 'close-idea', ideaId: id, as: 'dropped' }, NOW).message, 'Idea dropped. It stays under Dropped.');
  assert.equal(ideaAction(cfg, { type: 'close-idea', ideaId: id, as: 'dropped' }, NOW).message, 'No change.');
  assert.deepEqual([stage(posted).key, stage(posted).manual], ['dropped', true]);
  assert.throws(() => ideaAction(cfg, { type: 'close-idea', ideaId: id, as: 'deleted' }, NOW), /used or dropped/);
  assert.equal(ideaAction(cfg, { type: 'close-idea', ideaId: id, as: '' }, NOW).message, 'Idea reopened.');
  assert.equal(stage().key, 'production');
  assert.equal(readIdeas(cfg)[0].exports.length, 1); // closing never touches the export record
});

test('the brief labels every kind of text and keeps the angle apart, for long-form too', () => {
  const cfg = store(); const longId = 'youtube-' + Buffer.from(LONG).toString('hex');
  ideaAction(cfg, { type: 'save-idea', postId: longId, angle: 'Compare it with my own agent setup.' }, NOW);
  const b = ideaInfo(cfg, post(cfg, longId), readIdeas(cfg)[0]).brief;
  for (const part of ['RESEARCH BRIEF', 'Source: https://www.youtube.com/watch?v=' + LONG, 'Platform and format: YouTube, long-form', 'Duration: 12:34', 'Found by: Signal Room (YouTube long-form, search "n8n", 1 of 1 top matches)',
    'MY ANGLE (my own direction, not from the source)\nCompare it with my own agent setup.', 'CAPTION OR DESCRIPTION (written by the creator, not spoken)\nDescription text',
    'TRANSCRIPT EXCERPT (spoken words: the first 250 of 300; the full transcript is on the post\'s page)', 'measurement time unknown: 151632 views']) assert.ok(b.includes(part), part);
  assert.ok(b.includes('word249 …') && !b.includes('word250')); assert.ok(!/creator outlier/.test(b)); // the unstable signal is left out
  assert.ok(b.indexOf('MY ANGLE') < b.indexOf('MEASUREMENTS') && b.indexOf('MEASUREMENTS') < b.indexOf('CAPTION OR DESCRIPTION'));
  const s = briefText(post(cfg, 'instagram-' + IG), { angle: '' });
  for (const part of ['MY ANGLE (my own direction, not from the source)\nNot written yet.', 'SEARCH EXCERPT (opening lines, returned by Signal Room; word for word but only partly copied; not the full transcript)', 'FULL TRANSCRIPT (spoken words, 26 words)', 'creator outlier 0.15 (reach per follower)', 'Signal Room, measured 2026-08-16: 34999 plays']) assert.ok(s.includes(part), part);
  const t = briefText(post(cfg, 'tiktok-' + TT), { angle: 'x' });
  assert.ok(t.includes('TRANSCRIPT\nNo transcript was fetched for this post.') && t.includes('Platform and format: TikTok, short-form'));
  assert.equal(ideaInfo(cfg, post(cfg, 'tiktok-' + TT), undefined).brief, null); // a brief belongs to a saved idea
});

test('the action route: this PC only, same-site JSON only, and production actions are untouched', async () => {
  const cfg = store(); const srv = createServer(cfg); await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = 'http://localhost:' + srv.address().port;
  const send = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    let r = await send('/api/research/action', { type: 'save-idea', postId: 'tiktok-' + TT, angle: 'From the page' });
    assert.deepEqual([r.status, await r.json()], [200, { ok: true, message: 'Idea saved.', ideaId: 'idea-tiktok-' + TT }]);
    r = await send('/api/research/action', { type: 'export-idea', ideaId: 'idea-tiktok-' + TT }); assert.equal(r.status, 400); assert.match((await r.json()).error, /^Cannot export/);
    assert.equal((await send('/api/research/action', { type: 'save-idea', postId: 'tiktok-' + TT }, { origin: 'https://example.com' })).status, 403);
    assert.equal((await fetch(base + '/api/research/action', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
    const page = await (await fetch(base + '/api/research/post?id=tiktok-' + TT)).json();
    assert.equal(page.idea.angle, 'From the page'); assert.equal(page.handoff.ok, false); assert.equal(page.remote, false); assert.ok(page.brief.includes('From the page'));
    assert.deepEqual((await (await fetch(base + '/api/research?window=all')).json()).ideaPosts, ['tiktok-' + TT]);
    assert.equal((await (await fetch(base + '/api/research/ideas')).json()).ideas.length, 1);
    // a production action still goes to the production handler and is still validated there
    r = await send('/api/action', { id: 'none', type: 'hide', hidden: true }); assert.deepEqual([r.status, (await r.json()).error], [400, 'Unknown project']);
  } finally { srv.close(); }
  // a phone on the home network may read research but not save or export
  const ip = lanAddresses()[0];
  if (!ip) return console.log('  (no home-network address on this PC: phone refusal not checked)');
  const tok = 'k'.repeat(45); const lan = createServer({ ...cfg, lan: true, token: tok }); await new Promise(r => lan.listen(0, '0.0.0.0', r)); const lbase = `http://${ip}:${lan.address().port}`; const ck = { cookie: 'dash_k=' + tok };
  try {
    const r = await fetch(lbase + '/api/research/action', { method: 'POST', headers: { ...ck, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'save-idea', postId: 'instagram-' + IG }) });
    assert.deepEqual([r.status, (await r.json()).error], [403, 'Do this one on the PC. The phone can only record what you published.']);
    assert.equal((await (await fetch(lbase + '/api/research/post?id=tiktok-' + TT, { headers: ck })).json()).remote, true);
    assert.equal(readIdeas(cfg).length, 1);
  } finally { lan.close(); }
});
