// Research page, stage 3: what the read-only view shows from the store. Throwaway folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
const { loadConfig } = await import('../dashboard/lib/config.mjs');
const { importBatch } = await import('../dashboard/lib/research.mjs');
const { researchList, researchPost, researchSearches, researchCsv } = await import('../dashboard/lib/research-view.mjs');
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
const ids = rows => rows.map(r => r.nativeId);
// Every row the view returns for both main formats (and the undated list when the window allows it).
const every = (cfg, f = {}, now = NOW) => ['short', 'long'].flatMap(format => { const l = researchList(cfg, { window: 'all', ...f, format }, now); return [...l.rows, ...l.undatedRows]; });

test('the publication window is enforced locally: older posts are not listed, an unknown date is never recent', () => {
  const cfg = store();
  const d30 = researchList(cfg, {}, NOW); // defaults: short-form, last 30 days, sorted by average views per day
  assert.deepEqual([d30.filters.window, d30.filters.format, d30.filters.sort, d30.filters.limit], ['30', 'short', 'speed', 50]);
  assert.deepEqual(d30.formats, { short: 4, long: 3, unknown: 0 });
  assert.deepEqual(ids(d30.rows), ['7708502162103438612']);
  assert.deepEqual(d30.totals, { posts: 7, searches: 1, lastRetrievedAt: AT, shown: 4, recent: 1, historical: 2, undated: 1 });
  // a wider window brings dated posts in, but never the undated one; "any date" lists it separately
  assert.deepEqual(ids(researchList(cfg, { window: '365', platform: 'instagram' }, NOW).rows).sort(), [A, B].sort());
  assert.deepEqual(researchList(cfg, { window: '365', platform: 'instagram' }, NOW).undatedRows, []);
  const all = researchList(cfg, { window: 'all', platform: 'instagram' }, NOW);
  assert.equal(all.totals.historical, 0); assert.deepEqual(ids(all.undatedRows), [C]);
  // windows and ages count calendar days in Europe/London, not 24-hour blocks: on 17 Nov, 10 Nov is 7 days ago
  assert.equal(researchList(cfg, { window: '7', format: 'long' }, NOW).totals.recent, 3);
  assert.equal(researchList(cfg, { window: '7', format: 'long' }, new Date('2026-11-19T00:30:00Z')).totals.recent, 2); // 12 Nov is 7 days ago, 10 Nov is 9
  assert.equal(researchList(cfg, { window: '7', format: 'long' }, new Date('2026-11-20T00:30:00Z')).totals.recent, 1);
  // 14 Nov 22:20 is "2 days ago" on 16 Nov at any hour, and "yesterday" only on the 15th
  const age = at => researchList(cfg, { window: 'all', format: 'long' }, new Date(at)).rows.find(r => r.nativeId === 'ynEEbqKQSaY').publishedAgeDays;
  assert.deepEqual([age('2026-11-16T00:05:00Z'), age('2026-11-16T21:40:00Z'), age('2026-11-15T23:59:00Z'), age('2026-11-14T23:00:00Z')], [2, 2, 1, 0]);
  // the calendar is London's: 23:30 UTC on a summer date is already the next day there
  importBatch(cfg, batch('bst', '2026-07-02T09:00:00Z', 'bst', [tt('7708502162103438999', { publishedAt: '2026-06-30T23:30:00Z', observation: null })]));
  assert.equal(researchList(cfg, { search: 'bst', window: 'all' }, new Date('2026-07-01T23:30:00Z')).rows[0].publishedAgeDays, 1); // 1 Jul to 2 Jul in London
  assert.equal(researchList(cfg, { window: 'nonsense', format: 'nonsense', sort: 'nonsense' }, NOW).filters.window, '30');
});

