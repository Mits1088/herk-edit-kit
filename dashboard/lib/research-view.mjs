// Read-only view of the research store for the Research page. It never writes.
// The page (docs/plans/research-database/PLAN.md, "What the page does"): short-form first, one table per format
// across platforms, the top 50 after filtering and sorting (more on request), metrics up front.
// Rules it applies: the publication-date window is enforced here, on stored dates; an unknown date is never
// "recent"; every metric in a row comes from one measurement (never mixed); a missing input makes a metric
// unavailable, never 0; the original score is compared within one platform only; creator outliers and raw
// engagement are separate; an unstable outlier signal is shown but never ranked; growth comes only from two dated
// measurements by one source.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPosts, readSearches, growth, matchPost, highlight } from './research.mjs';

const GROUPS = [['instagram:short', 'Instagram'], ['youtube:short', 'YouTube Shorts'], ['youtube:long', 'YouTube long-form'], ['youtube:unknown', 'YouTube, format unknown'], ['tiktok:short', 'TikTok']];
export const LANE_LABEL = { instagram_short_form: 'Instagram', youtube_short_form: 'YouTube Shorts', youtube_long_form: 'YouTube long-form', youtube_discovery: 'YouTube discovery', youtube_shorts_feed: 'YouTube Shorts feed', tiktok_hashtag: 'TikTok hashtag', instagram_search: 'Instagram search' };
export const PROVIDER_LABEL = { 'signal-room': 'Signal Room', last30free: 'last30free' };
const OUTLIER_LABEL = { reach_per_follower: 'reach per follower', age_adjusted_channel_outlier: 'age-adjusted channel outlier', bounded_velocity_signal: 'bounded velocity signal' };
// Changes between two calls for the same video (21.44 and 25.77 seen on 2026-11-16), so it cannot order results.
const UNSTABLE = ['bounded_velocity_signal'];
const PRIMARY = { instagram: ['plays', 'views'], youtube: ['views'], tiktok: ['views'] };
const STALE_DAYS = 7; // only decides when a measurement is labelled "stale" on the page
const WINDOWS = ['7', '30', '90', '365', 'all'];
// speed = average views per day. score compares only within one platform, so it needs a platform filter.
const SORTS = ['speed', 'views', 'published', 'engagement', 'shares', 'growth', 'score', 'outlier'];
const PAGE = 50;
// The most rows one page view holds; past it the page asks for narrower filters instead of offering more.
// The CSV export is not limited. Settable as cfg.researchListMax (tests).
const LIST_MAX = 2000;
// Ages are calendar days in the dashboard's timezone (Europe/London unless DASH_TZ says otherwise), so a post from
// the evening of the 14th is "2 days ago" on the 16th, whatever the hour.
let TZ = 'Europe/London';
const dayNumber = d => { const [y, m, dd] = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).split('-').map(Number); return Date.UTC(y, m - 1, dd) / 86400e3; };
const daysBetween = (iso, now) => Math.max(0, dayNumber(now) - dayNumber(new Date(iso)));
const ref = p => `${p.platform}:${p.nativeId}`;
const words = t => (t.trim() ? t.trim().split(/\s+/).length : 0);

// Every run that returned this post: which search, which source, and where it ranked among that run's top matches.
// A post the run fetched and kept without reporting it (older, undated, past the limit) is listed with kept: true.
function runsOf(post, searches) {
  const out = [];
  for (const s of searches) for (const r of s.runs || []) {
    const base = { batchId: s.batchId, query: s.search.query, retrievedAt: s.retrievedAt, lane: r.lane, laneLabel: LANE_LABEL[r.lane] || r.lane, provider: r.provider, note: r.note || null };
    const i = (r.results || []).indexOf(ref(post));
    if (i >= 0) out.push({ ...base, rank: i + 1, of: r.results.length, kept: false });
    else if ((r.fetchedOnly || []).includes(ref(post))) out.push({ ...base, rank: null, of: r.results.length, kept: true });
  }
  return out;
}
const memberOf = r => [...(r.results || []), ...(r.fetchedOnly || [])];

