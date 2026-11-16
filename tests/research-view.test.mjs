// Research page, stage 3: what the read-only view shows from the store. Throwaway folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
const { loadConfig } = await import('../dashboard/lib/config.mjs');
const { importBatch } = await import('../dashboard/lib/research.mjs');
const { researchList, researchPost, researchSearches } = await import('../dashboard/lib/research-view.mjs');
const { createServer } = await import('../dashboard/server.mjs');

const NOW = new Date('2026-11-17T12:00:00Z'), AT = '2026-11-17T09:00:00Z';
const ig = (id, extra = {}) => ({ platform: 'instagram', id, provider: 'signal-room', url: 'https://www.instagram.com/p/DcTC77TvZNt/', format: 'short', creator: { handle: 'sample.creator' }, title: 'Comment agent for the n8n guide', caption: 'Comment agent', publishedAt: '2026-01-03T22:09:09Z', durationSeconds: 39.1, transcript: null, observation: null, ...extra });
const yt = (id, provider, extra = {}) => ({ platform: 'youtube', id, provider, url: `https://www.youtube.com/watch?v=${id}`, format: 'long', creator: { name: 'A Channel' }, title: 'Is n8n dead?', publishedAt: '2026-11-14T22:20:30Z', durationSeconds: 754, transcript: null, observation: null, ...extra });
const tt = (id, extra = {}) => ({ platform: 'tiktok', id, provider: 'last30free', url: `https://www.tiktok.com/@someone/video/${id}`, format: 'short', title: 'my system #n8n', caption: 'my system #n8n', publishedAt: '2026-11-15T20:45:31Z', durationSeconds: 66, transcript: null, observation: { measuredAt: AT, metrics: { views: 3260 }, discoveryScore: 7.6 }, ...extra });
const LANE = p => p.platform === 'instagram' ? 'instagram_short_form' : p.platform === 'tiktok' ? 'tiktok_hashtag' : p.provider === 'last30free' ? 'youtube_discovery' : 'youtube_long_form';
function batch(id, at, query, posts, extraRuns = []) {
  const runs = {}; for (const p of posts) (runs[LANE(p)] ||= { provider: p.provider, lane: LANE(p), status: 'ok', note: 'top matches from this search', results: [] }).results.push(`${p.platform}:${p.id}`);
  return { schema: 1, batchId: id, retrievedAt: at, search: { query, windowDays: 30 }, runs: [...Object.values(runs), ...extraRuns], posts };
}
const A = '3802204658396629750', B = '3789920030163839258', C = '3803030861483167224';
function store() {
  const cfg = loadConfig({ root: mkdtempSync(join(tmpdir(), 'rview-')) });
  importBatch(cfg, batch('b1', AT, 'n8n', [
    // old Instagram posts: outside any 30-day window
    ig(A, { transcript: { text: 'Claude Code is better at N8N than N8N is itself.', origin: 'signal-room', capturedAt: '2026-08-16T16:54:05Z' }, excerpts: [{ kind: 'hook', text: 'So Cloud Code is actually better at N8N than N8N is itself.' }], observation: { measuredAt: '2026-08-16T16:54:05Z', metrics: { plays: 34999 }, outlier: { metric: 'reach_per_follower', value: 0.15 } } }),
    ig(B, { url: 'https://www.instagram.com/p/DSYgDAFDaka/', title: 'Comment agent to get my guides', caption: null, excerpts: [{ kind: 'snippet', text: 'If you are someone who uses N8N.' }], observation: { measuredAt: null, metrics: { plays: 23225 }, outlier: { metric: 'reach_per_follower', value: 0.42 } } }),
    // no publication date at all
    ig(C, { url: 'https://www.instagram.com/p/DTHFGtQjU34/', title: 'Undated post about n8n', caption: null, publishedAt: null }),
    // one recent video, found by both sources; Signal Room gives only the unstable signal
    yt('ynEEbqKQSaY', 'signal-room', { observation: { measuredAt: null, metrics: { views: 151632 }, outlier: { metric: 'bounded_velocity_signal', value: 90.4 } } }),
    yt('ynEEbqKQSaY', 'last30free', { format: 'long', observation: { measuredAt: AT, metrics: { views: 162056 }, discoveryScore: 13 } }),
    yt('li2czuMTx6I', 'signal-room', { title: 'Automate anything', publishedAt: '2026-11-10T10:00:00Z', observation: { measuredAt: null, metrics: { views: 14853 }, outlier: { metric: 'age_adjusted_channel_outlier', value: 1.07 } } }),
    yt('XoCg5QrOiLQ', 'signal-room', { title: 'Local model tutorial', publishedAt: '2026-11-12T10:00:00Z', observation: { measuredAt: null, metrics: { views: 10876 }, outlier: { metric: 'age_adjusted_channel_outlier', value: 0.19 } } }),
    tt('7708502162103438612'),
  ]));
  return cfg;
}
const group = (l, label) => l.groups.find(g => g.label === label);
const ids = rows => rows.map(r => r.nativeId);

