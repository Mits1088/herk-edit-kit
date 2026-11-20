// YouTube transcripts fetched when an idea is saved (dashboard/lib/transcripts.mjs, lib/ideas.mjs). Throwaway
// folders and a fake subtitle runner only: no test here reaches YouTube.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { loadConfig } = await import('../dashboard/lib/config.mjs');
const { importBatch } = await import('../dashboard/lib/research.mjs');
const { researchPost } = await import('../dashboard/lib/research-view.mjs');
const { readIdeas, ideaAction, ideasView, ideaInfo, withManualTranscript, fetchesIdle, ideasBackup } = await import('../dashboard/lib/ideas.mjs');
const { runSubtitles, FAILED } = await import('../dashboard/lib/transcripts.mjs');

const NOW = new Date('2026-11-20T12:00:00Z'), AT = '2026-11-20T09:00:00Z';
const VID = 'AbC-_12xYz9', HAS = 'EuUF53Wwfm0', TT = '7708502162103438612';
const key = id => 'youtube-' + Buffer.from(id).toString('hex');
const SUBS = 'These are the spoken words of the whole video, from start to end.';

// A runner that records each call and resolves when the test says so.
function fakeRunner() {
  const calls = [], pending = [];
  const runner = (cfg, videoId) => { calls.push(videoId); return new Promise(resolve => pending.push(resolve)); };
  return { runner, calls, resolveNext: r => pending.shift()(r), waiting: () => pending.length };
}
function store(extra = {}) {
  const cfg = loadConfig({ root: mkdtempSync(join(tmpdir(), 'subs-')), subtitleGapMs: 0, ...extra });
  importBatch(cfg, { schema: 1, batchId: 'b1', retrievedAt: AT, search: { query: 'claude', windowDays: 30 }, runs: [
    { provider: 'last30free', lane: 'youtube_discovery', status: 'ok', results: ['youtube:' + VID, 'youtube:' + HAS] },
    { provider: 'last30free', lane: 'tiktok_hashtag', status: 'ok', results: ['tiktok:' + TT] }],
  posts: [
    { platform: 'youtube', id: VID, provider: 'last30free', url: 'https://www.youtube.com/watch?v=' + VID, format: 'long', title: 'No transcript yet', publishedAt: '2026-11-16T12:59:18Z', durationSeconds: 900, transcript: null, observation: null },
    { platform: 'youtube', id: HAS, provider: 'last30free', url: 'https://www.youtube.com/watch?v=' + HAS, format: 'short', title: 'Has subtitles', publishedAt: '2026-11-16T12:59:18Z', durationSeconds: 45, transcript: { text: 'Stored words.', origin: 'subtitles', capturedAt: AT }, observation: null },
    { platform: 'tiktok', id: TT, provider: 'last30free', url: `https://www.tiktok.com/@someone/video/${TT}`, format: 'short', title: 'tiktok', publishedAt: '2026-11-15T20:45:31Z', durationSeconds: 66, transcript: null, observation: null }] });
  return cfg;
}
const idea = cfg => readIdeas(cfg).find(i => i.postId === key(VID));

test('saving a YouTube idea fetches with the original video id, exactly once, however often fetch is pressed', async () => {
  const f = fakeRunner(); const cfg = store({ subtitleRunner: f.runner });
  assert.equal(ideaAction(cfg, { type: 'save-idea', postId: key(VID), angle: 'Mine' }, NOW).message, 'Idea saved. Fetching its YouTube transcript now.');
  assert.equal(idea(cfg).fetched.status, 'pending');
  // pressed again while it runs: nothing is queued twice
  assert.match(ideaAction(cfg, { type: 'fetch-missing' }, NOW).message, /No saved YouTube idea is missing a transcript/);
  assert.equal(ideaAction(cfg, { type: 'fetch-transcript', ideaId: idea(cfg).id }, NOW).message, 'Already fetching this transcript.');
  assert.match(ideaAction(cfg, { type: 'save-idea', postId: key(VID) }, NOW).message, /Already saved/);
  assert.deepEqual(f.calls, [VID]); // the id as YouTube spells it, not the hex post key
  const v = ideasView(cfg, [], NOW)[0]; assert.equal(v.fetch.state, 'fetching');
  f.resolveNext({ ok: true, text: SUBS }); await fetchesIdle(cfg);
  assert.deepEqual(f.calls, [VID]);
  const i = idea(cfg); assert.deepEqual([i.fetched.status, i.fetched.text, i.angle], ['ok', SUBS, 'Mine']);
  // the page reads it as the full transcript, labelled as fetched subtitles, and the brief says so
  const d = withManualTranscript(researchPost(cfg, key(VID), '', NOW), i);
  assert.deepEqual([d.transcriptText, d.evidence, d.fetchedOnSave, d.transcript.origin, d.manualTranscript], [SUBS, 'transcript', true, 'subtitles', undefined]);
  const info = ideaInfo(cfg, d, i); assert.equal(info.fetch.state, 'ok'); assert.equal(info.fetch.words, 13);
  assert.equal(info.idea.fetched.text, undefined); // not sent twice to the page
  assert.ok(info.brief.includes('FULL TRANSCRIPT (spoken words, YouTube subtitles fetched when the idea was saved, 13 words)'));
  // with subtitles in hand, a paste is refused and fetching again does nothing
  assert.throws(() => ideaAction(cfg, { type: 'set-transcript', postId: key(VID), text: 'pasted' }, NOW), /already has its YouTube subtitles/);
  assert.match(ideaAction(cfg, { type: 'fetch-transcript', ideaId: i.id }, NOW).message, /already has a transcript/);
  assert.deepEqual(f.calls, [VID]);
});

