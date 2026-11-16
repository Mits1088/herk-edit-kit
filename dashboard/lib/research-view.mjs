// Read-only view of the research store for the Research page. It never writes.
// Rules it applies: the publication-date window is enforced here, on stored dates; an unknown date is never
// "recent"; measurement freshness is reported apart from publication and import dates; creator outliers and raw
// engagement are separate columns; an unstable outlier signal is shown but never ranked; growth comes only from
// two dated measurements by one source.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPosts, readSearches, growth, matchPost, highlight } from './research.mjs';

const GROUPS = [['instagram:short', 'Instagram'], ['youtube:short', 'YouTube Shorts'], ['youtube:long', 'YouTube long-form'], ['youtube:unknown', 'YouTube, format unknown'], ['tiktok:short', 'TikTok']];
export const LANE_LABEL = { instagram_short_form: 'Instagram', youtube_short_form: 'YouTube Shorts', youtube_long_form: 'YouTube long-form', youtube_discovery: 'YouTube discovery', tiktok_hashtag: 'TikTok hashtag' };
export const PROVIDER_LABEL = { 'signal-room': 'Signal Room', last30free: 'last30free' };
const OUTLIER_LABEL = { reach_per_follower: 'reach per follower', age_adjusted_channel_outlier: 'age-adjusted channel outlier', bounded_velocity_signal: 'bounded velocity signal' };
// Changes between two calls for the same video (21.44 and 25.77 seen on 2026-11-16), so it cannot order results.
const UNSTABLE = ['bounded_velocity_signal'];
const PRIMARY = { instagram: ['plays', 'views'], youtube: ['views'], tiktok: ['views'] };
const STALE_DAYS = 7; // only decides when a measurement is labelled "stale" on the page
const WINDOWS = ['7', '30', '90', '365', 'all'];
const SORTS = ['published', 'engagement', 'outlier'];
// Ages are calendar days in the dashboard's timezone (Europe/London unless DASH_TZ says otherwise), so a post from
// the evening of the 14th is "2 days ago" on the 16th, whatever the hour.
let TZ = 'Europe/London';
const dayNumber = d => { const [y, m, dd] = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).split('-').map(Number); return Date.UTC(y, m - 1, dd) / 86400e3; };
const daysBetween = (iso, now) => Math.max(0, dayNumber(now) - dayNumber(new Date(iso)));
const ref = p => `${p.platform}:${p.nativeId}`;
const words = t => (t.trim() ? t.trim().split(/\s+/).length : 0);

// Every run that returned this post: which search, which source, and where it ranked among that run's top matches.
function runsOf(post, searches) {
  const out = [];
  for (const s of searches) for (const r of s.runs || []) { const i = (r.results || []).indexOf(ref(post)); if (i >= 0) out.push({ batchId: s.batchId, query: s.search.query, retrievedAt: s.retrievedAt, lane: r.lane, laneLabel: LANE_LABEL[r.lane] || r.lane, provider: r.provider, rank: i + 1, of: r.results.length, note: r.note || null }); }
  return out;
}

function summarise(post, searches, now) {
  const obs = post.observations || [];
  // Raw engagement: the newest dated count if there is one, otherwise the most recently retrieved undated one.
  const metricOf = o => PRIMARY[post.platform].find(k => typeof o.metrics[k] === 'number');
  const counted = obs.filter(metricOf);
  const dated = counted.filter(o => o.measuredAt).sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt));
  const undated = counted.filter(o => !o.measuredAt).sort((a, b) => (a.lastRetrievedAt < b.lastRetrievedAt ? 1 : -1));
  const e = dated[0] || undated[0] || null;
  const engagement = e ? { metric: metricOf(e), value: e.metrics[metricOf(e)], provider: e.provider, measuredAt: e.measuredAt, ageDays: e.measuredAt ? daysBetween(e.measuredAt, now) : null, stale: e.measuredAt ? daysBetween(e.measuredAt, now) > STALE_DAYS : null, retrievedAt: e.lastRetrievedAt } : null;
  // Creator outlier: Signal Room's creator-relative signal. A stable one is preferred; an unstable one is shown, not ranked.
  const withOutlier = obs.filter(o => o.outlier).sort((a, b) => (a.lastRetrievedAt < b.lastRetrievedAt ? 1 : -1));
  const o = withOutlier.find(x => !UNSTABLE.includes(x.outlier.metric)) || withOutlier[0] || null;
  const outlier = o ? { metric: o.outlier.metric, label: OUTLIER_LABEL[o.outlier.metric] || o.outlier.metric, value: o.outlier.value, rankable: !UNSTABLE.includes(o.outlier.metric), measuredAt: o.measuredAt } : null;
  let grow = null;
  for (const metric of PRIMARY[post.platform]) for (const pv of post.provenance || []) grow ||= growth(post, pv.provider, metric);
  const evidence = post.transcript ? 'transcript' : (post.excerpts || []).length ? 'excerpt' : post.caption ? 'caption' : 'none';
  return {
    id: post.id, platform: post.platform, format: post.format, nativeId: post.nativeId, url: post.url, title: post.title, creator: post.creator || {},
    durationSeconds: post.durationSeconds, publishedAt: post.publishedAt, publishedAgeDays: post.publishedAt ? daysBetween(post.publishedAt, now) : null,
    firstRetrievedAt: post.firstRetrievedAt, lastRetrievedAt: post.lastRetrievedAt, providers: (post.provenance || []).map(p => p.provider),
    evidence, transcript: post.transcript ? { origin: post.transcript.origin, provider: post.transcript.provider, capturedAt: post.transcript.capturedAt, words: words(post.transcript.text) } : null,
    excerptCount: (post.excerpts || []).length, hasCaption: !!post.caption,
    engagement, outlier, growth: grow, runs: runsOf(post, searches),
  };
}

