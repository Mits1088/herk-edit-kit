// Research store, stage 1: batch validation, the importer and its history rules, growth, keyword matching.
// Runs against a throwaway folder; never touches reels-data/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const { loadConfig } = await import('../dashboard/lib/config.mjs');
const { importBatch, validateBatch, readPosts, readPost, readSearches, growth, matchText, matchPost, postKey } = await import('../dashboard/lib/research.mjs');

const IDEAS = JSON.stringify({ ideas: [{ id: 'idea-1', post: 'instagram-3968528610867647341', angle: 'My angle: show the n8n build live', savedAt: '2026-11-16T20:00:00Z' }] }, null, 2);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'research-'));
  const cfg = loadConfig({ root });
  mkdirSync(cfg.researchDir, { recursive: true });
  writeFileSync(join(cfg.researchDir, 'ideas.json'), IDEAS); // a saved idea with a note; no import may touch it
  return cfg;
}
// Every file under the research folder, by content hash.
function snapshot(cfg) {
  const out = {}; const walk = d => { for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) walk(f); else out[relative(cfg.researchDir, f)] = createHash('sha256').update(readFileSync(f)).digest('hex'); } };
  walk(cfg.researchDir); return out;
}
const read = (cfg, platform, id) => readPost(cfg, postKey(platform, id));
const stored = (cfg, platform, id) => JSON.stringify(read(cfg, platform, id));

const IG = '3968528610867647341', YT = 'du4p-0nBMas', TT = '7703257820640152852';
const ig = (extra = {}) => ({ platform: 'instagram', id: IG, provider: 'signal-room', url: 'https://www.instagram.com/p/DcTC77TvZNt/', format: 'short', creator: { handle: 'sample.creator', name: 'Sample Creator' }, title: 'Five free plugins', caption: 'Comment STAR for the setup. #claude', publishedAt: '2026-08-21T10:00:00Z', durationSeconds: 51.4, transcript: { text: 'If you are not using these five plugins you are missing out. Five, awesome MCPs.', origin: 'signal-room', capturedAt: '2026-08-23T00:00:00Z' }, observation: { measuredAt: '2026-08-22T10:17:39Z', metrics: { plays: 24090, likes: 469, comments: 393, shares: 276, saves: null }, outlier: { metric: 'reach_per_follower', value: 1.05, percentile: 100, cohortSize: 20 } }, ...extra });
const ytTracked = (extra = {}) => ({ platform: 'youtube', id: YT, provider: 'signal-room', url: 'https://www.youtube.com/shorts/du4p-0nBMas', format: 'short', creator: { name: 'Sample Channel' }, title: 'Make AI videos inside a chat', publishedAt: '2026-10-28T12:00:00Z', durationSeconds: 41, transcript: null, observation: { measuredAt: null, metrics: { views: 10236, likes: 95, comments: 52 }, outlier: { metric: 'bounded_velocity_signal', value: 49.04, percentile: 100, cohortSize: 2 } }, ...extra });
const ytDiscovery = (extra = {}) => ({ platform: 'youtube', id: YT, provider: 'last30free', url: 'https://www.youtube.com/watch?v=du4p-0nBMas', format: 'unknown', title: 'Make AI videos inside a chat', publishedAt: null, durationSeconds: 41, transcript: null, observation: { measuredAt: '2026-11-17T09:00:00Z', metrics: { views: 11800 }, discoveryScore: 14.2 }, ...extra });
const tiktok = (extra = {}) => ({ platform: 'tiktok', id: TT, provider: 'last30free', url: 'https://www.tiktok.com/@someone/video/7703257820640152852', format: 'short', creator: { handle: 'someone' }, title: 'n8n is the whole team', caption: 'n8n is the whole team #n8n', publishedAt: '2026-11-01T17:34:44Z', durationSeconds: 5, transcript: null, observation: { measuredAt: '2026-11-17T09:00:00Z', metrics: { views: 507400, likes: 88300 }, discoveryScore: 21.25 }, ...extra });
const laneOf = p => p.platform === 'instagram' ? 'instagram_short_form' : p.platform === 'tiktok' ? 'tiktok_hashtag' : p.provider === 'last30free' ? 'youtube_discovery' : 'youtube_short_form';
function batch(id, retrievedAt, posts, extraRuns = []) {
  const runs = {};
  for (const p of posts) (runs[laneOf(p)] ||= { provider: p.provider, lane: laneOf(p), status: 'ok', results: [] }).results.push(`${p.platform}:${p.id}`);
  return { schema: 1, batchId: id, retrievedAt, search: { query: 'n8n', windowDays: 30 }, runs: [...Object.values(runs), ...extraRuns], posts };
}
const DAY1 = '2026-11-17T09:00:00Z', DAY2 = '2026-11-18T09:00:00Z', DAY3 = '2026-11-19T09:00:00Z';

