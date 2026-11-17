// Research store: posts found by research, their measurements over time, and the log of every search.
// Writes only cfg.researchDir/research.sqlite (lib/research-db.mjs). It never opens ideas.json for writing.
// Batch format and rules: dashboard/README.md, "Research store".
import { createHash } from 'node:crypto';
import { openDb, withDb, transaction, loadPost, loadAllPosts, loadSearches, findSearch, savePost, saveSearch, fingerprint, countSearches } from './research-db.mjs';

// lane -> [provider, platform]. Instagram comes from Signal Room (tracked creators) and from last30free's paid
// Apify search; TikTok from last30free only. X, Hacker News and Reddit are outside this workflow: no lane.
export const LANES = {
  instagram_short_form: ['signal-room', 'instagram'],
  youtube_short_form: ['signal-room', 'youtube'],
  youtube_long_form: ['signal-room', 'youtube'],
  youtube_discovery: ['last30free', 'youtube'],
  youtube_shorts_feed: ['last30free', 'youtube'],
  tiktok_hashtag: ['last30free', 'tiktok'],
  instagram_search: ['last30free', 'instagram'],
};
// Where a measurement time came from: the source said so, our collector stamped the fetch, a file's modification
// time (fallback), or a backfilled run's time. Only the first two are trusted for growth (see growth()).
const MEASURED_BASIS = ['source', 'collection', 'file-mtime', 'backfill-run-time'];
const PLATFORMS = {
  instagram: { id: /^\d{6,25}$/, hosts: ['instagram.com'], providers: ['signal-room', 'last30free'] },
  youtube: { id: /^[A-Za-z0-9_-]{11}$/, hosts: ['youtube.com', 'youtu.be'], providers: ['signal-room', 'last30free'] },
  tiktok: { id: /^\d{6,25}$/, hosts: ['tiktok.com'], providers: ['last30free'] },
};
const FORMATS = ['short', 'long', 'unknown'];
const METRICS = ['views', 'plays', 'reach', 'likes', 'comments', 'shares', 'saves', 'followers'];
const TRANSCRIPT_ORIGINS = ['signal-room', 'subtitles', 'whisper']; // spoken words only; a caption is never a transcript
const EXCERPT_KINDS = ['hook', 'snippet']; // text a search returned around its match: evidence, never a transcript
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const isIso = v => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v));
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const optStr = v => v == null || typeof v === 'string';
// Stable JSON with unknown (null) values left out, so the same facts always compare equal.
const canon = v => Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : isObj(v) ? `{${Object.keys(v).filter(k => v[k] != null).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',')}}`
  : JSON.stringify(v);

// YouTube ids are case-sensitive and Windows file names are not, so YouTube file names carry the id in hex.
export const postKey = (platform, id) => `${platform}-${platform === 'youtube' ? Buffer.from(id).toString('hex') : id}`;
const ref = p => `${p.platform}:${p.id}`;