function cleanFilters(f = {}) {
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  return { search: String(f.search || '').trim(), q: String(f.q || '').trim().slice(0, 200), platform: pick(f.platform, ['instagram', 'youtube', 'tiktok'], ''), format: pick(f.format, ['short', 'long', 'unknown'], ''), window: pick(f.window, WINDOWS, '30'), sort: pick(f.sort, SORTS, 'published') };
}

export function researchList(cfg, filters, now = new Date()) {
  TZ = cfg.dueTimeZone || TZ; const f = cleanFilters(filters); const posts = readPosts(cfg);
  const searches = readSearches(cfg).sort((a, b) => (a.retrievedAt < b.retrievedAt ? 1 : -1));
  const queries = [...new Set(searches.map(s => s.search.query))];
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const inSearch = f.search ? new Set(searches.filter(s => same(s.search.query, f.search)).flatMap(s => (s.runs || []).flatMap(r => r.results || []))) : null;
  // The text filter is checked on the saved text. With only a saved search chosen, its query is used to show what matched.
  const matchQuery = f.q || f.search;
  const windowDays = f.window === 'all' ? null : Number(f.window);
  const rows = [];
  for (const post of posts) {
    if (inSearch && !inSearch.has(ref(post))) continue;
    if (f.platform && post.platform !== f.platform) continue;
    if (f.format && post.format !== f.format) continue;
    const match = matchQuery ? matchPost(post, matchQuery) : null;
    if (f.q && !match.matched) continue;
    const row = summarise(post, searches, now);
    row.match = match ? { query: matchQuery, matched: match.matched, fields: Object.keys(match.fields) } : null;
    // An unknown publication date is never counted as recent.
    row.bucket = !post.publishedAt ? 'undated' : windowDays === null || row.publishedAgeDays <= windowDays ? 'recent' : 'historical';
    rows.push(row);
  }
  const last = v => (v == null ? -Infinity : v);
  const order = {
    published: (a, b) => last(b.publishedAt && Date.parse(b.publishedAt)) - last(a.publishedAt && Date.parse(a.publishedAt)),
    engagement: (a, b) => last(b.engagement && b.engagement.value) - last(a.engagement && a.engagement.value),
    outlier: (a, b) => last(b.outlier && b.outlier.rankable ? b.outlier.value : null) - last(a.outlier && a.outlier.rankable ? a.outlier.value : null),
  }[f.sort];
  const groups = GROUPS.map(([key, label]) => {
    const mine = rows.filter(r => `${r.platform}:${r.format}` === key).sort(order);
    return { key, label, recent: mine.filter(r => r.bucket === 'recent'), historical: mine.filter(r => r.bucket === 'historical'), undated: mine.filter(r => r.bucket === 'undated') };
  }).filter(g => g.recent.length + g.historical.length + g.undated.length);
  // Failed source runs in the latest search for each topic shown, so a gap is never mistaken for "nothing found".
  const failures = [];
  for (const q of queries) {
    if (f.search && !same(q, f.search)) continue;
    const s = searches.find(x => x.search.query === q);
    for (const r of s.runs || []) if (r.status === 'error') failures.push({ query: q, batchId: s.batchId, retrievedAt: s.retrievedAt, lane: r.lane, laneLabel: LANE_LABEL[r.lane] || r.lane, provider: r.provider, error: r.error });
  }
  const count = k => groups.reduce((n, g) => n + g[k].length, 0);
  return { generatedAt: now.toISOString(), filters: f, queries, groups, failures, totals: { posts: posts.length, searches: searches.length, lastRetrievedAt: searches[0] ? searches[0].retrievedAt : null, shown: rows.length, recent: count('recent'), historical: count('historical'), undated: count('undated') }, staleDays: STALE_DAYS };
}