test('filters search the saved text: platform, format, saved search, whole words and exact phrases', () => {
  const cfg = store();
  assert.deepEqual(researchList(cfg, { platform: 'tiktok', window: 'all' }, NOW).rows.map(r => r.platform), ['tiktok']);
  assert.ok(researchList(cfg, { format: 'long', window: 'all' }, NOW).rows.every(r => r.platform === 'youtube' && r.format === 'long'));
  const n8n = researchList(cfg, { search: 'N8N', window: 'all' }, NOW);
  assert.equal(n8n.formats.short + n8n.formats.long, 7);
  assert.equal(researchList(cfg, { search: 'something else', window: 'all' }, NOW).totals.shown, 0);
  const q = researchList(cfg, { q: '"better at n8n"', window: 'all' }, NOW);
  assert.deepEqual(q.rows.map(r => [r.nativeId, r.match.fields]), [[A, ['transcript', 'excerpt']]]);
  assert.equal(researchList(cfg, { q: 'n8', window: 'all' }, NOW).totals.shown, 0); // not a substring search
  // with only a saved search chosen, a post whose saved text lacks the word is still listed, and says so
  const row = researchList(cfg, { search: 'n8n', window: 'all', format: 'long' }, NOW).rows.find(r => r.nativeId === 'li2czuMTx6I');
  assert.deepEqual(row.match, { query: 'n8n', matched: false, fields: [] });
});

test('evidence, freshness and provenance are reported as they are', () => {
  const cfg = store(); const rows = every(cfg, { search: 'n8n' }); const row = id => rows.find(r => r.nativeId === id);
  assert.equal(row(A).evidence, 'transcript'); assert.equal(row(B).evidence, 'excerpt'); assert.equal(row(C).evidence, 'none'); assert.equal(row('7708502162103438612').evidence, 'caption');
  // measurement freshness is separate from publication and import dates
  assert.deepEqual([row(A).engagement.measuredAt, row(A).engagement.ageDays, row(A).engagement.stale], ['2026-08-16T16:54:05Z', 93, true]);
  assert.deepEqual([row(B).engagement.measuredAt, row(B).engagement.ageDays, row(B).engagement.stale], [null, null, null]); // unknown stays unknown
  assert.equal(row(C).engagement, null); assert.equal(row(C).metrics, null); assert.equal(row(C).publishedAgeDays, null);
  // a dated count is preferred over an undated one from the other source
  const both = row('ynEEbqKQSaY');
  assert.deepEqual([both.engagement.value, both.engagement.provider, both.engagement.stale], [162056, 'last30free', false]);
  assert.deepEqual([both.metrics.views, both.metrics.provider], [162056, 'last30free']);
  assert.deepEqual(both.providers.sort(), ['last30free', 'signal-room']);
  assert.deepEqual(both.runs.map(r => [r.lane, r.provider, r.rank, r.of, r.kept]), [['youtube_long_form', 'signal-room', 1, 3, false], ['youtube_discovery', 'last30free', 1, 1, false]]);
});

test('rankings: the unstable signal is never ranked, outlier and views are separate, growth needs dated pairs', () => {
  const cfg = store();
  const long = s => researchList(cfg, { sort: s, window: 'all', format: 'long' }, NOW).rows;
  assert.deepEqual(ids(long('outlier')), ['li2czuMTx6I', 'XoCg5QrOiLQ', 'ynEEbqKQSaY']); // 1.07, 0.19, then the unranked one, despite its 90.4
  assert.deepEqual(long('outlier')[2].outlier, { metric: 'bounded_velocity_signal', label: 'bounded velocity signal', value: 90.4, rankable: false, measuredAt: null });
  assert.deepEqual(ids(long('views')), ['ynEEbqKQSaY', 'li2czuMTx6I', 'XoCg5QrOiLQ']);
  assert.deepEqual(ids(long('published')), ['ynEEbqKQSaY', 'XoCg5QrOiLQ', 'li2czuMTx6I']);
  assert.ok(every(cfg).every(r => r.growth === null)); // nothing has two dated measurements yet
  // a second dated measurement from the same source gives growth; one from another source would not
  importBatch(cfg, batch('b2', '2026-11-18T09:00:00Z', 'n8n', [yt('ynEEbqKQSaY', 'last30free', { observation: { measuredAt: '2026-11-18T09:00:00Z', metrics: { views: 170056 }, discoveryScore: 12 } })]));
  const g = researchList(cfg, { window: 'all', format: 'long' }, new Date('2026-11-18T12:00:00Z')).rows.find(r => r.nativeId === 'ynEEbqKQSaY').growth;
  assert.deepEqual([g.provider, g.metric, g.delta, g.days], ['last30free', 'views', 8000, 1]);
});