test('a first import stores each post once, with provenance, and logs the search', () => {
  const cfg = fixture();
  const r = importBatch(cfg, batch('b1', DAY1, [ig(), ytTracked(), tiktok()]));
  assert.deepEqual([r.created, r.updated, r.unchanged, r.observationsAdded], [3, 0, 0, 3]);
  const p = read(cfg, 'instagram', IG);
  assert.equal(p.nativeId, IG); assert.equal(p.format, 'short'); assert.equal(p.durationSeconds, 51.4); assert.equal(p.url, 'https://www.instagram.com/p/DcTC77TvZNt/');
  assert.deepEqual(p.provenance, [{ provider: 'signal-room', firstRetrievedAt: DAY1, lastRetrievedAt: DAY1, batches: ['b1'] }]);
  // measurement time and retrieval time are separate facts
  assert.equal(p.observations[0].measuredAt, '2026-08-22T10:17:39Z'); assert.equal(p.observations[0].firstRetrievedAt, DAY1);
  // an unknown metric stays absent; it is not stored as 0
  assert.ok(!('saves' in p.observations[0].metrics));
  // caption and transcript are separate, and the transcript keeps where it came from
  assert.equal(p.caption, 'Comment STAR for the setup. #claude');
  assert.deepEqual([p.transcript.origin, p.transcript.provider, p.transcript.capturedAt], ['signal-room', 'signal-room', '2026-08-23T00:00:00Z']);
  // a TikTok find is kept without a transcript
  assert.equal(read(cfg, 'tiktok', TT).transcript, null);
  const log = readSearches(cfg);
  assert.equal(log.length, 1); assert.equal(log[0].search.query, 'n8n'); assert.deepEqual(log[0].runs.map(x => x.lane).sort(), ['instagram_short_form', 'tiktok_hashtag', 'youtube_short_form']);
});

test('importing the same batch again changes nothing, dated or undated', () => {
  const cfg = fixture();
  const b = batch('b1', DAY1, [ig(), ytTracked(), tiktok()]); // ytTracked carries an undated measurement
  importBatch(cfg, b); const snap = snapshot(cfg);
  for (let i = 0; i < 3; i++) { const r = importBatch(cfg, structuredClone(b)); assert.equal(r.alreadyImported, true); }
  assert.deepEqual(snapshot(cfg), snap);
  assert.equal(read(cfg, 'youtube', YT).observations.length, 1);
});

test('the same undated result in later batches does not manufacture measurement history', () => {
  const cfg = fixture();
  importBatch(cfg, batch('b1', DAY1, [ytTracked()]));
  importBatch(cfg, batch('b2', DAY2, [ytTracked()]));
  importBatch(cfg, batch('b3', DAY3, [ytTracked()]));
  const p = read(cfg, 'youtube', YT);
  assert.equal(p.observations.length, 1);
  assert.deepEqual([p.observations[0].measuredAt, p.observations[0].firstRetrievedAt, p.observations[0].lastRetrievedAt], [null, DAY1, DAY3]);
  assert.deepEqual(p.provenance[0].batches, ['b1', 'b2', 'b3']);
  assert.equal(growth(p, 'signal-room', 'views'), null); // nothing dated, so no trend
  assert.equal(readSearches(cfg).length, 3); // every search is still on record
});