test('an angle edited while the fetch runs survives, and the fetch writes only its own field', async () => {
  const f = fakeRunner(); const cfg = store({ subtitleRunner: f.runner });
  ideaAction(cfg, { type: 'save-idea', postId: key(VID), angle: 'First' }, NOW);
  ideaAction(cfg, { type: 'save-idea', postId: 'tiktok-' + TT, angle: 'Other idea' }, NOW);
  ideaAction(cfg, { type: 'set-angle', ideaId: idea(cfg).id, angle: 'Changed while fetching' }, NOW);
  const before = readIdeas(cfg);
  f.resolveNext({ ok: true, text: SUBS }); await fetchesIdle(cfg);
  const after = readIdeas(cfg);
  assert.equal(after.find(i => i.postId === key(VID)).angle, 'Changed while fetching');
  assert.deepEqual(after.find(i => i.postId === 'tiktok-' + TT), before.find(i => i.postId === 'tiktok-' + TT));
  const strip = i => { const { fetched, ...rest } = i; return rest; };
  assert.deepEqual(after.map(strip), before.map(strip)); // nothing but `fetched` changed
});

test('removing an idea while its fetch runs keeps it removed', async () => {
  const f = fakeRunner(); const cfg = store({ subtitleRunner: f.runner });
  ideaAction(cfg, { type: 'save-idea', postId: key(VID) }, NOW);
  ideaAction(cfg, { type: 'remove-idea', ideaId: idea(cfg).id }, NOW);
  f.resolveNext({ ok: true, text: SUBS }); await fetchesIdle(cfg);
  assert.deepEqual(readIdeas(cfg), []);
});