export function researchSearches(cfg) {
  return readSearches(cfg).sort((a, b) => (a.retrievedAt < b.retrievedAt ? 1 : -1)).map(s => ({
    batchId: s.batchId, query: s.search.query, windowDays: s.search.windowDays ?? null, retrievedAt: s.retrievedAt, importedAt: s.importedAt || null, posts: s.posts,
    runs: (s.runs || []).map(r => ({ lane: r.lane, laneLabel: LANE_LABEL[r.lane] || r.lane, provider: r.provider, status: r.status, error: r.error || null, note: r.note || null, results: (r.results || []).length })),
  }));
}

// The original records a batch was built from, kept by build-batch.mjs, so copied numbers can be checked.
function builderInputs(cfg, post) {
  const out = [];
  for (const pv of post.provenance || []) for (const batchId of pv.batches || []) {
    const dir = join(cfg.researchDir, 'sources', batchId); const read = n => { try { return JSON.parse(readFileSync(join(dir, n), 'utf8')); } catch { return null; } };
    const entry = { batchId, provider: pv.provider, kept: existsSync(dir), folder: `reels-data/research/sources/${batchId}`, records: [] };
    if (pv.provider === 'signal-room') {
      const sr = (read('draft.json') || {}).signalRoom || {};
      const m = (sr.matches || []).find(x => String(x.externalId) === post.nativeId); if (m) entry.records.push({ what: 'Search match, as copied from Signal Room', data: m });
      const d = [...(sr.instagramDetails || []), ...(sr.videoDetails || [])].find(x => String(x.externalId || x.id) === post.nativeId); if (d) entry.records.push({ what: 'Item detail, as copied from Signal Room', data: d });
    } else {
      const file = read(post.platform === 'tiktok' ? 'tiktok.json' : 'youtube.json');
      const it = file && file.merged ? (file.merged.items || []).find(x => String(x.source_id) === post.nativeId) : null; if (it) entry.records.push({ what: 'Item, as written by last30free', data: it });
    }
    out.push(entry);
  }
  return out;
}

export function researchPost(cfg, id, query, now = new Date()) {
  TZ = cfg.dueTimeZone || TZ; const post = readPosts(cfg).find(p => p.id === id); if (!post) return null;
  const searches = readSearches(cfg).sort((a, b) => (a.retrievedAt < b.retrievedAt ? 1 : -1));
  const sum = summarise(post, searches, now); const q = String(query || '').trim().slice(0, 200) || (sum.runs[0] ? sum.runs[0].query : '');
  const match = q ? matchPost(post, q) : null;
  // The transcript is shown in full; this is only the first matching passage, cut from it unchanged.
  let passage = null;
  if (q && post.transcript) { const seg = highlight(post.transcript.text, q); const i = seg.findIndex(x => x.m); if (i >= 0) { const before = seg.slice(0, i).map(x => x.t).join(''), from = Math.max(0, before.length - 160); const cut = post.transcript.text.slice(from, before.length + 240); passage = { segments: highlight(cut, q), cutStart: from > 0, cutEnd: before.length + 240 < post.transcript.text.length }; } }
  return {
    ...sum, query: q, match: match ? { matched: match.matched, fields: match.fields } : null,
    caption: post.caption, captionSegments: post.caption && q ? highlight(post.caption, q) : null, titleSegments: post.title && q ? highlight(post.title, q) : null,
    excerpts: (post.excerpts || []).map(e => ({ ...e, segments: highlight(e.text, q) })),
    transcriptText: post.transcript ? post.transcript.text : null, transcriptPassage: passage,
    provenance: post.provenance || [],
    observations: (post.observations || []).map(o => ({ provider: o.provider, measuredAt: o.measuredAt, ageDays: o.measuredAt ? daysBetween(o.measuredAt, now) : null, stale: o.measuredAt ? daysBetween(o.measuredAt, now) > STALE_DAYS : null, firstRetrievedAt: o.firstRetrievedAt, lastRetrievedAt: o.lastRetrievedAt, metrics: o.metrics, outlier: o.outlier ? { ...o.outlier, label: OUTLIER_LABEL[o.outlier.metric] || o.outlier.metric, rankable: !UNSTABLE.includes(o.outlier.metric) } : null, discoveryScore: o.discoveryScore ?? null })),
    builderInputs: builderInputs(cfg, post),
  };
}