test('the publication window is enforced locally: older posts are historical, an unknown date is never recent', () => {
  const cfg = store();
  const d30 = researchList(cfg, {}, NOW); // default window is 30 days
  assert.equal(d30.filters.window, '30');
  const insta = group(d30, 'Instagram');
  assert.deepEqual(insta.recent, []); assert.deepEqual(ids(insta.historical).sort(), [A, B].sort()); assert.deepEqual(ids(insta.undated), [C]);
  assert.deepEqual(d30.totals, { posts: 7, searches: 1, lastRetrievedAt: AT, shown: 7, recent: 4, historical: 2, undated: 1 });
  // a wider window brings dated posts in, but never the undated one
  const year = researchList(cfg, { window: '365' }, NOW);
  assert.deepEqual(ids(group(year, 'Instagram').recent).sort(), [A, B].sort()); assert.deepEqual(ids(group(year, 'Instagram').undated), [C]);
  const all = researchList(cfg, { window: 'all' }, NOW);
  assert.equal(all.totals.historical, 0); assert.deepEqual(ids(group(all, 'Instagram').undated), [C]);
  // windows and ages count calendar days in Europe/London, not 24-hour blocks: on 17 Nov, 10 Nov is 7 days ago
  assert.equal(researchList(cfg, { window: '7' }, NOW).totals.recent, 4);
  assert.equal(researchList(cfg, { window: '7' }, new Date('2026-11-19T00:30:00Z')).totals.recent, 3); // 12 Nov is 7 days ago, 10 Nov is 9
  assert.equal(researchList(cfg, { window: '7' }, new Date('2026-11-20T00:30:00Z')).totals.recent, 2);
  // 14 Nov 22:20 is "2 days ago" on 16 Nov at any hour, and "yesterday" only on the 15th
  const age = at => group(researchList(cfg, { window: 'all' }, new Date(at)), 'YouTube long-form').recent.find(r => r.nativeId === 'ynEEbqKQSaY').publishedAgeDays;
  assert.deepEqual([age('2026-11-16T00:05:00Z'), age('2026-11-16T21:40:00Z'), age('2026-11-15T23:59:00Z'), age('2026-11-14T23:00:00Z')], [2, 2, 1, 0]);
  // the calendar is London's: 23:30 UTC on a summer date is already the next day there
  importBatch(cfg, batch('bst', '2026-07-02T09:00:00Z', 'bst', [tt('7708502162103438999', { publishedAt: '2026-06-30T23:30:00Z', observation: null })]));
  assert.equal(group(researchList(cfg, { search: 'bst', window: 'all' }, new Date('2026-07-01T23:30:00Z')), 'TikTok').recent[0].publishedAgeDays, 1); // 1 Jul to 2 Jul in London
  assert.equal(researchList(cfg, { window: 'nonsense' }, NOW).filters.window, '30');
});

test('filters search the saved text: platform, format, saved search, whole words and exact phrases', () => {
  const cfg = store();
  assert.deepEqual(researchList(cfg, { platform: 'tiktok', window: 'all' }, NOW).groups.map(g => g.label), ['TikTok']);
  assert.deepEqual(researchList(cfg, { format: 'long', window: 'all' }, NOW).groups.map(g => g.label), ['YouTube long-form']);
  assert.equal(researchList(cfg, { search: 'N8N', window: 'all' }, NOW).totals.shown, 7);
  assert.equal(researchList(cfg, { search: 'something else', window: 'all' }, NOW).totals.shown, 0);
  const q = researchList(cfg, { q: '"better at n8n"', window: 'all' }, NOW);
  assert.deepEqual(q.groups.flatMap(g => [...g.recent, ...g.historical, ...g.undated]).map(r => [r.nativeId, r.match.fields]), [[A, ['transcript', 'excerpt']]]);
  assert.equal(researchList(cfg, { q: 'n8', window: 'all' }, NOW).totals.shown, 0); // not a substring search
  // with only a saved search chosen, a post whose saved text lacks the word is still listed, and says so
  const row = group(researchList(cfg, { search: 'n8n', window: 'all' }, NOW), 'YouTube long-form').recent.find(r => r.nativeId === 'li2czuMTx6I');
  assert.deepEqual(row.match, { query: 'n8n', matched: false, fields: [] });
});