test('a failed source run stays visible and removes nothing', () => {
  const cfg = store();
  importBatch(cfg, batch('b2', '2026-11-18T09:00:00Z', 'n8n', [ig(A)], [{ provider: 'last30free', lane: 'tiktok_hashtag', status: 'error', error: 'TikTok search failed: timeout', results: [] }]));
  const l = researchList(cfg, { window: 'all' }, new Date('2026-11-18T12:00:00Z'));
  assert.deepEqual(l.failures.map(f => [f.query, f.laneLabel, f.error]), [['n8n', 'TikTok hashtag', 'TikTok search failed: timeout']]);
  assert.equal(l.rows.filter(r => r.platform === 'tiktok').length, 1); // the earlier TikTok find is still there
  const s = researchSearches(cfg);
  assert.deepEqual(s.map(x => x.batchId), ['b2', 'b1']);
  assert.deepEqual(s[0].runs.find(r => r.lane === 'tiktok_hashtag'), { lane: 'tiktok_hashtag', laneLabel: 'TikTok hashtag', provider: 'last30free', status: 'error', error: 'TikTok search failed: timeout', note: null, results: 0, kept: 0, partial: null, counts: null, cost: null });
});

const TT2 = id => tt(id, { observation: { measuredAt: AT, measuredBasis: 'collection', metrics: { views: 1000, likes: 100, comments: 50, shares: 20 }, discoveryScore: 9.1, scoreFormula: 'l30-tiktok-v1' }, publishedAt: '2026-11-15T09:00:00Z' });

test('metrics come from one measurement: views, average views per day, rates, score and last checked', () => {
  const cfg = store();
  importBatch(cfg, batch('m1', AT, 'metrics', [TT2('7708502162103438100')]));
  const r = researchList(cfg, { search: 'metrics' }, NOW).rows[0];
  assert.deepEqual(r.metrics, { provider: 'last30free', viewMetric: 'views', views: 1000, likes: 100, comments: 50, shares: 20, saves: null,
    avgViewsPerDay: 500, engagementRate: 0.15, shareRate: 0.02, measuredAt: AT, measuredBasis: 'collection', retrievedAt: AT });
  assert.deepEqual(r.score, { value: 9.1, formula: 'l30-tiktok-v1', platform: 'tiktok', measuredAt: AT });
  // a newer measurement without shares: the row shows the newer one whole, shares unknown, never the older share count
  importBatch(cfg, batch('m2', '2026-11-17T10:00:00Z', 'metrics', [tt('7708502162103438100', { observation: { measuredAt: '2026-11-17T10:00:00Z', metrics: { views: 1200, likes: 110 }, discoveryScore: 9.3 }, publishedAt: '2026-11-15T09:00:00Z' })]));
  const r2 = researchList(cfg, { search: 'metrics' }, NOW).rows[0];
  assert.deepEqual([r2.metrics.views, r2.metrics.shares, r2.metrics.shareRate, r2.metrics.engagementRate, r2.score.value], [1200, null, null, null, 9.3]);
  // a post measured within its first day counts one day, so a few hours do not inflate the average
  importBatch(cfg, batch('m3', AT, 'young', [tt('7708502162103438200', { publishedAt: '2026-11-17T06:00:00Z', observation: { measuredAt: AT, metrics: { views: 600 } } })]));
  assert.equal(researchList(cfg, { search: 'young' }, NOW).rows[0].metrics.avgViewsPerDay, 600);
});