test('equal counts at two known times stay two measurements and give zero growth', () => {
  const cfg = fixture();
  importBatch(cfg, batch('b1', DAY1, [ig()]));
  importBatch(cfg, batch('b2', DAY2, [ig({ observation: { ...ig().observation, measuredAt: '2026-11-18T08:00:00Z' } })]));
  const p = read(cfg, 'instagram', IG);
  assert.deepEqual(p.observations.map(o => [o.measuredAt, o.metrics.plays]), [['2026-08-22T10:17:39Z', 24090], ['2026-11-18T08:00:00Z', 24090]]);
  const g = growth(p, 'signal-room', 'plays');
  assert.ok(g); assert.equal(g.delta, 0); assert.equal(g.perDay, 0);
});

test('an undated measurement is never merged into a dated one, even when the counts match', () => {
  // undated first, then the same counts with a date: the undated evidence stays as it was and the dated one is added
  const cfg = fixture();
  importBatch(cfg, batch('c1', DAY1, [ytTracked()]));
  const original = read(cfg, 'youtube', YT).observations[0];
  importBatch(cfg, batch('c2', DAY2, [ytTracked({ observation: { ...ytTracked().observation, measuredAt: '2026-11-16T08:00:00Z' } })]));
  let p = read(cfg, 'youtube', YT);
  assert.equal(p.observations.length, 2);
  assert.deepEqual(p.observations.find(o => o.measuredAt === null), original);
  assert.equal(p.observations.find(o => o.measuredAt).firstRetrievedAt, DAY2);
  assert.equal(growth(p, 'signal-room', 'views'), null); // one dated measurement is not a trend
  // dated first, then the same counts undated: kept apart, and repeating the undated one adds nothing more
  const cfg2 = fixture(); const undated = ig({ observation: { ...ig().observation, measuredAt: null } });
  importBatch(cfg2, batch('b1', DAY1, [ig()]));
  importBatch(cfg2, batch('b2', DAY2, [undated])); importBatch(cfg2, batch('b3', DAY3, [undated]));
  p = read(cfg2, 'instagram', IG);
  assert.deepEqual(p.observations.map(o => [o.measuredAt, o.firstRetrievedAt, o.lastRetrievedAt]).sort(), [['2026-08-22T10:17:39Z', DAY1, DAY1], [null, DAY2, DAY3]].sort());
});

test('a new dated measurement is added and the earlier one is kept exactly', () => {
  const cfg = fixture();
  importBatch(cfg, batch('b1', DAY1, [ig()]));
  const first = read(cfg, 'instagram', IG).observations[0];
  const r = importBatch(cfg, batch('b2', DAY2, [ig({ observation: { measuredAt: '2026-11-18T08:00:00Z', metrics: { plays: 30090, likes: 600, comments: 400, shares: 300 }, outlier: { metric: 'reach_per_follower', value: 1.31, percentile: 100, cohortSize: 20 } } })]));
  assert.deepEqual([r.created, r.updated, r.observationsAdded], [0, 1, 1]);
  const p = read(cfg, 'instagram', IG);
  assert.equal(p.observations.length, 2);
  assert.deepEqual(p.observations[0], first);
  assert.equal(p.observations[1].metrics.plays, 30090);
  const g = growth(p, 'signal-room', 'plays');
  assert.equal(g.delta, 6000); assert.equal(g.from.at, '2026-08-22T10:17:39Z'); assert.equal(g.to.at, '2026-11-18T08:00:00Z'); assert.ok(g.days > 87 && g.days < 88);
});