test('evidence, freshness and provenance are reported as they are', () => {
  const cfg = store(); const l = researchList(cfg, { search: 'n8n', window: 'all' }, NOW);
  const row = id => l.groups.flatMap(g => [...g.recent, ...g.historical, ...g.undated]).find(r => r.nativeId === id);
  assert.equal(row(A).evidence, 'transcript'); assert.equal(row(B).evidence, 'excerpt'); assert.equal(row(C).evidence, 'none'); assert.equal(row('7708502162103438612').evidence, 'caption');
  // measurement freshness is separate from publication and import dates
  assert.deepEqual([row(A).engagement.measuredAt, row(A).engagement.ageDays, row(A).engagement.stale], ['2026-08-16T16:54:05Z', 93, true]);
  assert.deepEqual([row(B).engagement.measuredAt, row(B).engagement.ageDays, row(B).engagement.stale], [null, null, null]); // unknown stays unknown
  assert.equal(row(C).engagement, null); assert.equal(row(C).publishedAgeDays, null);
  // a dated count is preferred over an undated one from the other source
  const both = row('ynEEbqKQSaY');
  assert.deepEqual([both.engagement.value, both.engagement.provider, both.engagement.stale], [162056, 'last30free', false]);
  assert.deepEqual(both.providers.sort(), ['last30free', 'signal-room']);
  assert.deepEqual(both.runs.map(r => [r.lane, r.provider, r.rank, r.of]), [['youtube_long_form', 'signal-room', 1, 3], ['youtube_discovery', 'last30free', 1, 1]]);
});

test('rankings: the unstable signal is never ranked, outlier and raw engagement are separate, growth needs dated pairs', () => {
  const cfg = store();
  const long = s => group(researchList(cfg, { sort: s, window: 'all' }, NOW), 'YouTube long-form').recent;
  assert.deepEqual(ids(long('outlier')), ['li2czuMTx6I', 'XoCg5QrOiLQ', 'ynEEbqKQSaY']); // 1.07, 0.19, then the unranked one, despite its 90.4
  assert.deepEqual(long('outlier')[2].outlier, { metric: 'bounded_velocity_signal', label: 'bounded velocity signal', value: 90.4, rankable: false, measuredAt: null });
  assert.deepEqual(ids(long('engagement')), ['ynEEbqKQSaY', 'li2czuMTx6I', 'XoCg5QrOiLQ']);
  assert.deepEqual(ids(long('published')), ['ynEEbqKQSaY', 'XoCg5QrOiLQ', 'li2czuMTx6I']);
  assert.ok(researchList(cfg, { window: 'all' }, NOW).groups.every(g => [...g.recent, ...g.undated].every(r => r.growth === null))); // nothing has two dated measurements yet
  // a second dated measurement from the same source gives growth; one from another source would not
  importBatch(cfg, batch('b2', '2026-11-18T09:00:00Z', 'n8n', [yt('ynEEbqKQSaY', 'last30free', { observation: { measuredAt: '2026-11-18T09:00:00Z', metrics: { views: 170056 }, discoveryScore: 12 } })]));
  const g = group(researchList(cfg, { window: 'all' }, new Date('2026-11-18T12:00:00Z')), 'YouTube long-form').recent.find(r => r.nativeId === 'ynEEbqKQSaY').growth;
  assert.deepEqual([g.provider, g.metric, g.delta, g.days], ['last30free', 'views', 8000, 1]);
});

test('a failed source run stays visible and removes nothing', () => {
  const cfg = store();
  importBatch(cfg, batch('b2', '2026-11-18T09:00:00Z', 'n8n', [ig(A)], [{ provider: 'last30free', lane: 'tiktok_hashtag', status: 'error', error: 'TikTok search failed: timeout', results: [] }]));
  const l = researchList(cfg, { window: 'all' }, new Date('2026-11-18T12:00:00Z'));
  assert.deepEqual(l.failures.map(f => [f.query, f.laneLabel, f.error]), [['n8n', 'TikTok hashtag', 'TikTok search failed: timeout']]);
  assert.equal(group(l, 'TikTok').recent.length, 1); // the earlier TikTok find is still there
  const s = researchSearches(cfg);
  assert.deepEqual(s.map(x => x.batchId), ['b2', 'b1']);
  assert.deepEqual(s[0].runs.find(r => r.lane === 'tiktok_hashtag'), { lane: 'tiktok_hashtag', laneLabel: 'TikTok hashtag', provider: 'last30free', status: 'error', error: 'TikTok search failed: timeout', note: null, results: 0 });
});

