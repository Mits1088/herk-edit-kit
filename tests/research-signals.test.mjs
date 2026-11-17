// research-signals: the draft-to-batch builder. Fixtures use the field shapes Signal Room and last30free
// returned on 2026-11-16; nothing here calls either service.
import test from 'node:test';
import assert from 'node:assert/strict';
const { buildBatch, youtubeFallback, iso } = await import('../.claude/skills/research-signals/build-batch.mjs');
const { validateBatch } = await import('../dashboard/lib/research.mjs');

const igMatch = (id, extra = {}) => ({ source: 'instagram_short_form', externalId: id, balancedScore: 80, creator: 'sample.creator', durationSeconds: 39.1, publishedAt: 1767478149000, title: 'Comment agent for the n8n guide', url: 'https://www.instagram.com/p/DTEJP3rEQr2/', metrics: { comments: 963, likes: 1220, plays: 34999, reach: 34999, reachPerFollower: 0.151, views: 12132 }, hook: 'Claude Code is better at N8N than N8N is itself.', ...extra });
const ytMatch = (id, source, extra = {}) => ({ source, externalId: id, balancedScore: 86, channel: 'Sample Channel', durationSeconds: 41, publishedAt: 1794694830000, title: 'The n8n way', url: source === 'youtube_short_form' ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`, performanceMetric: 'bounded_velocity_signal', performanceValue: 21.44, metrics: { comments: 0, likes: 5, subscribers: 124000, views: 526 }, hook: 'The fastest way to build N8N automations.', ...extra });
const detail = { externalId: '3802204658396629750', caption: 'Comment agent for the n8n guide', observations: [{ commentsCount: 963, followersCount: 229845, likesCount: 1220, observedAt: 1786849248513, playsCount: 34999, viewsCount: 12132 }, { commentsCount: 970, followersCount: 229922, likesCount: 1230, observedAt: 1786899245756, playsCount: 35100, viewsCount: 12200 }], transcript: { capturedAt: 1786899245756, status: 'ready' } };
const l30 = (source, items) => ({ results: { [source]: { status: 'ok', count: items.length, error: null } }, merged: { items } });
const ttItem = { source: 'tiktok', source_id: '7708502162103438612', url: 'https://www.tiktok.com/@someone/video/7708502162103438612', title: 'my n8n system #n8n', text: 'my n8n system #n8n', author: 'someone', created_at: '2026-11-15T20:45:31Z', score: 7.67, metrics: { comments: 0, likes: 186, reposts: 2, views: 3260 }, raw: { hashtag: 'n8n', full_name: 'Some One', followers: 0, video_duration_secs: 66 } };
const ytItem = (id, dur, extra = {}) => ({ source: 'youtube', source_id: id, url: `https://www.youtube.com/watch?v=${id}`, title: 'Is n8n dead?', text: 'Is n8n dead?\n\nSelf-host n8n today', author: 'A Channel', created_at: '2026-11-16T12:59:18Z', score: 6.73, metrics: { views: 2136, likes: 0, comments: 0 }, raw: { duration: dur, uploader_id: '@achannel' }, ...extra });
const FETCHED = new Date('2026-11-16T21:17:54.454Z');
const io = files => ({ readJson: f => files[f], mtime: () => FETCHED });
const base = extra => ({ batchId: 'b1', query: 'n8n', windowDays: 30, retrievedAt: '2026-11-16T21:23:05Z', ...extra });

test('Signal Room times are Unix milliseconds and convert exactly; anything else is refused', () => {
  assert.equal(iso(1786899245756), '2026-08-16T16:54:05.756Z');
  assert.equal(iso(1794694830000), '2026-11-14T22:20:30.000Z');
  assert.equal(iso(null), null);
  assert.throws(() => iso(1794694830), /milliseconds/); // seconds, not milliseconds
  assert.throws(() => iso('2026-11-14'), /milliseconds/);
});

test('Instagram: a measurement time comes only from the item detail; without it the time stays unknown', () => {
  const d = base({ signalRoom: { lanes: ['instagram_short_form'], matches: [igMatch('3802204658396629750'), igMatch('3789920030163839258', { balancedScore: 70, url: 'https://www.instagram.com/p/DSYgDAFDaka/' })], instagramDetails: [detail], transcripts: [{ platform: 'instagram', id: '3802204658396629750', text: 'Claude Code is better at N8N than N8N is itself. Let me explain.' }] } });
  const b = buildBatch(d, io({}));
  assert.deepEqual(validateBatch(b), []);
  const [a, c] = b.posts;
  // the newest observation is used, with its own time and its own counts
  assert.deepEqual(a.observation, { measuredAt: '2026-08-16T16:54:05.756Z', metrics: { plays: 35100, views: 12200, likes: 1230, comments: 970, followers: 229922 }, outlier: { metric: 'reach_per_follower', value: 0.151 } });
  assert.deepEqual(a.transcript, { text: 'Claude Code is better at N8N than N8N is itself. Let me explain.', origin: 'signal-room', capturedAt: '2026-08-16T16:54:05.756Z' });
  assert.equal(a.publishedAt, '2026-01-03T22:09:09.000Z');
  assert.equal(c.observation.measuredAt, null); assert.equal(c.observation.metrics.plays, 34999);
  assert.equal(c.transcript, null); assert.equal(c.caption, null); // the hook is an excerpt, never stored as a transcript
  assert.ok(!('percentile' in a.observation.outlier)); // percentiles describe one search, not the post
  assert.deepEqual(b.runs[0].results, ['instagram:3802204658396629750', 'instagram:3789920030163839258']); // by balanced score
  assert.match(b.runs[0].note, /top matches from this search/); assert.match(b.runs[0].note, /2 of 2 match "n8n"/);
});

test('YouTube from Signal Room is undated, so the fallback is required and enforced', () => {
  const sr = { lanes: ['youtube_short_form', 'youtube_long_form'], matches: [ytMatch('If5q9eJ66EU', 'youtube_short_form'), ytMatch('ynEEbqKQSaY', 'youtube_long_form', { durationSeconds: 754 })] };
  const reasons = youtubeFallback(base({ signalRoom: sr }));
  assert.ok(reasons.some(r => /2 relevant .* \(fewer than 5\)/.test(r)) && reasons.some(r => /no measurement time/.test(r)));
  assert.throws(() => buildBatch(base({ signalRoom: sr }), io({})), /YouTube fallback is required/);
  // nothing came back at all: still fewer than five, so still required
  assert.ok(youtubeFallback(base({ signalRoom: { lanes: ['youtube_long_form'], matches: [] } })).length);
  // an Instagram-only search asks for no YouTube fallback
  assert.deepEqual(youtubeFallback(base({ signalRoom: { lanes: ['instagram_short_form'], matches: [igMatch('3802204658396629750')] } })), []);
  // a loose Signal Room hit that is not the whole word does not count as relevant
  const loose = { lanes: ['youtube_long_form'], matches: Array.from({ length: 6 }, (_, i) => ytMatch('abcdefghij' + i, 'youtube_long_form', { title: 'Promo', hook: 'Comment MCP50 for the link' })) };
  assert.ok(youtubeFallback({ ...base({ signalRoom: loose }), query: 'MCP' }).some(r => /^0 relevant/.test(r)));

  const files = { yt: l30('youtube', [ytItem('ynEEbqKQSaY', 754), ytItem('EuUF53Wwfm0', 1577), ytItem('shortish123', 45)]), subs: { fetchedAt: '2026-11-16T21:23:05Z', transcripts: { EuUF53Wwfm0: 'Is n8n dead? Not even close.' }, failed: { ynEEbqKQSaY: 'HTTP Error 429' } } };
  const b = buildBatch(base({ signalRoom: sr, last30free: { youtube: { file: 'yt' }, subtitles: { file: 'subs' } } }), io(files));
  assert.deepEqual(validateBatch(b), []);
  const tracked = b.posts.find(p => p.id === 'ynEEbqKQSaY' && p.provider === 'signal-room'), found = b.posts.find(p => p.id === 'ynEEbqKQSaY' && p.provider === 'last30free');
  assert.equal(tracked.observation.measuredAt, null); // a recent publication date is not a measurement time
  assert.deepEqual(tracked.observation.outlier, { metric: 'bounded_velocity_signal', value: 21.44 }); assert.ok(!('discoveryScore' in tracked.observation));
  assert.equal(found.observation.measuredAt, '2026-11-16T21:17:54Z'); assert.equal(found.observation.measuredBasis, 'file-mtime'); // older output: the file's time, whole seconds, never used for growth
   assert.equal(found.observation.discoveryScore, 6.73); assert.ok(!('outlier' in found.observation));
  assert.equal(found.observation.metrics.likes, null); // last30free writes 0 for a missing count: unknown, not zero
  assert.equal(found.format, 'long'); assert.equal(found.transcript, null); // subtitles failed: no transcript, and the description is not one
  assert.equal(found.caption, 'Self-host n8n today');
  assert.deepEqual(b.posts.find(p => p.id === 'EuUF53Wwfm0').transcript, { text: 'Is n8n dead? Not even close.', origin: 'subtitles', capturedAt: '2026-11-16T21:23:05Z' });
  assert.equal(b.posts.find(p => p.id === 'shortish123').format, 'unknown'); // under three minutes with no /shorts/ link proves nothing
  const run = b.runs.find(r => r.lane === 'youtube_discovery');
  assert.match(run.note, /fallback because/); assert.match(run.note, /1 of 3 with subtitles/);
});

test('TikTok is labelled as hashtag discovery, saved without a transcript, and a failure is kept visible', () => {
  const sr = { lanes: ['instagram_short_form'], matches: [igMatch('3802204658396629750')] };
  const b = buildBatch(base({ signalRoom: sr, last30free: { tiktok: { file: 'tt' } } }), io({ tt: l30('tiktok', [ttItem]) }));
  assert.deepEqual(validateBatch(b), []);
  const p = b.posts.find(x => x.platform === 'tiktok');
  assert.equal(p.transcript, null); assert.equal(p.format, 'short'); assert.equal(p.durationSeconds, 66);
  assert.deepEqual(p.observation.metrics, { views: 3260, likes: 186, comments: 0, shares: 2, saves: null, followers: null });
  assert.match(b.runs.find(r => r.lane === 'tiktok_hashtag').note, /hashtag search #n8n only, no transcripts; 1 of 1 match/);
  // last30free reported an error, a command failed, and a Signal Room lane failed: each stays in the batch as a failed run
  const failed = buildBatch(base({ signalRoom: { lanes: ['instagram_short_form', 'youtube_long_form'], matches: [igMatch('3802204658396629750')], errors: [{ lane: 'youtube_long_form', error: 'The research backend is temporarily unavailable. Please retry shortly.' }] }, last30free: { tiktok: { file: 'tt' }, youtube: { error: 'yt-dlp exited 1' } } }),
    io({ tt: { results: { tiktok: { status: 'error', count: 0, error: 'TikTok search failed: timeout' } }, merged: { items: [] } } }));
  assert.deepEqual(validateBatch(failed), []);
  assert.deepEqual(failed.runs.filter(r => r.status === 'error').map(r => [r.lane, r.error]), [['youtube_long_form', 'The research backend is temporarily unavailable. Please retry shortly.'], ['youtube_discovery', 'yt-dlp exited 1'], ['tiktok_hashtag', 'TikTok search failed: timeout']]);
  assert.equal(failed.posts.length, 1);
});

test('newer last30free output: every fetched post kept, its own collection time, counts and cost carried', () => {
  const at = '2026-11-16T21:20:00.700000Z';
  const item = (source, id, extra = {}) => ({ source, source_id: id, url: source === 'tiktok' ? `https://www.tiktok.com/@a/video/${id}` : source === 'instagram' ? `https://www.instagram.com/p/${id.slice(-6)}/` : `https://www.youtube.com/shorts/${id}`,
    title: `n8n post ${id}`, text: `n8n post ${id}`, author: 'a', created_at: '2026-11-15T10:00:00Z', score: 9.5, score_formula: `l30-${source}-v1`, collected_at: at, in_window: true,
    metrics: { views: 100, likes: 0, comments: null, reposts: 3, saves: 4 }, raw: { followers: 50, media_type: 'video', username: 'a', video_duration_secs: 30, duration: 30, hashtag: 'n8n' }, ...extra });
  const out = (source, reported, fetched, cost = null) => ({ results: { [source]: { status: 'ok', count: reported.length, counts: { fetched: fetched.length, in_window: 1, outside_window: fetched.length - 1, reported: reported.length }, cost } },
    merged: { items: reported }, fetched: { count: fetched.length, items: fetched } });
  const cost = { provider: 'apify', run_id: 'RUN123', status: 'SUCCEEDED', charged_usd: 0.19, max_charge_usd: 0.5 };
  const ttShown = item('tiktok', '7708502162103438612'), ttOld = item('tiktok', '7708502162103438000', { created_at: '2026-08-01T00:00:00Z', in_window: false, score: 2 });
  const ttUndated = item('tiktok', '7708502162103438111', { created_at: null, in_window: null, score: null });
  const igShown = item('instagram', '3802204658396629750'), ysShown = item('youtube', 'If5q9eJ66EU');
  const files = { tt: out('tiktok', [ttShown], [ttShown, ttOld, ttUndated], cost), ig: out('instagram', [igShown], [igShown], cost), ys: out('youtube', [ysShown], [ysShown]) };
  const sr = { lanes: ['instagram_short_form'], matches: [igMatch('3802204658396629750')] }; // the same reel from Signal Room
  const b = buildBatch(base({ signalRoom: sr, last30free: { tiktok: { file: 'tt' }, instagram: { file: 'ig' }, youtubeShorts: { file: 'ys' } } }), io(files));
  assert.deepEqual(validateBatch(b), []);

  const tt = b.runs.find(r => r.lane === 'tiktok_hashtag');
  assert.deepEqual(tt.results, ['tiktok:7708502162103438612']);
  assert.deepEqual(tt.fetchedOnly.sort(), ['tiktok:7708502162103438000', 'tiktok:7708502162103438111']);
  assert.deepEqual([tt.counts.fetched, tt.cost.run_id], [3, 'RUN123']); assert.match(tt.note, /2 more fetched and kept/);
  const p = b.posts.find(x => x.id === '7708502162103438612');
  assert.equal(p.observation.measuredAt, '2026-11-16T21:20:00Z'); assert.equal(p.observation.measuredBasis, 'collection'); // rounded down
  assert.deepEqual(p.observation.metrics, { views: 100, likes: 0, comments: null, shares: 3, saves: 4, followers: 50 }); // a real 0 stays 0
  assert.equal(p.observation.scoreFormula, 'l30-tiktok-v1');
  const undated = b.posts.find(x => x.id === '7708502162103438111');
  assert.equal(undated.publishedAt, null); assert.equal(undated.observation.discoveryScore, null);

  assert.ok(b.runs.some(r => r.lane === 'instagram_search' && r.results[0] === 'instagram:3802204658396629750'));
  assert.equal(b.posts.filter(x => x.id === '3802204658396629750').length, 2); // one entry per source; the importer joins them
  assert.equal(b.posts.find(x => x.id === '3802204658396629750' && x.provider === 'last30free').format, 'short');
  const ys = b.runs.find(r => r.lane === 'youtube_shorts_feed');
  assert.deepEqual(ys.results, ['youtube:If5q9eJ66EU']); assert.equal(b.posts.find(x => x.id === 'If5q9eJ66EU').format, 'short');
});

test('a video found by both YouTube searches is one entry: Shorts kept, the newer measurement kept whole', () => {
  const item = (url, at, views, score) => ({ source: 'youtube', source_id: 'If5q9eJ66EU', url, title: 'n8n in 30s', text: 'n8n in 30s', author: 'Chan', created_at: '2026-11-15T10:00:00Z',
    score, score_formula: 'l30-youtube-v1', collected_at: at, in_window: true, metrics: { views, likes: 5, comments: 1 }, raw: { duration: 30, followers: 9 } });
  const out = it => ({ results: { youtube: { status: 'ok', counts: { fetched: 1 } } }, merged: { items: [it] }, fetched: { count: 1, items: [it] } });
  const first = item('https://www.youtube.com/watch?v=If5q9eJ66EU', '2026-11-16T21:00:00Z', 100, 3.1); // discovery: format unknown
  const later = item('https://www.youtube.com/shorts/If5q9eJ66EU', '2026-11-16T21:10:00Z', 200, 4.2); // Shorts feed: a known Short
  const b = buildBatch(base({ signalRoom: { lanes: [] }, last30free: { youtube: { file: 'yt' }, youtubeShorts: { file: 'ys' } } }), io({ yt: out(first), ys: out(later) }));
  assert.deepEqual(validateBatch(b), []);
  const posts = b.posts.filter(p => p.id === 'If5q9eJ66EU');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].format, 'short'); assert.match(posts[0].url, /\/shorts\//);
  assert.deepEqual([posts[0].observation.measuredAt, posts[0].observation.metrics.views, posts[0].observation.discoveryScore], ['2026-11-16T21:10:00Z', 200, 4.2]);
  assert.deepEqual(b.runs.map(r => r.results), [['youtube:If5q9eJ66EU'], ['youtube:If5q9eJ66EU']]); // both searches still list it
  // and the other way round: the older measurement arriving second does not replace the newer one
  const b2 = buildBatch(base({ signalRoom: { lanes: [] }, last30free: { youtube: { file: 'ys' }, youtubeShorts: { file: 'yt' } } }), io({ yt: out(first), ys: out(later) }));
  const p2 = b2.posts.find(p => p.id === 'If5q9eJ66EU');
  assert.deepEqual([p2.format, p2.observation.metrics.views, p2.observation.discoveryScore], ['short', 200, 4.2]);
});

test('a partial paid run is imported with its results, its reason and its cost', () => {
  const it = { source: 'tiktok', source_id: '7708502162103438612', url: 'https://www.tiktok.com/@a/video/7708502162103438612', title: 't', text: 't', author: 'a', created_at: '2026-11-15T10:00:00Z',
    score: 1, score_formula: 'l30-tiktok-v1', collected_at: '2026-11-16T21:00:00Z', in_window: true, metrics: { views: 10 }, raw: {} };
  const reason = 'TikTok Apify run RUN123 ended ABORTED; stop confirmed; 1 results it had already produced were kept';
  const tt = { results: { tiktok: { status: 'partial', error: reason, counts: { fetched: 1 }, cost: { run_id: 'RUN123', status: 'ABORTED', charged_usd: 0.19 } } }, merged: { items: [it] }, fetched: { count: 1, items: [it] } };
  const b = buildBatch(base({ signalRoom: { lanes: [] }, last30free: { tiktok: { file: 'tt' } } }), io({ tt }));
  assert.deepEqual(validateBatch(b), []);
  const run = b.runs[0];
  assert.deepEqual([run.status, run.partial, run.results, run.cost.status], ['ok', reason, ['tiktok:7708502162103438612'], 'ABORTED']);
  assert.match(run.note, /^PARTIAL: /);
});

test("Instagram's older '<media id>_<creator id>' ids become the plain media id, and stay reported", () => {
  const it = { source: 'instagram', source_id: '3858554427658188501_74737900948', url: 'https://www.instagram.com/p/DWMVs73E7bV/', title: 'reel', text: 'reel', author: 'a', created_at: '2026-11-15T10:00:00Z',
    score: 3, metrics: { views: 10, likes: 2 }, raw: { media_type: 'video', username: 'a' } };
  const b = buildBatch(base({ signalRoom: { lanes: [] }, last30free: { instagram: { file: 'ig' } } }), io({ ig: { results: { instagram: { status: 'ok' } }, merged: { items: [it] } } }));
  assert.deepEqual(validateBatch(b), []);
  assert.deepEqual([b.posts[0].id, b.runs[0].results, b.runs[0].fetchedOnly], ['3858554427658188501', ['instagram:3858554427658188501'], undefined]);
});