test('growth needs two dated measurements of the same metric from the same source', () => {
  const cfg = fixture();
  importBatch(cfg, batch('b1', DAY1, [ytTracked(), ytDiscovery(), ig()]));
  const yt = read(cfg, 'youtube', YT);
  assert.equal(yt.observations.length, 2);
  assert.equal(growth(yt, 'signal-room', 'views'), null); // undated
  assert.equal(growth(yt, 'last30free', 'views'), null); // one dated measurement only
  // an undated and a dated measurement from one source are still not a trend
  importBatch(cfg, batch('b2', DAY2, [ytTracked({ observation: { measuredAt: '2026-11-18T08:00:00Z', metrics: { views: 12000 } } })]));
  assert.equal(growth(read(cfg, 'youtube', YT), 'signal-room', 'views'), null);
  // two sources' numbers are never combined into one
  importBatch(cfg, batch('b3', DAY3, [ytDiscovery({ observation: { measuredAt: DAY3, metrics: { views: 13000 }, discoveryScore: 15 } })]));
  const g = growth(read(cfg, 'youtube', YT), 'last30free', 'views');
  assert.deepEqual([g.from.value, g.to.value, g.delta, g.days], [11800, 13000, 1200, 2]);
  const igp = read(cfg, 'instagram', IG);
  assert.equal(growth(igp, 'signal-room', 'plays'), null); // one measurement
  assert.equal(growth(igp, 'signal-room', 'saves'), null); // metric never known
});

test('growth is since the previous measurement: the latest two distinct times, with both dates', () => {
  const cfg = fixture(); const at = (d, views) => ytDiscovery({ observation: { measuredAt: d, metrics: { views }, discoveryScore: 14 } });
  importBatch(cfg, batch('g1', DAY1, [at(DAY1, 10000)]));
  importBatch(cfg, batch('g2', DAY2, [at(DAY2, 12000)]));
  importBatch(cfg, batch('g3', DAY3, [at(DAY3, 15000)]));
  const g = growth(read(cfg, 'youtube', YT), 'last30free', 'views');
  assert.deepEqual([g.from.at, g.from.value, g.to.at, g.to.value, g.delta, g.days], [DAY2, 12000, DAY3, 15000, 3000, 1]);
  // a measurement whose time came from a file date or a backfilled run is shown but never makes a trend
  const p = read(cfg, 'youtube', YT); p.observations.at(-1).measuredBasis = 'file-mtime';
  assert.deepEqual([growth(p, 'last30free', 'views').from.at, growth(p, 'last30free', 'views').to.at], [DAY1, DAY2]);
});

test('measurements differing only in followers, reach, score or outlier evidence stay separate', () => {
  const cfg = fixture(); const base = { measuredAt: null, metrics: { views: 10236, likes: 95 } };
  importBatch(cfg, batch('f1', DAY1, [ytTracked({ observation: { ...base, metrics: { ...base.metrics, followers: 10 } } })]));
  importBatch(cfg, batch('f2', DAY2, [ytTracked({ observation: { ...base, metrics: { ...base.metrics, followers: 20 } } })]));
  importBatch(cfg, batch('f3', DAY3, [ytTracked({ observation: { ...base, metrics: { ...base.metrics, followers: 20 }, outlier: { metric: 'bounded_velocity_signal', value: 2, percentile: 50, cohortSize: 4 } } })]));
  assert.equal(read(cfg, 'youtube', YT).observations.length, 3);
  const cfg2 = fixture(); const d = (s) => ytDiscovery({ observation: { measuredAt: DAY1, metrics: { views: 11800 }, discoveryScore: s } });
  importBatch(cfg2, batch('s1', DAY1, [d(10)])); importBatch(cfg2, batch('s2', DAY2, [d(20)]));
  assert.deepEqual(read(cfg2, 'youtube', YT).observations.map(o => o.discoveryScore), [10, 20]);
});

test('a dry run on an empty store does not create the database', () => {
  const cfg = fixture();
  importBatch(cfg, batch('b1', DAY1, [ig()]), { dryRun: true });
  assert.ok(!existsSync(join(cfg.researchDir, 'research.sqlite')));
  assert.deepEqual(readPosts(cfg), []); assert.deepEqual(readSearches(cfg), []);
});