test('a post detail keeps exact excerpts, says what is missing, and finds the original records', () => {
  const cfg = store();
  mkdirSync(join(cfg.researchDir, 'sources', 'b1'), { recursive: true });
  writeFileSync(join(cfg.researchDir, 'sources', 'b1', 'draft.json'), JSON.stringify({ signalRoom: { matches: [{ externalId: A, metrics: { plays: 34999 } }], instagramDetails: [{ externalId: A, observations: [{ observedAt: 1786899245756, playsCount: 34999 }] }] } }));
  const a = researchPost(cfg, 'instagram-' + A, 'n8n', NOW);
  assert.deepEqual(a.match.fields, { transcript: ['n8n'], excerpt: ['n8n'], title: ['n8n'] });
  assert.deepEqual(a.excerpts.map(x => [x.kind, x.provider, x.batchId, x.text]), [['hook', 'signal-room', 'b1', 'So Cloud Code is actually better at N8N than N8N is itself.']]);
  assert.equal(a.excerpts[0].segments.map(x => x.t).join(''), a.excerpts[0].text); // highlighting never rewrites the text
  assert.deepEqual(a.excerpts[0].segments.filter(x => x.m).map(x => x.t), ['N8N', 'N8N']);
  assert.equal(a.transcriptText, 'Claude Code is better at N8N than N8N is itself.'); assert.ok(a.transcriptPassage.segments.some(x => x.m));
  assert.deepEqual(a.builderInputs[0].records.map(r => r.what), ['Search match, as copied from Signal Room', 'Item detail, as copied from Signal Room']);
  assert.equal(a.builderInputs[0].records[0].data.metrics.plays, a.observations[0].metrics.plays); // the copied number can be checked
  const c = researchPost(cfg, 'instagram-' + C, 'n8n', NOW);
  assert.equal(c.transcriptText, null); assert.equal(c.transcript, null); assert.equal(c.caption, null); assert.deepEqual(c.excerpts, []); assert.deepEqual(c.observations, []); assert.equal(c.publishedAt, null);
  assert.equal(c.growth, null);
  const t = researchPost(cfg, 'tiktok-7708502162103438612', '', NOW);
  assert.equal(t.query, 'n8n'); assert.deepEqual(Object.keys(t.match.fields).sort(), ['caption', 'title']); assert.equal(t.transcriptText, null);
  assert.equal(t.builderInputs[0].kept, true); assert.deepEqual(t.builderInputs[0].records, []); // folder kept, this post's record not in it
  assert.equal(researchPost(cfg, '../../etc/passwd', '', NOW), null);
});

test('the page routes only read: the store is byte-identical after every request', async () => {
  const cfg = store(); const snap = () => { const out = {}; const walk = d => { for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) walk(f); else out[relative(cfg.researchDir, f)] = createHash('sha256').update(readFileSync(f)).digest('hex'); } }; walk(cfg.researchDir); return out; };
  const before = snap(); const srv = createServer(cfg); await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = 'http://localhost:' + srv.address().port;
  try {
    const list = await (await fetch(base + '/api/research?window=all&q=n8n')).json(); assert.equal(list.totals.posts, 7);
    assert.equal((await (await fetch(base + '/api/research/searches')).json()).searches.length, 1);
    assert.equal((await (await fetch(base + '/api/research/post?id=instagram-' + A + '&q=n8n')).json()).nativeId, A);
    assert.equal((await fetch(base + '/api/research/post?id=nope')).status, 404);
    for (const [p, type] of [['/research.js', 'text/javascript'], ['/research.css', 'text/css']]) { const r = await fetch(base + p); assert.equal(r.status, 200); assert.ok(r.headers.get('content-type').startsWith(type)); }
    assert.equal((await fetch(base + '/research.mjs')).status, 404);
    assert.equal((await fetch(base + '/api/research', { method: 'POST' })).status, 404);
  } finally { srv.close(); }
  assert.deepEqual(snap(), before);
});
