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
const { runSubtitles, createFetcher, FAILED } = await import('../dashboard/lib/transcripts.mjs');

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

test('the gap between fetches holds when the queue empties and a save arrives just after', async () => {
  const starts = [], ends = [];
  const runner = () => { starts.push(Date.now()); return new Promise(r => setTimeout(() => { ends.push(Date.now()); r({ ok: true, text: 'x' }); }, 20)); };
  const q = createFetcher({ subtitleRunner: runner, subtitleGapMs: 300 }, () => {});
  q.enqueue('idea-a', VID); await q.idle();
  q.enqueue('idea-b', HAS); // the queue was empty: this one must still wait out the gap
  assert.equal(starts.length, 1); await q.idle();
  assert.equal(starts.length, 2); assert.ok(starts[1] - ends[0] >= 290, `second start ${starts[1] - ends[0]} ms after the first ended`);
  // after the gap has passed, a new one starts at once
  await new Promise(r => setTimeout(r, 320)); const t = Date.now(); q.enqueue('idea-c', VID);
  assert.equal(starts.length, 3); assert.ok(starts[2] - t < 50);
  await q.idle();
  // a queued one dropped during the wait: the queue goes idle without running it
  q.enqueue('idea-d', VID); q.drop('idea-d'); await q.idle(); assert.equal(starts.length, 3);
  // a runner that throws at once is reported as a failure, and the queue carries on
  const seen = []; const q2 = createFetcher({ subtitleRunner: () => { throw new Error('boom'); }, subtitleGapMs: 0 }, (id, r) => seen.push([id, r]));
  q2.enqueue('idea-e', VID); await q2.idle(); assert.deepEqual(seen, [['idea-e', { ok: false, error: `${FAILED}: boom` }]]);
});

test('a 429 pauses the queue and retries the same video on a backoff, and only the last refusal is reported', async () => {
  const LIM = { ok: false, rateLimited: true, error: "Couldn't fetch subtitles: YouTube refused the request (too many requests)." };
  // refused twice, then fetched: one final result, and the second idea waited behind it
  let answers = [LIM, LIM, { ok: true, text: 'a' }, { ok: true, text: 'b' }]; const calls = [], seen = [];
  const q = createFetcher({ subtitleRunner: (c, id) => { calls.push([id, Date.now()]); return Promise.resolve(answers.shift()); }, subtitleGapMs: 0, subtitleBackoffMs: [120, 200, 300] }, (id, r) => seen.push([id, r.ok]));
  q.enqueue('idea-a', VID); q.enqueue('idea-b', HAS);
  await new Promise(r => setTimeout(r, 30));
  assert.ok(q.retryAt('idea-a') && q.pausedUntil(), 'a waiting video says when it is tried again'); assert.equal(q.retryAt('idea-b'), null);
  assert.equal(q.enqueue('idea-a', VID), false); // still busy while it waits: no second copy
  await q.idle();
  assert.deepEqual(calls.map(c => c[0]), [VID, VID, VID, HAS]); assert.deepEqual(seen, [['idea-a', true], ['idea-b', true]]);
  assert.ok(calls[1][1] - calls[0][1] >= 110 && calls[2][1] - calls[1][1] >= 190, 'each retry waits its backoff');
  // refused every time: reported once, after the last backoff, with a clear message
  answers = [LIM, LIM, LIM, LIM]; const final = [];
  const q2 = createFetcher({ subtitleRunner: () => Promise.resolve(answers.shift()), subtitleGapMs: 0, subtitleBackoffMs: [20, 20, 20] }, (id, r) => final.push(r));
  q2.enqueue('idea-c', VID); await q2.idle();
  assert.equal(final.length, 1); assert.match(final[0].error, /^Couldn't fetch subtitles: YouTube kept refusing \(too many requests\), 4 tries over about 0 minutes\. Try again later, or paste the transcript\.$/);
  // removed while it waits out the limit: never tried again, never reported
  answers = [LIM]; const none = [], tries = [];
  const q3 = createFetcher({ subtitleRunner: () => { tries.push(1); return Promise.resolve(answers.shift()); }, subtitleGapMs: 0, subtitleBackoffMs: [100] }, (id, r) => none.push(r));
  q3.enqueue('idea-d', VID); await new Promise(r => setTimeout(r, 20)); q3.drop('idea-d'); await q3.idle(); await new Promise(r => setTimeout(r, 150));
  assert.deepEqual([tries.length, none.length], [1, 0]);
});

test('a helper that cannot start reports why, instead of hiding it', async () => {
  const cfg = loadConfig({ root: mkdtempSync(join(tmpdir(), 'subs-')), last30freeDir: tmpdir(), subtitlesCommand: ['bad\0command'] }); // spawn throws synchronously
  const r = await runSubtitles(cfg, VID);
  assert.equal(r.ok, false); assert.match(r.error, /^Couldn't fetch subtitles: the subtitle helper did not start \(.*(null bytes|ERR_INVALID_ARG_VALUE|must be a string without null)/);
  assert.ok(!/before initialization/.test(r.error));
  const missing = loadConfig({ root: cfg.root, last30freeDir: tmpdir(), subtitlesCommand: [join(tmpdir(), 'no-such-python.exe')] }); // spawn fails asynchronously
  assert.match((await runSubtitles(missing, VID)).error, /^Couldn't fetch subtitles: the subtitle helper did not start \(.*ENOENT/);
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
  const lr = await runSubtitles(limited, VID); assert.equal(lr.rateLimited, true); assert.match(lr.error, /^Couldn't fetch subtitles: YouTube refused the request \(too many requests\)\.$/);
  // the current helper reports the 429 itself, under rateLimited
  const told = loadConfig({ root: cfg.root, last30freeDir: tmpdir(), subtitlesCommand: [process.execPath, '-e', 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ transcripts: {}, failed: {}, rateLimited: { [process.argv[2]]: "429" } }))'] });
  assert.equal((await runSubtitles(told, VID)).rateLimited, true);
  const nocap = loadConfig({ root: cfg.root, last30freeDir: tmpdir(), subtitlesCommand: [process.execPath, '-e', 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ transcripts: {}, failed: { [process.argv[2]]: "the video has no English subtitles or automatic captions" }, rateLimited: {} }))'] });
  const nc = await runSubtitles(nocap, VID); assert.equal(nc.rateLimited, undefined); assert.match(nc.error, /has no English subtitles or automatic captions/);
});