// The metrics row: every number from ONE measurement (the newest dated one with any count, else the newest undated
// one), so counts from different measurements are never mixed. A measurement without a view count still shows the
// counts it has; views and everything worked out from views stay unavailable.
function metricsOf(post) {
  const primary = o => PRIMARY[post.platform].find(k => typeof o.metrics[k] === 'number') || null;
  const counted = (post.observations || []).filter(o => Object.values(o.metrics || {}).some(v => typeof v === 'number'));
  const dated = counted.filter(o => o.measuredAt).sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt));
  const o = dated[0] || counted.filter(x => !x.measuredAt).sort((a, b) => (a.lastRetrievedAt < b.lastRetrievedAt ? 1 : -1))[0];
  if (!o) return null;
  const m = o.metrics; const num = v => (typeof v === 'number' ? v : null);
  const views = primary(o) ? m[primary(o)] : null, likes = num(m.likes), comments = num(m.comments), shares = num(m.shares);
  // Average views per day up to that measurement: the post's age when it was measured. Under a day counts as one.
  const ageAtMeasure = o.measuredAt && post.publishedAt ? (Date.parse(o.measuredAt) - Date.parse(post.publishedAt)) / 86400e3 : null;
  return {
    provider: o.provider, viewMetric: primary(o), views, likes, comments, shares, saves: num(m.saves),
    avgViewsPerDay: views != null && ageAtMeasure != null && ageAtMeasure >= 0 ? views / Math.max(1, ageAtMeasure) : null,
    engagementRate: views > 0 && likes != null && comments != null ? (likes + comments) / views : null,
    shareRate: views > 0 && shares != null ? shares / views : null,
    measuredAt: o.measuredAt, measuredBasis: o.measuredBasis || null, retrievedAt: o.lastRetrievedAt,
  };
}
// The original last30free score from the newest last30free measurement, with its formula (comparable within a platform).
function scoreOf(post) {
  const o = (post.observations || []).filter(x => x.discoveryScore != null).sort((a, b) => ((a.measuredAt || a.lastRetrievedAt) < (b.measuredAt || b.lastRetrievedAt) ? 1 : -1))[0];
  return o ? { value: o.discoveryScore, formula: o.scoreFormula || null, platform: post.platform, measuredAt: o.measuredAt } : null;
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
    engagement, outlier, growth: grow, runs: runsOf(post, searches), metrics: metricsOf(post), score: scoreOf(post),
  };
}

function cleanFilters(f = {}, max = LIST_MAX) {
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const limit = Math.min(max, Math.max(PAGE, Math.ceil((Number(f.limit) || PAGE) / PAGE) * PAGE));
  return { search: String(f.search || '').trim(), q: String(f.q || '').trim().slice(0, 200), platform: pick(f.platform, ['instagram', 'youtube', 'tiktok'], ''), format: pick(f.format, ['short', 'long', 'unknown'], 'short'), window: pick(f.window, WINDOWS, '30'), sort: pick(f.sort, SORTS, 'speed'), limit };
}

export function researchList(cfg, filters, now = new Date(), { unlimited = false } = {}) {
  const max = cfg.researchListMax || LIST_MAX;
  TZ = cfg.dueTimeZone || TZ; const f = cleanFilters(filters, max); const posts = readPosts(cfg);
  const searches = readSearches(cfg).sort((a, b) => (a.retrievedAt < b.retrievedAt ? 1 : -1));
  const queries = [...new Set(searches.map(s => s.search.query))];
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  // A saved search's posts: what it reported and what it fetched and kept.
  const inSearch = f.search ? new Set(searches.filter(s => same(s.search.query, f.search)).flatMap(s => (s.runs || []).flatMap(memberOf))) : null;
  // The text filter is checked on the saved text. With only a saved search chosen, its query is used to show what matched.
  const matchQuery = f.q || f.search;
  const windowDays = f.window === 'all' ? null : Number(f.window);
  const rows = []; const formats = { short: 0, long: 0, unknown: 0 };
  for (const post of posts) {
    if (inSearch && !inSearch.has(ref(post))) continue;
    if (f.platform && post.platform !== f.platform) continue;
    const match = matchQuery ? matchPost(post, matchQuery) : null;
    if (f.q && !match.matched) continue;
    formats[post.format] = (formats[post.format] || 0) + 1; // so each format tab can say how many it holds
    if (post.format !== f.format) continue;
    const row = summarise(post, searches, now);
    row.match = match ? { query: matchQuery, matched: match.matched, fields: Object.keys(match.fields) } : null;
    // An unknown publication date is never counted as recent.
    row.bucket = !post.publishedAt ? 'undated' : windowDays === null || row.publishedAgeDays <= windowDays ? 'recent' : 'historical';
    rows.push(row);
  }
  // Score is compared within one platform only: without a platform filter it cannot order a mixed list.
  const scoreNeedsPlatform = f.sort === 'score' && !f.platform;
  const sortBy = scoreNeedsPlatform ? 'speed' : f.sort;
  const last = v => (v == null || Number.isNaN(v) ? -Infinity : v);
  const key = {
    speed: r => r.metrics && r.metrics.avgViewsPerDay, views: r => r.metrics && r.metrics.views,
    published: r => r.publishedAt && Date.parse(r.publishedAt), engagement: r => r.metrics && r.metrics.engagementRate,
    shares: r => r.metrics && r.metrics.shareRate, growth: r => r.growth && r.growth.perDay,
    score: r => r.score && r.score.value, outlier: r => (r.outlier && r.outlier.rankable ? r.outlier.value : null),
  }[sortBy];
  const order = (a, b) => last(key(b)) - last(key(a)) || last(b.publishedAt && Date.parse(b.publishedAt)) - last(a.publishedAt && Date.parse(a.publishedAt));
  const recent = rows.filter(r => r.bucket === 'recent').sort(order);
  // Failed and partial source runs in the latest search for each topic shown, so a gap is never mistaken for "nothing found".
  const failures = [], partials = [];
  for (const q of queries) {
    if (f.search && !same(q, f.search)) continue;
    const s = searches.find(x => x.search.query === q);
    for (const r of s.runs || []) {
      const at = { query: q, batchId: s.batchId, retrievedAt: s.retrievedAt, lane: r.lane, laneLabel: LANE_LABEL[r.lane] || r.lane, provider: r.provider };
      if (r.status === 'error') failures.push({ ...at, error: r.error });
      else if (r.partial) partials.push({ ...at, reason: r.partial });
    }
  }
  return {
    generatedAt: now.toISOString(), filters: f, sortedBy: sortBy, scoreNeedsPlatform, queries, formats,
    rows: unlimited ? recent : recent.slice(0, f.limit),
    // more: how many further rows "Show more" can still bring in; capped: matches beyond what one view holds.
    more: unlimited ? 0 : Math.max(0, Math.min(recent.length, max) - f.limit), capped: unlimited ? 0 : Math.max(0, recent.length - max),
    // Posts with no publication date are never in a date window: listed only when the window is "any date".
    undatedRows: f.window === 'all' ? rows.filter(r => r.bucket === 'undated').sort(order) : [],
    failures, partials,
    totals: { posts: posts.length, searches: searches.length, lastRetrievedAt: searches[0] ? searches[0].retrievedAt : null, shown: rows.length, recent: recent.length, historical: rows.filter(r => r.bucket === 'historical').length, undated: rows.filter(r => r.bucket === 'undated').length },
    staleDays: STALE_DAYS, pageSize: PAGE,
  };
}