test('one post found by both sources is stored once, with both provenances and separate evidence', () => {
  const cfg = fixture();
  importBatch(cfg, batch('b1', DAY1, [ytTracked(), ytDiscovery()]));
  assert.equal(readPosts(cfg).length, 1);
  const p = read(cfg, 'youtube', YT);
  assert.deepEqual(p.provenance.map(x => x.provider).sort(), ['last30free', 'signal-room']);
  const tracked = p.observations.find(o => o.provider === 'signal-room'), found = p.observations.find(o => o.provider === 'last30free');
  assert.ok(tracked.outlier && !('discoveryScore' in tracked)); // creator outlier evidence
  assert.ok(found.discoveryScore === 14.2 && !('outlier' in found)); // discovery engagement score
  assert.equal(p.format, 'short'); // "unknown" from discovery never replaces a known format
  // and across separate batches too
  const cfg2 = fixture();
  importBatch(cfg2, batch('b1', DAY1, [ytDiscovery()])); importBatch(cfg2, batch('b2', DAY2, [ytTracked()]));
  assert.equal(readPosts(cfg2).length, 1); assert.equal(read(cfg2, 'youtube', YT).provenance.length, 2); assert.equal(read(cfg2, 'youtube', YT).format, 'short');
});

test('YouTube ids that differ only by case get different keys', () => {
  assert.notEqual(postKey('youtube', 'abcDEFghijk').toLowerCase(), postKey('youtube', 'ABCdefGHIJK').toLowerCase());
  assert.equal(postKey('instagram', IG), 'instagram-' + IG);
});

test('an invalid batch is rejected before any post data changes', () => {
  const cfg = fixture();
  importBatch(cfg, batch('b1', DAY1, [ig(), tiktok()])); const snap = snapshot(cfg);
  // one good, changed post and one bad post: the good one must not be written either
  const mixed = batch('b2', DAY2, [ig({ observation: { measuredAt: '2026-11-18T08:00:00Z', metrics: { plays: 99999 } } }), tiktok({ observation: { measuredAt: DAY2, metrics: { views: -5 } } })]);
  assert.throws(() => importBatch(cfg, mixed), e => /Nothing was changed/.test(e.message) && e.errors.some(m => /metric views/.test(m)));
  assert.deepEqual(snapshot(cfg), snap);
  const rejects = (b, re) => assert.ok(validateBatch(b).some(m => re.test(m)), `expected ${re} in ${JSON.stringify(validateBatch(b))}`);
  rejects(batch('x', DAY1, [ig({ transcript: { text: 'Comment STAR for the setup. #claude', origin: 'signal-room' } })]), /caption is not a transcript/);
  rejects(batch('x', DAY1, [ig({ transcript: { text: 'words', origin: 'caption' } })]), /transcript\.origin/);
  rejects(batch('x', DAY1, [ig({ provider: 'last30free', observation: null })]), /not allowed for instagram/); // paid Instagram fetching stays off
  rejects(batch('x', DAY1, [{ ...ig(), platform: 'x' }]), /instagram, youtube or tiktok/);
  rejects(batch('x', DAY1, [{ ...ig(), platform: 'reddit' }]), /instagram, youtube or tiktok/);
  rejects(batch('x', DAY1, [ig({ id: 'DcTC77TvZNt' })]), /not a instagram id/); // the shortcode is not the canonical id
  rejects(batch('x', DAY1, [ig({ url: 'https://example.com/p/1' })]), /https instagram link/);
  rejects(batch('x', DAY1, [ig({ observation: { measuredAt: '22 Aug 2026', metrics: {} } })]), /measuredAt/);
  rejects(batch('x', DAY1, [ig({ observation: { measuredAt: '2026-12-01T00:00:00Z', metrics: { plays: 1 } } })]), /later than the batch/);
  rejects(batch('x', DAY1, [tiktok({ observation: { measuredAt: DAY1, metrics: { views: 1 }, outlier: { metric: 'm', value: 1 } } })]), /Signal Room only/);
  rejects(batch('x', DAY1, [ig({ observation: { measuredAt: null, metrics: { plays: 1 }, discoveryScore: 3 } })]), /last30free only/);
  rejects(batch('x', DAY1, [ig(), ig()]), /listed twice/);
  rejects({ ...batch('x', DAY1, [ig()]), runs: [{ provider: 'last30free', lane: 'hn', status: 'ok', results: [] }] }, /lane must be one of/);
  rejects({ ...batch('x', DAY1, [ig()]), runs: [{ provider: 'signal-room', lane: 'instagram_short_form', status: 'ok', results: [] }] }, /not listed in any run/);
  rejects(batch('x', DAY1, [], [{ provider: 'last30free', lane: 'tiktok_hashtag', status: 'error', results: [] }]), /must carry its error text/);
  rejects({ ...batch('x', 'yesterday', [ig()]) }, /retrievedAt/);
  assert.deepEqual(validateBatch(batch('ok', DAY1, [ig(), ytTracked(), ytDiscovery(), tiktok()])), []);
});