// Returns a list of problems. Empty means the batch is safe to import.
export function validateBatch(b) {
  const errs = []; const bad = m => errs.push(m);
  if (!isObj(b)) return ['The batch must be a JSON object'];
  if (b.schema !== 1) bad('schema must be 1');
  if (typeof b.batchId !== 'string' || !SAFE_ID.test(b.batchId)) bad('batchId must be a short id of letters, digits, dot, dash or underscore');
  if (!isIso(b.retrievedAt)) bad('retrievedAt must be a UTC time such as 2026-11-17T09:00:00Z');
  if (!isObj(b.search) || typeof b.search.query !== 'string' || !b.search.query.trim()) bad('search.query is required');
  if (!Array.isArray(b.posts)) bad('posts must be a list');
  if (!Array.isArray(b.runs) || !b.runs.length) bad('runs must list at least one source run');
  if (errs.length) return errs;

  const seen = new Map(); // platform:id -> providers that reported it in this batch
  b.posts.forEach((p, i) => {
    const at = `posts[${i}]`;
    if (!isObj(p)) return bad(`${at} must be an object`);
    const plat = PLATFORMS[p.platform];
    if (!plat) return bad(`${at}.platform must be instagram, youtube or tiktok`);
    if (typeof p.id !== 'string' || !plat.id.test(p.id)) return bad(`${at}.id is not a ${p.platform} id`);
    const w = `${at} (${ref(p)})`;
    if (!plat.providers.includes(p.provider)) bad(`${w}: provider ${JSON.stringify(p.provider)} is not allowed for ${p.platform}`);
    const prov = seen.get(ref(p)) || []; if (prov.includes(p.provider)) bad(`${w}: listed twice for provider ${p.provider}`); seen.set(ref(p), [...prov, p.provider]);
    let host = null; try { const u = new URL(p.url); if (u.protocol === 'https:') host = u.hostname.replace(/^(www|m)\./, ''); } catch { /* reported below */ }
    if (!host || !plat.hosts.includes(host)) bad(`${w}: url must be an https ${p.platform} link`);
    if (!FORMATS.includes(p.format)) bad(`${w}: format must be short, long or unknown`);
    for (const k of ['title', 'caption']) if (!optStr(p[k])) bad(`${w}: ${k} must be text or null`);
    if (p.publishedAt != null && !isIso(p.publishedAt)) bad(`${w}: publishedAt must be a UTC time or null`);
    if (p.durationSeconds != null && !(Number.isFinite(p.durationSeconds) && p.durationSeconds > 0)) bad(`${w}: durationSeconds must be a positive number or null`);
    if (p.creator != null && !(isObj(p.creator) && optStr(p.creator.handle) && optStr(p.creator.name))) bad(`${w}: creator must be { handle, name }`);
    const t = p.transcript;
    if (t != null) {
      if (!isObj(t) || typeof t.text !== 'string' || !t.text.trim()) bad(`${w}: transcript.text is required when a transcript is given`);
      else if (typeof p.caption === 'string' && t.text.trim() === p.caption.trim()) bad(`${w}: the transcript is the caption. A caption is not a transcript; send transcript: null`);
      if (isObj(t) && !TRANSCRIPT_ORIGINS.includes(t.origin)) bad(`${w}: transcript.origin must be one of ${TRANSCRIPT_ORIGINS.join(', ')}`);
      if (isObj(t) && t.capturedAt != null && !isIso(t.capturedAt)) bad(`${w}: transcript.capturedAt must be a UTC time or null`);
    }
    if (p.excerpts != null && !(Array.isArray(p.excerpts) && p.excerpts.every(e => isObj(e) && EXCERPT_KINDS.includes(e.kind) && typeof e.text === 'string' && e.text.trim() && (e.complete == null || typeof e.complete === 'boolean')))) bad(`${w}: excerpts must be a list of { kind: hook or snippet, text, complete? }`);
    const o = p.observation;
    if (o != null) {
      if (!isObj(o)) return bad(`${w}: observation must be an object or null`);
      if (o.measuredAt != null && !isIso(o.measuredAt)) bad(`${w}: observation.measuredAt must be a UTC time, or null when the source gives none`);
      else if (o.measuredAt != null && Date.parse(o.measuredAt) > Date.parse(b.retrievedAt)) bad(`${w}: observation.measuredAt is later than the batch's retrievedAt`);
      if (o.metrics != null && !isObj(o.metrics)) bad(`${w}: observation.metrics must be an object`);
      for (const [k, v] of Object.entries(o.metrics || {})) {
        if (!METRICS.includes(k)) bad(`${w}: unknown metric ${JSON.stringify(k)}`);
        else if (v != null && !(Number.isFinite(v) && v >= 0)) bad(`${w}: metric ${k} must be a number, or null when unknown`);
      }
      if (o.outlier != null) {
        if (p.provider !== 'signal-room') bad(`${w}: outlier evidence comes from Signal Room only`);
        if (!isObj(o.outlier) || typeof o.outlier.metric !== 'string' || !Number.isFinite(o.outlier.value)) bad(`${w}: outlier must be { metric, value, percentile?, cohortSize? }`);
        else for (const k of ['percentile', 'cohortSize']) if (o.outlier[k] != null && !Number.isFinite(o.outlier[k])) bad(`${w}: outlier.${k} must be a number or null`);
      }
      if (o.discoveryScore != null) {
        if (p.provider !== 'last30free') bad(`${w}: discoveryScore comes from last30free only`);
        if (!Number.isFinite(o.discoveryScore)) bad(`${w}: discoveryScore must be a number`);
      }
      if (o.scoreFormula != null && (p.provider !== 'last30free' || typeof o.scoreFormula !== 'string' || !SAFE_ID.test(o.scoreFormula))) bad(`${w}: scoreFormula is a short id, from last30free only`);
      if (o.measuredBasis != null && !MEASURED_BASIS.includes(o.measuredBasis)) bad(`${w}: measuredBasis must be one of ${MEASURED_BASIS.join(', ')}`);
      if (o.measuredBasis != null && o.measuredAt == null) bad(`${w}: measuredBasis needs a measuredAt`);
    }
  });

  b.runs.forEach((r, i) => {
    const at = `runs[${i}]`;
    if (!isObj(r)) return bad(`${at} must be an object`);
    const lane = LANES[r.lane];
    if (!lane) return bad(`${at}.lane must be one of ${Object.keys(LANES).join(', ')}`);
    if (r.provider !== lane[0]) bad(`${at}: lane ${r.lane} belongs to ${lane[0]}`);
    if (!['ok', 'error'].includes(r.status)) bad(`${at}.status must be ok or error`);
    if (r.status === 'error' && (typeof r.error !== 'string' || !r.error.trim())) bad(`${at}: a failed run must carry its error text`);
    if (!optStr(r.note)) bad(`${at}.note must be text`);
    if (r.counts != null && !(isObj(r.counts) && Object.values(r.counts).every(v => Number.isInteger(v) && v >= 0))) bad(`${at}.counts must map names to whole numbers`);
    if (r.cost != null && !isObj(r.cost)) bad(`${at}.cost must be an object`);
    if (!Array.isArray(r.results)) return bad(`${at}.results must be a list of "platform:id", best match first`);
    if (r.fetchedOnly != null && !Array.isArray(r.fetchedOnly)) return bad(`${at}.fetchedOnly must be a list of "platform:id"`);
    if (r.status === 'error' && (r.results.length || (r.fetchedOnly || []).length)) bad(`${at}: a failed run cannot list results`);
    // results: what the search reported, best first. fetchedOnly: what it also returned and we kept (older than the
    // window, undated, or past the report limit). Both must have a post entry from this run's provider.
    for (const x of [...r.results, ...(r.fetchedOnly || [])]) {
      if (typeof x !== 'string' || !x.startsWith(lane[1] + ':')) bad(`${at}: result ${JSON.stringify(x)} is not a ${lane[1]} post`);
      else if (!(seen.get(x) || []).includes(lane[0])) bad(`${at}: result ${x} has no matching ${lane[0]} entry in posts`);
    }
  });
  const listed = new Set(b.runs.flatMap(r => [...(Array.isArray(r.results) ? r.results : []), ...(Array.isArray(r.fetchedOnly) ? r.fetchedOnly : [])].map(x => `${x}|${r.provider}`)));
  for (const p of b.posts) if (isObj(p) && !listed.has(`${ref(p)}|${p.provider}`)) bad(`${ref(p)} (${p.provider}) is not listed in any run's results`);
  return errs;
}