// The current table as CSV (every matching row, not only the top 50), in the page's order and with its columns.
// UTF-8 with a byte-order mark so Excel reads it correctly. Text that a spreadsheet would run as a formula is
// prefixed with an apostrophe.
export function researchCsv(cfg, filters, now = new Date()) {
  const l = researchList(cfg, filters, now, { unlimited: true });
  const rows = [...l.rows, ...l.undatedRows];
  const text = v => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; };
  const cell = v => { const s = typeof v === 'number' ? String(v) : text(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const r4 = v => (v == null ? '' : Math.round(v * 10000) / 10000);
  const head = ['Platform', 'Format', 'Title', 'Creator', 'Link', 'Published (UTC)', 'Views', 'Avg views/day', 'Likes', 'Comments', 'Shares', 'Saves',
    'Engagement rate', 'Share rate', 'Score', 'Score formula', 'Score measured (UTC)', 'Growth', 'Growth from (UTC)', 'Growth to (UTC)', 'Last checked (UTC)',
    'Measurement time basis', 'Sources', 'Topics'];
  const lines = rows.map(r => { const m = r.metrics || {}; const g = r.growth;
    return [r.platform, r.format, r.title, r.creator.handle ? '@' + String(r.creator.handle).replace(/^@/, '') : r.creator.name, r.url, r.publishedAt,
      m.views, r4(m.avgViewsPerDay), m.likes, m.comments, m.shares, m.saves, r4(m.engagementRate), r4(m.shareRate),
      r.score && r.score.value, r.score && r.score.formula, r.score && r.score.measuredAt,
      g && g.delta != null ? `${g.delta} ${g.metric}` : '', g && g.from.at, g && g.to.at, m.measuredAt, m.measuredBasis,
      r.providers.join(' + '), [...new Set(r.runs.map(x => x.query))].join(' | ')].map(cell).join(','); });
  return '\uFEFF' + [head.map(cell).join(','), ...lines].join('\r\n') + '\r\n';
}

export function researchSearches(cfg) {
  return readSearches(cfg).sort((a, b) => (a.retrievedAt < b.retrievedAt ? 1 : -1)).map(s => ({
    batchId: s.batchId, query: s.search.query, windowDays: s.search.windowDays ?? null, retrievedAt: s.retrievedAt, importedAt: s.importedAt || null, posts: s.posts,
    runs: (s.runs || []).map(r => ({ lane: r.lane, laneLabel: LANE_LABEL[r.lane] || r.lane, provider: r.provider, status: r.status, error: r.error || null, note: r.note || null, results: (r.results || []).length,
      kept: (r.fetchedOnly || []).length, partial: r.partial || null, counts: r.counts || null, cost: r.cost || null })),
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
      // Every kept last30free file for this platform (the builder names them after the draft keys). "fetched" holds
      // every returned record with the provider's original row; older files only have the reported "merged" list.
      const files = { tiktok: ['tiktok.json'], instagram: ['instagram.json'], youtube: ['youtube.json', 'youtubeShorts.json'] }[post.platform] || [];
      for (const name of files) {
        const file = read(name); if (!file) continue;
        const find = list => (list || []).find(x => String(x.source_id) === post.nativeId);
        const it = find(file.fetched && file.fetched.items) || find(file.merged && file.merged.items);
        if (it) entry.records.push({ what: `Item, as written by last30free (${name})`, data: it });
      }
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