test('a failure reads "Couldn\'t fetch subtitles" with Retry, and Retry fetches again', async () => {
  const f = fakeRunner(); const cfg = store({ subtitleRunner: f.runner });
  ideaAction(cfg, { type: 'save-idea', postId: key(VID) }, NOW);
  f.resolveNext({ ok: false, error: `${FAILED}. The video may have no captions, or YouTube refused the request.` }); await fetchesIdle(cfg);
  let v = ideasView(cfg, [], NOW)[0];
  assert.deepEqual([v.fetch.state, v.fetch.canFetch], ['failed', true]); assert.match(v.fetch.error, /^Couldn't fetch subtitles/);
  assert.ok(!/no subtitles/i.test(v.fetch.error));
  assert.equal(ideaAction(cfg, { type: 'fetch-transcript', ideaId: idea(cfg).id }, NOW).message, 'Fetching the YouTube transcript now.');
  f.resolveNext({ ok: true, text: SUBS }); await fetchesIdle(cfg);
  assert.deepEqual(f.calls, [VID, VID]); assert.equal(idea(cfg).fetched.status, 'ok');
  // a pasted transcript is still possible after a failure, and then no fetch status is shown
  const g = fakeRunner(); const c2 = store({ subtitleRunner: g.runner });
  ideaAction(c2, { type: 'save-idea', postId: key(VID) }, NOW); g.resolveNext({ ok: false, error: FAILED }); await fetchesIdle(c2);
  assert.equal(ideaAction(c2, { type: 'set-transcript', postId: key(VID), text: 'pasted words' }, NOW).message, 'Transcript saved.');
  assert.equal(ideasView(c2, [], NOW)[0].fetch, null);
  assert.match(ideaAction(c2, { type: 'fetch-transcript', ideaId: idea(c2).id }, NOW).message, /already has a transcript/);
});

test('a fetch interrupted by a restart reads as failed and can be retried; ideas saved earlier are fetched by Fetch missing', async () => {
  const f = fakeRunner(); const cfg = store({ subtitleRunner: f.runner });
  mkdirSync(cfg.researchDir, { recursive: true });
  // an idea saved before this change (no fetched field) and one left pending by a server that stopped
  writeFileSync(join(cfg.researchDir, 'ideas.json'), JSON.stringify({ ideas: [
    { id: 'idea-' + key(VID), postId: key(VID), angle: '', createdAt: AT, updatedAt: AT, exports: [], fetched: { status: 'pending', requestedAt: AT } }] }));
  const v = ideasView(cfg, [], NOW)[0]; assert.deepEqual([v.fetch.state, v.fetch.canFetch], ['failed', true]); assert.match(v.fetch.error, /restarted/);
  assert.equal(ideaAction(cfg, { type: 'fetch-missing' }, NOW).message, 'Fetching 1 YouTube transcript, one at a time.');
  assert.deepEqual(f.calls, [VID]);
  f.resolveNext({ ok: true, text: SUBS }); await fetchesIdle(cfg); assert.equal(idea(cfg).fetched.status, 'ok');
});

test('Instagram, TikTok and YouTube posts that already have a transcript are never fetched', async () => {
  const f = fakeRunner(); const cfg = store({ subtitleRunner: f.runner });
  assert.equal(ideaAction(cfg, { type: 'save-idea', postId: 'tiktok-' + TT }, NOW).message, 'Idea saved.');
  assert.equal(ideaAction(cfg, { type: 'save-idea', postId: key(HAS) }, NOW).message, 'Idea saved.');
  assert.match(ideaAction(cfg, { type: 'fetch-missing' }, NOW).message, /No saved YouTube idea/);
  assert.match(ideaAction(cfg, { type: 'fetch-transcript', ideaId: 'idea-tiktok-' + TT }, NOW).message, /YouTube ideas only/);
  await fetchesIdle(cfg); assert.deepEqual(f.calls, []);
  assert.ok(readIdeas(cfg).every(i => !('fetched' in i)));
  assert.deepEqual(ideasView(cfg, [], NOW).map(x => x.fetch), [null, null]);
});

test('every write keeps the rest of ideas.json, and the file as it was is backed up once', async () => {
  const f = fakeRunner(); const cfg = store({ subtitleRunner: f.runner });
  mkdirSync(cfg.researchDir, { recursive: true });
  const original = JSON.stringify({ ideas: [], groups: [{ id: 'g1', ideaIds: [], draft: 'my script' }], other: 1 }, null, 2);
  writeFileSync(join(cfg.researchDir, 'ideas.json'), original);
  ideaAction(cfg, { type: 'save-idea', postId: key(VID) }, NOW);
  f.resolveNext({ ok: true, text: SUBS }); await fetchesIdle(cfg);
  ideaAction(cfg, { type: 'set-angle', ideaId: idea(cfg).id, angle: 'later' }, NOW);
  const j = JSON.parse(readFileSync(join(cfg.researchDir, 'ideas.json'), 'utf8'));
  assert.deepEqual([j.groups, j.other, j.ideas.length], [[{ id: 'g1', ideaIds: [], draft: 'my script' }], 1, 1]);
  assert.equal(readFileSync(ideasBackup(cfg), 'utf8'), original); // the first write's copy, not overwritten later
  // a brand-new store has nothing to back up
  const c2 = store({ subtitleRunner: fakeRunner().runner }); ideaAction(c2, { type: 'save-idea', postId: 'tiktok-' + TT }, NOW);
  assert.equal(existsSync(ideasBackup(c2)), false);
});

test('the real runner stops a stalled helper at its timeout and refuses a bad id without starting it', async () => {
  const cfg = loadConfig({ root: mkdtempSync(join(tmpdir(), 'subs-')), subtitlesCommand: [process.execPath, '-e', 'setTimeout(() => {}, 60000)'], subtitleTimeoutMs: 500, last30freeDir: tmpdir() });
  const t0 = Date.now(); const r = await runSubtitles(cfg, VID);
  assert.equal(r.ok, false); assert.match(r.error, /^Couldn't fetch subtitles: it took longer than 1 seconds/); assert.ok(Date.now() - t0 < 10000);
  const bad = await runSubtitles(cfg, '../../etc'); assert.equal(bad.ok, false); assert.match(bad.error, /not a YouTube video id/);
  // a helper that writes its usual output: the transcript for the id it was given
  const ok = loadConfig({ root: cfg.root, last30freeDir: tmpdir(), subtitlesCommand: [process.execPath, '-e', 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ transcripts: { [process.argv[2]]: " words " }, failed: {} }))'] });
  assert.deepEqual(await runSubtitles(ok, VID), { ok: true, text: 'words' });
  const none = loadConfig({ root: cfg.root, last30freeDir: tmpdir(), subtitlesCommand: [process.execPath, '-e', 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ transcripts: {}, failed: { [process.argv[2]]: "x" } }))'] });
  assert.match((await runSubtitles(none, VID)).error, /^Couldn't fetch subtitles\. The video may have no captions, or YouTube refused the request\.$/);
  // the same result, but the log names YouTube's rate limit: say so
  const limited = loadConfig({ root: cfg.root, last30freeDir: tmpdir(), subtitlesCommand: [process.execPath, '-e', 'console.error("ERROR: Unable to download video subtitles for \'en\': HTTP Error 429: Too Many Requests"); require("fs").writeFileSync(process.argv[1], JSON.stringify({ transcripts: {}, failed: { [process.argv[2]]: "x" } }))'] });
  assert.match((await runSubtitles(limited, VID)).error, /^Couldn't fetch subtitles: YouTube refused the request \(too many requests\)\. Wait a few minutes, then Retry\.$/);
});