// What was measured, with unknown values left out. Null when the entry carries no evidence at all.
function observationOf(p) {
  const o = p.observation; if (!o) return null;
  const metrics = Object.fromEntries(Object.entries(o.metrics || {}).filter(([, v]) => v != null));
  if (!Object.keys(metrics).length && o.outlier == null && o.discoveryScore == null) return null;
  const out = { provider: p.provider, measuredAt: o.measuredAt ?? null, metrics };
  if (o.outlier != null) out.outlier = Object.fromEntries(Object.entries(o.outlier).filter(([, v]) => v != null)); // creator-relative evidence
  if (o.discoveryScore != null) out.discoveryScore = o.discoveryScore; // engagement at fetch; never mixed with outlier
  if (o.scoreFormula != null) out.scoreFormula = o.scoreFormula;
  if (o.measuredBasis != null) out.measuredBasis = o.measuredBasis;
  return out;
}
// The evidence that makes two measurements the same one (the same fields as the stored fingerprint).
const values = o => canon({ metrics: o.metrics, outlier: o.outlier, discoveryScore: o.discoveryScore, scoreFormula: o.scoreFormula });
const min = (a, b) => (a < b ? a : b), max = (a, b) => (a > b ? a : b);

function mergePost(old, p, batch) {
  const at = batch.retrievedAt;
  const post = old ? structuredClone(old) : { id: postKey(p.platform, p.id), platform: p.platform, nativeId: p.id, url: null, format: 'unknown', creator: {}, title: null, caption: null, publishedAt: null, durationSeconds: null, transcript: null, firstRetrievedAt: at, lastRetrievedAt: at, provenance: [], observations: [] };
  // A newer retrieval may correct a field; an older or empty one only fills gaps. Nothing is ever blanked.
  const newer = !old || at >= old.lastRetrievedAt;
  const take = (target, k, v) => { if (v != null && v !== '' && (target[k] == null || newer)) target[k] = v; };
  for (const k of ['url', 'title', 'caption', 'publishedAt', 'durationSeconds']) take(post, k, p[k]);
  if (p.format !== 'unknown') take(post, 'format', p.format);
  for (const k of ['handle', 'name']) take(post.creator, k, (p.creator || {})[k]);
  if (p.transcript && (!post.transcript || newer)) post.transcript = { text: p.transcript.text, origin: p.transcript.origin, capturedAt: p.transcript.capturedAt ?? null, provider: p.provider };
  post.firstRetrievedAt = min(post.firstRetrievedAt, at); post.lastRetrievedAt = max(post.lastRetrievedAt, at);

  let pv = post.provenance.find(x => x.provider === p.provider);
  if (!pv) post.provenance.push(pv = { provider: p.provider, firstRetrievedAt: at, lastRetrievedAt: at, batches: [] });
  pv.firstRetrievedAt = min(pv.firstRetrievedAt, at); pv.lastRetrievedAt = max(pv.lastRetrievedAt, at);
  if (!pv.batches.includes(batch.batchId)) pv.batches.push(batch.batchId);

  // Excerpts are kept exactly as the search returned them, with the source and the batch that brought them.
  for (const e of p.excerpts || []) {
    post.excerpts ||= [];
    if (!post.excerpts.some(x => x.provider === p.provider && x.kind === e.kind && x.text === e.text)) post.excerpts.push({ provider: p.provider, batchId: batch.batchId, kind: e.kind, text: e.text, ...(e.complete === false ? { complete: false } : {}) }); // complete: false = only part of what the search returned was copied
  }

  const o = observationOf(p);
  if (o) {
    // One measurement = one source, one measured time (known or unknown), one set of values. Equal counts at two
    // known times stay two measurements, and an undated one is never merged into a dated one: matching counts do
    // not prove it was the same measurement. Only an exact repeat adds nothing.
    const hit = post.observations.find(x => x.provider === o.provider && x.measuredAt === o.measuredAt && values(x) === values(o));
    if (hit) { hit.firstRetrievedAt = min(hit.firstRetrievedAt, at); hit.lastRetrievedAt = max(hit.lastRetrievedAt, at); }
    else post.observations.push({ ...o, firstRetrievedAt: at, lastRetrievedAt: at });
    const when = x => x.measuredAt || x.firstRetrievedAt;
    post.observations.sort((a, b) => (when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : 0));
  }
  return post;
}