test('score sorts only within one platform; the list is the top 50 with more on request', () => {
  const cfg = store();
  const posts = Array.from({ length: 60 }, (_, i) => tt(String(7708502162103440000n + BigInt(i)), { observation: { measuredAt: AT, metrics: { views: 1000 + i } }, publishedAt: '2026-11-16T09:00:00Z' }));
  importBatch(cfg, batch('many', AT, 'many', posts));
  const mixed = researchList(cfg, { sort: 'score' }, NOW);
  assert.deepEqual([mixed.scoreNeedsPlatform, mixed.sortedBy], [true, 'speed']);
  const one = researchList(cfg, { sort: 'score', platform: 'tiktok' }, NOW);
  assert.deepEqual([one.scoreNeedsPlatform, one.sortedBy], [false, 'score']);
  const top = researchList(cfg, { search: 'many', sort: 'views' }, NOW);
  assert.deepEqual([top.rows.length, top.more, top.totals.recent, top.rows[0].metrics.views], [50, 10, 60, 1059]);
  const next = researchList(cfg, { search: 'many', sort: 'views', limit: '100' }, NOW);
  assert.deepEqual([next.rows.length, next.more], [60, 0]);
});

test('posts fetched but not reported belong to their search, and their original records are found', () => {
  const cfg = store(); const KEPT = '7708502162103438300', SHORT = 'If5q9eJ66EU', REEL = '3802204658396629799';
  const kept = tt(KEPT, { publishedAt: '2026-08-01T00:00:00Z' });
  const short = yt(SHORT, 'last30free', { url: `https://www.youtube.com/shorts/${SHORT}`, format: 'short', observation: { measuredAt: AT, metrics: { views: 5 } } });
  const reel = ig(REEL, { provider: 'last30free', observation: { measuredAt: AT, metrics: { views: 7 } } });
  importBatch(cfg, { schema: 1, batchId: 'k1', retrievedAt: AT, search: { query: 'kept', windowDays: 30 }, posts: [tt('7708502162103438612'), kept, short, reel], runs: [
    { provider: 'last30free', lane: 'tiktok_hashtag', status: 'ok', results: ['tiktok:7708502162103438612'], fetchedOnly: [`tiktok:${KEPT}`], counts: { fetched: 2 }, partial: 'TikTok Apify run R ended ABORTED; 2 results it had already produced were kept', cost: { run_id: 'R', status: 'ABORTED', charged_usd: 0.05 } },
    { provider: 'last30free', lane: 'youtube_shorts_feed', status: 'ok', results: [`youtube:${SHORT}`] },
    { provider: 'last30free', lane: 'instagram_search', status: 'ok', results: [`instagram:${REEL}`] }] });
  const inSearch = every(cfg, { search: 'kept' }).map(r => r.nativeId).sort();
  assert.deepEqual(inSearch, ['7708502162103438612', KEPT, REEL, SHORT].sort()); // the kept post is not lost under its own search
  const k = every(cfg, { search: 'kept' }).find(r => r.nativeId === KEPT);
  assert.deepEqual(k.runs.map(r => [r.batchId, r.kept, r.rank]), [['k1', true, null]]);
  assert.deepEqual(researchList(cfg, { search: 'kept' }, NOW).partials.map(p => p.laneLabel), ['TikTok hashtag']);
  const run = researchSearches(cfg)[0].runs[0];
  assert.deepEqual([run.kept, run.partial.startsWith('TikTok Apify'), run.cost.charged_usd], [1, true, 0.05]);
  // original records: the builder keeps instagram.json and youtubeShorts.json; "fetched" holds every returned record
  const dir = join(cfg.researchDir, 'sources', 'k1'); mkdirSync(dir, { recursive: true });
  const file = (source, id) => JSON.stringify({ results: {}, merged: { items: [] }, fetched: { items: [{ source, source_id: id, provider_record: { original: true } }] } });
  writeFileSync(join(dir, 'instagram.json'), file('instagram', REEL)); writeFileSync(join(dir, 'youtubeShorts.json'), file('youtube', SHORT)); writeFileSync(join(dir, 'tiktok.json'), file('tiktok', KEPT));
  for (const [id, name] of [[`instagram-${REEL}`, 'instagram.json'], [`youtube-${Buffer.from(SHORT).toString('hex')}`, 'youtubeShorts.json'], [`tiktok-${KEPT}`, 'tiktok.json']]) {
    const rec = researchPost(cfg, id, '', NOW).builderInputs.find(b => b.batchId === 'k1').records;
    assert.deepEqual(rec.map(x => [x.what, x.data.provider_record]), [[`Item, as written by last30free (${name})`, { original: true }]]);
  }
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

test('a measurement without a view count still shows its known counts and time', () => {
  const cfg = store();
  importBatch(cfg, batch('nv', AT, 'noviews', [tt('7708502162103438400', { observation: { measuredAt: AT, metrics: { likes: 100, comments: 10, shares: 5 } } })]));
  const m = researchList(cfg, { search: 'noviews' }, NOW).rows[0].metrics;
  assert.deepEqual([m.likes, m.comments, m.shares, m.measuredAt], [100, 10, 5, AT]);
  assert.deepEqual([m.views, m.viewMetric, m.avgViewsPerDay, m.engagementRate, m.shareRate], [null, null, null, null, null]);
});

test('the score carries its own date when it is older than the row\'s other numbers', () => {
  const cfg = store(); const ID = '7708502162103438500';
  importBatch(cfg, batch('s1', AT, 'scored', [tt(ID, { observation: { measuredAt: AT, metrics: { views: 10 }, discoveryScore: 4 } })]));
  importBatch(cfg, { schema: 1, batchId: 's2', retrievedAt: '2026-11-17T11:00:00Z', search: { query: 'scored' }, posts: [tt(ID, { observation: { measuredAt: '2026-11-17T11:00:00Z', metrics: { views: 20 } } })],
    runs: [{ provider: 'last30free', lane: 'tiktok_hashtag', status: 'ok', results: [`tiktok:${ID}`] }] });
  const r = researchList(cfg, { search: 'scored' }, NOW).rows[0];
  assert.deepEqual([r.metrics.views, r.metrics.measuredAt, r.score.value, r.score.measuredAt], [20, '2026-11-17T11:00:00Z', 4, AT]);
});

test('Show more stops honestly at the page limit', () => {
  const cfg = { ...store(), researchListMax: 100 };
  importBatch(cfg, batch('cap', AT, 'cap', Array.from({ length: 120 }, (_, i) => tt(String(7708502162103450000n + BigInt(i)), { observation: { measuredAt: AT, metrics: { views: i + 1 } }, publishedAt: '2026-11-16T09:00:00Z' }))));
  const first = researchList(cfg, { search: 'cap' }, NOW);
  assert.deepEqual([first.rows.length, first.more, first.capped], [50, 50, 20]);
  const last = researchList(cfg, { search: 'cap', limit: '5000' }, NOW);
  assert.deepEqual([last.filters.limit, last.rows.length, last.more, last.capped], [100, 100, 0, 20]); // no further "Show more"
  assert.equal(researchCsv(cfg, { search: 'cap' }, NOW).trim().split('\r\n').length, 121); // the export is not limited
});

test('the CSV export is the whole filtered table, Excel-safe', async () => {
  const cfg = store();
  importBatch(cfg, batch('csv', AT, 'csv', [tt('7708502162103438600', { title: '=HYPERLINK("x") "quoted", comma', observation: { measuredAt: AT, metrics: { views: 1000, likes: 100, comments: 50, shares: 20 }, discoveryScore: 9.1 }, publishedAt: '2026-11-15T09:00:00Z' })]));
  const csv = researchCsv(cfg, { search: 'csv' }, NOW); const lines = csv.slice(1).trim().split('\r\n');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(lines[0].startsWith('Platform,Format,Title,Creator,Link,Published (UTC),Views,Avg views/day'));
  assert.equal(lines.length, 2);
  assert.ok(lines[1].includes(`"'=HYPERLINK(""x"") ""quoted"", comma"`)); // a formula is never run; quotes and commas escaped
  assert.ok(lines[1].includes(',1000,500,100,50,20,,0.15,0.02,9.1,'));
  // the route serves it as a download and changes nothing
  const srv = createServer(cfg); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://localhost:${srv.address().port}/api/research/export.csv?search=csv&format=long%22%0d%0aX:1`);
    assert.equal(res.status, 200); assert.ok(res.headers.get('content-type').startsWith('text/csv'));
    assert.match(res.headers.get('content-disposition'), /^attachment; filename="research-short-\d{4}-\d{2}-\d{2}\.csv"$/); // a bad format never reaches the header
  } finally { srv.close(); }
});
