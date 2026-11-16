#!/usr/bin/env node
// Turns one research draft (raw Signal Room results plus last30free output files) into an importer batch.
// The mapping lives here so times and metrics are converted by code, not retyped by hand.
// Run: node .claude/skills/research-signals/build-batch.mjs <draft.json> [--check-fallback] [--out <batch.json>]
import { readFileSync, writeFileSync, mkdirSync, statSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { loadConfig } from '../../../dashboard/lib/config.mjs';
import { matchText, validateBatch } from '../../../dashboard/lib/research.mjs';

const SR = { instagram_short_form: ['instagram', 'short'], youtube_short_form: ['youtube', 'short'], youtube_long_form: ['youtube', 'long'] };
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pick = (o, map) => Object.fromEntries(Object.entries(map).map(([k, from]) => [k, num((o || {})[from])]).filter(([, v]) => v != null));

// Signal Room times are Unix milliseconds (13 digits). Anything else is refused, never guessed at.
export function iso(ms) {
  if (ms == null) return null;
  if (!Number.isInteger(ms) || ms < 1e12 || ms >= 1e13) throw new Error(`Expected a Unix time in milliseconds, got ${JSON.stringify(ms)}`);
  return new Date(ms).toISOString();
}
const spoken = m => [m.title, m.hook, m.relevantSnippet].filter(Boolean).join('\n');

// The agreed rule: run last30free YouTube discovery when Signal Room returns fewer than five relevant YouTube
// matches, or when its measurements are stale or undated. Signal Room gives no measurement time for YouTube
// (a recent publication date is not one), so any YouTube result it returns is undated.
export function youtubeFallback(draft) {
  const sr = draft.signalRoom || {}; const lanes = (sr.lanes || Object.keys(SR)).filter(l => l.startsWith('youtube'));
  if (!lanes.length) return [];
  const yt = (sr.matches || []).filter(m => lanes.includes(m.source));
  const relevant = yt.filter(m => matchText(spoken(m), draft.query)).length;
  const reasons = [];
  if ((sr.errors || []).some(e => lanes.includes(e.lane))) reasons.push('a Signal Room YouTube search failed');
  if (relevant < 5) reasons.push(`${relevant} relevant Signal Room YouTube matches (fewer than 5)`);
  if (yt.length) reasons.push('Signal Room YouTube measurements carry no measurement time');
  return reasons;
}

function fromSignalRoom(m, sr) {
  const [platform, format] = SR[m.source]; const id = String(m.externalId);
  const tr = (sr.transcripts || []).find(t => t.platform === platform && String(t.id) === id && typeof t.text === 'string' && t.text.trim());
  const post = { platform, id, provider: 'signal-room', url: m.url, format, title: m.title ?? null, publishedAt: iso(m.publishedAt), durationSeconds: num(m.durationSeconds) > 0 ? m.durationSeconds : null };
  // What the search returned around its match, word for word. Kept as evidence; never stored as a transcript.
  const excerpts = [['hook', m.hook], ['snippet', m.relevantSnippet]].filter(([, t]) => typeof t === 'string' && t.trim()).map(([kind, text]) => ({ kind, text, ...(sr.excerptsShortened ? { complete: false } : {}) }));
  if (excerpts.length) post.excerpts = excerpts;
  if (platform === 'instagram') {
    const det = (sr.instagramDetails || []).find(d => String(d.externalId) === id);
    post.creator = { handle: m.creator ?? null }; post.caption = det ? det.caption ?? null : null;
    post.transcript = tr ? { text: tr.text, origin: 'signal-room', capturedAt: det && det.transcript ? iso(det.transcript.capturedAt) : null } : null;
    // With the item detail we know when the counts were measured. Without it the time stays unknown.
    const last = det && (det.observations || []).slice().sort((a, b) => b.observedAt - a.observedAt)[0];
    const outlier = num((m.metrics || {}).reachPerFollower) != null ? { metric: 'reach_per_follower', value: m.metrics.reachPerFollower } : null;
    post.observation = last
      ? { measuredAt: iso(last.observedAt), metrics: pick(last, { plays: 'playsCount', views: 'viewsCount', likes: 'likesCount', comments: 'commentsCount', shares: 'sharesCount', followers: 'followersCount' }), outlier }
      : { measuredAt: null, metrics: pick(m.metrics, { plays: 'plays', views: 'views', reach: 'reach', likes: 'likes', comments: 'comments', shares: 'shares' }), outlier };
  } else {
    const det = (sr.videoDetails || []).find(d => String(d.externalId || d.id) === id);
    post.creator = { name: m.channel ?? null, handle: det ? det.channelHandle ?? null : null };
    post.caption = det && det.descriptionAvailable ? det.description ?? null : null;
    post.transcript = tr ? { text: tr.text, origin: 'signal-room', capturedAt: null } : null;
    post.observation = { measuredAt: null, metrics: pick(m.metrics, { views: 'views', likes: 'likes', comments: 'comments', followers: 'subscribers' }),
      outlier: num(m.performanceValue) != null && m.performanceMetric ? { metric: m.performanceMetric, value: m.performanceValue } : null };
  }
  return post;
}

// last30free fetches counts live, so the fetch time (the output file's time) is the measurement time.
// Its adapters write 0 when a count is missing, so 0 views, likes or followers are treated as unknown.
function fromLast30(it, platform, fetchedAt, subs) {
  const raw = it.raw || {}; const pos = v => (num(v) > 0 ? v : null);
  const post = { platform, id: String(it.source_id), provider: 'last30free', url: it.url, title: it.title || null, publishedAt: it.created_at || null, transcript: null };
  const m = it.metrics || {};
  if (platform === 'tiktok') {
    Object.assign(post, { format: 'short', creator: { handle: it.author || null, name: raw.full_name || null }, caption: it.text || null, durationSeconds: pos(raw.video_duration_secs) });
    post.observation = { measuredAt: fetchedAt, metrics: { views: pos(m.views), likes: pos(m.likes), comments: num(m.comments), shares: num(m.reposts), followers: pos(raw.followers) }, discoveryScore: num(it.score) };
  } else {
    const dur = pos(raw.duration); const text = String(it.text || '');
    // A Short cannot run past three minutes; below that, only a /shorts/ link proves the format.
    const format = /\/shorts\//.test(it.url) ? 'short' : dur > 180 ? 'long' : 'unknown';
    const caption = it.title && text.startsWith(it.title) ? text.slice(it.title.length).trim() : text.trim();
    Object.assign(post, { format, creator: { name: it.author || raw.channel || null, handle: raw.uploader_id || null }, caption: caption || null, durationSeconds: dur });
    const sub = subs && subs.transcripts ? subs.transcripts[post.id] : null;
    if (sub && sub.trim()) post.transcript = { text: sub, origin: 'subtitles', capturedAt: subs.fetchedAt || null };
    post.observation = { measuredAt: fetchedAt, metrics: { views: pos(m.views), likes: pos(m.likes) }, discoveryScore: num(it.score) };
  }
  return post;
}
const textOf = p => [p.title, p.caption, p.transcript && p.transcript.text].filter(Boolean).join('\n');

export function buildBatch(draft, io = { readJson: f => JSON.parse(readFileSync(f, 'utf8')), mtime: f => statSync(f).mtime }) {
  for (const k of ['batchId', 'query', 'retrievedAt']) if (!draft[k]) throw new Error(`The draft needs ${k}`);
  const sr = draft.signalRoom || {}; const l30 = draft.last30free || {};
  const posts = [], runs = []; const refOf = p => `${p.platform}:${p.id}`;
  const relevance = list => `${list.filter(p => matchText(textOf(p), draft.query)).length} of ${list.length} match "${draft.query}" in the retrieved text`;

  for (const lane of sr.lanes || Object.keys(SR)) {
    if (!SR[lane]) throw new Error(`Unknown Signal Room lane ${lane}`);
    const failed = (sr.errors || []).find(e => e.lane === lane);
    if (failed) { runs.push({ provider: 'signal-room', lane, status: 'error', error: String(failed.error), results: [] }); continue; }
    const found = (sr.matches || []).filter(m => m.source === lane).sort((a, b) => (b.balancedScore || 0) - (a.balancedScore || 0));
    const list = found.map(m => fromSignalRoom(m, sr));
    // Relevance is judged on the excerpt Signal Room returned when no full transcript was fetched.
    const rel = found.filter((m, i) => matchText(spoken(m) + '\n' + textOf(list[i]), draft.query)).length;
    posts.push(...list);
    runs.push({ provider: 'signal-room', lane, status: 'ok', note: `top matches from this search, ordered by Signal Room's balanced score; ${rel} of ${list.length} match "${draft.query}" in the retrieved text`, results: list.map(refOf) });
  }

  const reasons = youtubeFallback(draft);
  if (reasons.length && !l30.youtube) throw new Error(`The YouTube fallback is required (${reasons.join('; ')}) but the draft has no last30free.youtube. Run it, or record its error.`);
  const subs = l30.subtitles && l30.subtitles.file ? io.readJson(l30.subtitles.file) : null;
  for (const [key, lane, platform] of [['youtube', 'youtube_discovery', 'youtube'], ['tiktok', 'tiktok_hashtag', 'tiktok']]) {
    const src = l30[key]; if (!src) continue;
    const why = key === 'youtube' ? `fallback because ${reasons.join('; ') || 'requested'}; ` : '';
    let error = src.error || null, list = [], tag = '';
    if (!error) {
      const out = io.readJson(src.file); const res = (out.results || {})[key] || {};
      if (res.status !== 'ok') error = res.error || `last30free reported status ${res.status}`;
      else {
        const fetchedAt = io.mtime(src.file).toISOString();
        list = (out.merged.items || []).filter(it => it.source === key).map(it => fromLast30(it, platform, fetchedAt, subs));
        tag = ((out.merged.items || []).find(it => it.source === key && it.raw && it.raw.hashtag) || { raw: {} }).raw.hashtag || '';
      }
    }
    if (error) { runs.push({ provider: 'last30free', lane, status: 'error', error: String(error), note: why.trim() || undefined, results: [] }); continue; }
    posts.push(...list);
    const limits = key === 'tiktok' ? `hashtag search #${tag} only, no transcripts; ` : `yt-dlp search, top matches only; ${list.filter(p => p.transcript).length} of ${list.length} with subtitles; `;
    runs.push({ provider: 'last30free', lane, status: 'ok', note: why + limits + relevance(list), results: list.map(refOf) });
  }
  return { schema: 1, batchId: draft.batchId, retrievedAt: draft.retrievedAt, search: { query: draft.query, windowDays: draft.windowDays ?? null }, runs, posts };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const args = process.argv.slice(2); const outAt = args.indexOf('--out');
  const file = args.find((a, i) => !a.startsWith('--') && !(outAt >= 0 && i === outAt + 1));
  if (!file) { console.error('Usage: node build-batch.mjs <draft.json> [--check-fallback] [--out <batch.json>]'); process.exit(2); }
  try {
    const draft = JSON.parse(readFileSync(file, 'utf8'));
    if (args.includes('--check-fallback')) { const r = youtubeFallback(draft); console.log(r.length ? `Run the last30free YouTube fallback: ${r.join('; ')}.` : 'No YouTube fallback needed.'); process.exit(0); }
    const batch = buildBatch(draft); const errors = validateBatch(batch);
    if (errors.length) { console.error('The built batch is not valid. Nothing was written.'); for (const e of errors) console.error('  - ' + e); process.exit(1); }
    const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(loadConfig().researchDir, 'inbox', draft.batchId + '.json');
    mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(batch, null, 2) + '\n');
    console.log(`Batch written: ${out}`);
    // Keep what the batch was built from, so a copied number can be checked against its source later.
    const keep = join(loadConfig().researchDir, 'sources', draft.batchId); mkdirSync(keep, { recursive: true });
    copyFileSync(file, join(keep, 'draft.json'));
    for (const k of ['tiktok', 'youtube', 'subtitles']) { const f = ((draft.last30free || {})[k] || {}).file; if (f) copyFileSync(f, join(keep, k + '.json')); }
    console.log(`Builder inputs kept: ${keep}`);
    for (const r of batch.runs) console.log(`  ${r.lane}: ${r.status === 'ok' ? r.results.length + ' posts. ' + (r.note || '') : 'FAILED: ' + r.error}`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