// Storage is SQLite (lib/research-db.mjs). These return the same objects the JSON store held.
export function readSearches(cfg) { return withDb(cfg, {}, loadSearches); }
export function readPosts(cfg) { return withDb(cfg, {}, loadAllPosts); }
export function readPost(cfg, key) { return withDb(cfg, {}, db => loadPost(db, key)); }
export const searchCount = countSearches;

// Validates everything, works out every change in memory, and only then writes, in one transaction. Posts the
// batch does not mention are never touched. A failed run or an omitted post therefore leaves earlier discoveries
// as they were. A dry run opens the database read-only and never creates it.
export function importBatch(cfg, batch, { dryRun = false } = {}) {
  const errors = validateBatch(batch);
  if (errors.length) { const e = new Error(`Batch rejected (${errors.length} problem${errors.length === 1 ? '' : 's'}). Nothing was changed.`); e.errors = errors; throw e; }
  const sha256 = createHash('sha256').update(canon(batch)).digest('hex');
  const failedRuns = batch.runs.filter(r => r.status === 'error').map(r => ({ lane: r.lane, error: r.error }));
  const db = openDb(cfg, { write: !dryRun });
  try {
    const work = () => {
      const earlier = findSearch(db, batch.batchId);
      if (earlier && earlier.sha256 !== sha256) throw new Error(`Batch id ${batch.batchId} was already imported with different contents. Nothing was changed. Give the new batch its own id.`);
      if (earlier) return { batchId: batch.batchId, alreadyImported: true, dryRun, created: 0, updated: 0, unchanged: 0, observationsAdded: 0, failedRuns };

      const next = new Map(), before = new Map(), sighted = new Map();
      for (const p of batch.posts) {
        const key = postKey(p.platform, p.id);
        if (!next.has(key)) { const old = loadPost(db, key); before.set(key, old); next.set(key, old); sighted.set(key, []); }
        next.set(key, mergePost(next.get(key), p, batch));
        const o = observationOf(p); if (o) sighted.get(key).push(fingerprint(o));
      }
      const sum = { batchId: batch.batchId, alreadyImported: false, dryRun, created: 0, updated: 0, unchanged: 0, observationsAdded: 0, failedRuns };
      for (const [key, post] of next) {
        const old = before.get(key);
        sum.observationsAdded += post.observations.length - (old ? old.observations.length : 0);
        if (!old) sum.created++; else if (JSON.stringify(old) === JSON.stringify(post)) sum.unchanged++; else sum.updated++;
      }
      if (dryRun) return sum;
      for (const [key, post] of next) savePost(db, post, batch.batchId, sighted.get(key));
      saveSearch(db, { batchId: batch.batchId, sha256, retrievedAt: batch.retrievedAt, importedAt: new Date().toISOString(), search: batch.search, runs: batch.runs, posts: next.size }, postKey);
      return sum;
    };
    return dryRun ? work() : transaction(db, work);
  } finally { if (db) db.close(); }
}