test('a reused batch id with different contents is refused', () => {
  const cfg = fixture();
  importBatch(cfg, batch('b1', DAY1, [ig()])); const snap = snapshot(cfg);
  assert.throws(() => importBatch(cfg, batch('b1', DAY1, [ig(), tiktok()])), /already imported with different contents/);
  assert.deepEqual(snapshot(cfg), snap);
});

test('a failed source and an omitted post leave earlier discoveries as they were', () => {
  const cfg = fixture();
  importBatch(cfg, batch('b1', DAY1, [ig(), ytTracked(), tiktok()]));
  const keep = { yt: stored(cfg, 'youtube', YT), tt: stored(cfg, 'tiktok', TT) };
  // next day: TikTok fails, YouTube returns nothing, Instagram returns the same post unchanged
  const r = importBatch(cfg, batch('b2', DAY2, [ig()], [
    { provider: 'last30free', lane: 'tiktok_hashtag', status: 'error', error: 'TikTok search failed: timeout', results: [] },
    { provider: 'signal-room', lane: 'youtube_short_form', status: 'ok', results: [] },
  ]));
  assert.deepEqual(r.failedRuns, [{ lane: 'tiktok_hashtag', error: 'TikTok search failed: timeout' }]);
  assert.equal(stored(cfg, 'youtube', YT), keep.yt);
  assert.equal(stored(cfg, 'tiktok', TT), keep.tt);
  assert.equal(readPosts(cfg).length, 3);
  assert.equal(readSearches(cfg)[1].runs.find(x => x.lane === 'tiktok_hashtag').error, 'TikTok search failed: timeout'); // the failure is on record
  // a later result with fields missing never blanks what is stored
  importBatch(cfg, batch('b3', DAY3, [ig({ title: null, caption: null, transcript: null, durationSeconds: null, observation: null })]));
  const p = read(cfg, 'instagram', IG);
  assert.equal(p.title, 'Five free plugins'); assert.equal(p.durationSeconds, 51.4); assert.ok(p.transcript.text.startsWith('If you are not')); assert.equal(p.observations.length, 1);
});

test('saved ideas and notes are byte-identical after every kind of import', () => {
  const cfg = fixture(); const f = join(cfg.researchDir, 'ideas.json');
  importBatch(cfg, batch('b1', DAY1, [ig(), ytTracked(), tiktok()]));
  importBatch(cfg, batch('b1', DAY1, [ig(), ytTracked(), tiktok()]));
  importBatch(cfg, batch('b2', DAY2, [ig({ observation: { measuredAt: '2026-11-18T08:00:00Z', metrics: { plays: 30090 } } })]));
  assert.throws(() => importBatch(cfg, { schema: 1 }));
  assert.equal(readFileSync(f, 'utf8'), IDEAS);
});

test('a dry run writes nothing', () => {
  const cfg = fixture(); const snap = snapshot(cfg);
  const r = importBatch(cfg, batch('b1', DAY1, [ig(), tiktok()]), { dryRun: true });
  assert.deepEqual([r.created, r.observationsAdded], [2, 2]);
  assert.deepEqual(snapshot(cfg), snap);
});