// Measurement times we do not trust for a trend: a file's modification time, or a backfilled run time.
const UNTIMED = new Set(['file-mtime', 'backfill-run-time']);
// Growth of one metric since the previous measurement, from one source's own dated measurements only: the latest
// measurement against the latest one before it with an earlier time. Null when there are not two such times:
// undated measurements and other sources' numbers are never used to invent a trend.
export function growth(post, provider, metric) {
  const obs = (post.observations || []).filter(o => o.provider === provider && o.measuredAt && !UNTIMED.has(o.measuredBasis) && typeof o.metrics[metric] === 'number')
    .sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt));
  const b = obs[obs.length - 1]; const a = b && obs.filter(o => Date.parse(o.measuredAt) < Date.parse(b.measuredAt)).pop();
  if (!a) return null;
  const days = (Date.parse(b.measuredAt) - Date.parse(a.measuredAt)) / 86400e3;
  return { provider, metric, from: { at: a.measuredAt, value: a.metrics[metric] }, to: { at: b.measuredAt, value: b.metrics[metric] }, delta: b.metrics[metric] - a.metrics[metric], days, perDay: (b.metrics[metric] - a.metrics[metric]) / days };
}

// ---- keyword matching on retrieved text ----
// Bare words are whole words ("AI" is not in "said", "MCP" is not "MCP50") and must all appear; a bare word
// also accepts one plural s ("MCP" finds "MCPs"). "Quoted words" are exact: together, in order, no plural added.
// Case is ignored.
export function parseQuery(q) {
  const terms = []; const re = /"([^"]*)"|(\S+)/g; let m;
  while ((m = re.exec(String(q || '')))) { const text = (m[1] ?? m[2]).replace(/"/g, '').trim().replace(/\s+/g, ' '); if (text) terms.push({ text, phrase: m[1] != null }); }
  return terms;
}
const termRe = t => new RegExp(`(?<![\\p{L}\\p{N}])${t.text.split(' ').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s-]+')}${t.phrase ? '' : 's?'}(?![\\p{L}\\p{N}])`, 'iu');
export function matchText(text, query) { const terms = parseQuery(query); return terms.length > 0 && terms.every(t => termRe(t).test(String(text || ''))); }
// Which parts of a post matched. Transcript, excerpt, title and caption are reported separately, so a caption or
// excerpt hit is never shown as a full transcript.
export function matchPost(post, query) {
  const fields = { transcript: post.transcript ? post.transcript.text : '', excerpt: (post.excerpts || []).map(e => e.text).join('\n'), title: post.title || '', caption: post.caption || '' };
  const terms = parseQuery(query).map(t => ({ ...t, re: termRe(t) }));
  const hit = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, terms.filter(t => t.re.test(v)).map(t => t.text)]));
  return { matched: terms.length > 0 && terms.every(t => Object.values(hit).some(a => a.includes(t.text))), fields: Object.fromEntries(Object.entries(hit).filter(([, a]) => a.length)) };
}
// The text split into matching and non-matching pieces, for showing exactly what matched. Nothing is rewritten.
export function highlight(text, query) {
  const src = String(text || ''); const terms = parseQuery(query); if (!terms.length || !src) return [{ t: src, m: false }];
  const re = new RegExp(terms.map(t => termRe(t).source).join('|'), 'giu'); const out = []; let at = 0, m;
  while ((m = re.exec(src))) { if (!m[0]) { re.lastIndex++; continue; } if (m.index > at) out.push({ t: src.slice(at, m.index), m: false }); out.push({ t: m[0], m: true }); at = m.index + m[0].length; }
  if (at < src.length) out.push({ t: src.slice(at), m: false });
  return out;
}