test('the importer command reports, rejects and is safe to repeat', () => {
  const cfg = fixture(); const cli = join(import.meta.dirname, '..', 'dashboard', 'research-import.mjs');
  const run = file => spawnSync(process.execPath, [cli, file], { env: { ...process.env, DASH_ROOT: cfg.root }, encoding: 'utf8' });
  const good = join(cfg.root, 'good.json'), bad = join(cfg.root, 'bad.json');
  writeFileSync(good, JSON.stringify(batch('b1', DAY1, [ig(), tiktok()])));
  writeFileSync(bad, JSON.stringify(batch('b2', DAY2, [ig({ format: 'reel' })])));
  let r = run(good); assert.equal(r.status, 0); assert.match(r.stdout, /Imported batch b1: 2 new posts, 0 updated, 0 unchanged, 2 new measurements/);
  const snap = snapshot(cfg);
  r = run(good); assert.equal(r.status, 0); assert.match(r.stdout, /already imported\. Nothing changed/);
  r = run(bad); assert.equal(r.status, 1); assert.match(r.stderr, /Nothing was changed/); assert.match(r.stderr, /format must be short, long or unknown/);
  assert.deepEqual(snapshot(cfg), snap);
  assert.ok(!existsSync(join(cfg.root, 'reels-data', 'content'))); // the importer writes only under reels-data/research
});

test('keyword matching uses whole words and quoted phrases', () => {
  // AI
  assert.ok(matchText('This AI tool builds it for you', 'AI'));
  assert.ok(matchText('an ai-powered agent', 'AI'));
  assert.ok(matchText('Is it AI?', 'ai'));
  assert.ok(!matchText('She said to email the maintainer again', 'AI'));
  assert.ok(!matchText('Use code AI50 today', 'AI'));
  // MCP
  assert.ok(matchText('Add the n8n MCP server', 'MCP'));
  assert.ok(matchText('three MCPs that give Claude superpowers', 'MCP'));
  assert.ok(matchText('three MCPs that give Claude superpowers', 'MCPs'));
  assert.ok(!matchText('three MCPs that give Claude superpowers', '"MCP"')); // quoted is exact: no plural added
  assert.ok(matchText('the MCP server', '"MCP"'));
  assert.ok(!matchText('the MCPss and MCPes', 'MCP')); // one plural s only
  assert.ok(matchText("the MCP's tools", 'MCP'));
  assert.ok(!matchText('one skill', 'skills')); // a plural query does not find the singular
  assert.ok(!matchText('Comment MCP50 for 50% off', 'MCP'));
  assert.ok(!matchText('This is the MCPL, explain that in a second', 'MCP'));
  // n8n
  assert.ok(matchText('If I was starting with N8N today', 'n8n'));
  assert.ok(!matchText('the n8nify plugin', 'n8n'));
  // multiword: bare words must all appear anywhere; quoted words must appear together, in order
  const spread = 'Claude writes the code and then loads your skills';
  assert.ok(matchText(spread, 'claude code skills'));
  assert.ok(!matchText(spread, '"claude code skills"'));
  assert.ok(matchText('seven Claude  Code skills that help', '"claude code skills"'));
  assert.ok(matchText('seven Claude Code skills that help', '"claude code" skills'));
  assert.ok(!matchText('Claude writes code', 'claude code skills'));
  assert.ok(!matchText('seven Claude Code skills that help', '"claude code skill"')); // exact phrase, no plural added
  assert.ok(matchText('seven Claude Code skills that help', 'claude code skill'));
  assert.ok(!matchText('skills for Claude Code', '"claude code skills"')); // order matters
  assert.ok(!matchText('Claude Codex skills', '"claude code skills"'));
  assert.ok(!matchText('anything at all', ''));
  assert.ok(matchText('what does c++ cost', 'c++')); // punctuation in a term is literal, not a pattern
});

test('a post reports which part matched, so a caption hit is not shown as spoken words', () => {
  const cfg = fixture(); importBatch(cfg, batch('b1', DAY1, [ig(), tiktok()]));
  const a = matchPost(read(cfg, 'instagram', IG), 'MCP');
  assert.equal(a.matched, true); assert.deepEqual(a.fields, { transcript: ['MCP'] });
  const b = matchPost(read(cfg, 'tiktok', TT), 'n8n');
  assert.equal(b.matched, true); assert.deepEqual(Object.keys(b.fields).sort(), ['caption', 'title']); // no transcript exists
  const c = matchPost(read(cfg, 'instagram', IG), 'plugins claude');
  assert.equal(c.matched, true); assert.deepEqual(c.fields, { transcript: ['plugins'], title: ['plugins'], caption: ['claude'] });
  assert.equal(matchPost(read(cfg, 'instagram', IG), 'n8n').matched, false);
});
