// Saved ideas: a research post plus Mits's own angle. Kept in reels-data/research/ideas.json, which the research
// importer never writes. The one workflow file this module creates is a transcript in Instagram_transcript/, and
// only when "Export to the script workflow" is pressed for a post that qualifies. It never overwrites a file.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { researchPost } from './research-view.mjs';
import { createFetcher, YOUTUBE_ID } from './transcripts.mjs';

const MAX_ANGLE = 2000;
const MAX_TRANSCRIPT = 60000;
const PROVIDER = { 'signal-room': 'Signal Room', last30free: 'last30free' };
const PLATFORM = { instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' };
const FORMAT = { short: 'short-form', long: 'long-form', unknown: 'format unknown' };
const ideasFile = cfg => join(cfg.researchDir, 'ideas.json');
const sha = t => createHash('sha256').update(t).digest('hex');
const oneLine = t => String(t || '').replace(/\s+/g, ' ').trim();
const date = iso => String(iso).slice(0, 10);
const clock = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

// An unreadable ideas file throws, so it is never replaced by an empty one.
function readFile(cfg) {
  if (!existsSync(ideasFile(cfg))) return {};
  const j = JSON.parse(readFileSync(ideasFile(cfg), 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
}
export function readIdeas(cfg) { const j = readFile(cfg); return Array.isArray(j.ideas) ? j.ideas : []; }
// Replaces the ideas list and keeps everything else in the file as it is (the file is re-read here, not cached).
// The first write after this change keeps a copy of the file as it was, once.
export const ideasBackup = cfg => join(cfg.researchDir, 'archive', 'ideas.before-transcript-fetch.json');
// change(j) returns the keys to replace; every other key in the file is kept.
function writeAll(cfg, change) {
  mkdirSync(cfg.researchDir, { recursive: true });
  if (existsSync(ideasFile(cfg)) && !existsSync(ideasBackup(cfg))) { mkdirSync(join(cfg.researchDir, 'archive'), { recursive: true }); copyFileSync(ideasFile(cfg), ideasBackup(cfg)); }
  const j = readFile(cfg), tmp = ideasFile(cfg) + '.tmp';
  writeFileSync(tmp, JSON.stringify({ ...j, ...change(j) }, null, 2) + '\n'); renameSync(tmp, ideasFile(cfg));
}
const writeIdeas = (cfg, ideas) => writeAll(cfg, () => ({ ideas }));

// ---- Groups: up to 3 similar YouTube ideas side by side, with Mits's own script under them ----
// groups: [{ id, name, ideaIds, draft, createdAt, updatedAt, draftSavedAt? }] in the same ideas.json.
// Created with 1 to 3 YouTube ideas; afterwards a group holds 0 to 3. An idea is in at most one group. A group is
// never deleted by anything but Delete group, so its script survives even with no ideas left in it.
const MAX_GROUP = 3, MAX_NAME = 120, MAX_DRAFT = 100000;
export function readGroups(cfg) { const j = readFile(cfg); return Array.isArray(j.groups) ? j.groups : []; }
const writeGroups = (cfg, groups) => writeAll(cfg, () => ({ groups }));

// ---- YouTube transcripts fetched on save (lib/transcripts.mjs runs the helper) ----
// idea.fetched = { status: 'pending' | 'ok' | 'failed', requestedAt, fetchedAt?, text?, error? }. It is kept apart from a
// pasted idea.transcript, and only ever written for a YouTube idea whose post had no transcript of its own.
const fetcherOf = cfg => ((cfg.runtime ||= {}).transcripts ||= createFetcher(cfg, (ideaId, r) => {
  // Re-read now: the angle may have changed while the fetch ran, or the idea may have been removed.
  const ideas = readIdeas(cfg); const idea = ideas.find(x => x.id === ideaId);
  if (!idea || idea.exports.length || idea.transcript) return; // removed, exported or pasted meanwhile: nothing is written
  const at = new Date().toISOString(), requestedAt = (idea.fetched || {}).requestedAt || at;
  idea.fetched = r.ok ? { status: 'ok', requestedAt, fetchedAt: at, text: r.text } : { status: 'failed', requestedAt, fetchedAt: at, error: r.error };
  writeIdeas(cfg, ideas);
}));
// The post's own id, as YouTube spells it (the post key carries it in hex).
const videoIdOf = d => (d && d.platform === 'youtube' && YOUTUBE_ID.test(String(d.nativeId)) ? String(d.nativeId) : null);
// Whether a fetch may start for this idea now. d is the post as the research store holds it.
function canFetch(cfg, d, idea) {
  if (!videoIdOf(d) || d.transcriptText || !idea || idea.transcript || idea.exports.length) return false;
  const f = idea.fetched; if (!f) return true;
  return f.status === 'failed' || (f.status === 'pending' && !fetcherOf(cfg).has(idea.id));
}
function startFetch(cfg, d, idea, at) { idea.fetched = { status: 'pending', requestedAt: at }; return () => fetcherOf(cfg).enqueue(idea.id, videoIdOf(d)); }
// What the page shows about a fetch. A pending fetch this server is not running (it was restarted) reads as failed.
export function fetchView(cfg, d, idea) {
  if (!d || d.platform !== 'youtube') return null;
  const f = idea && idea.fetched;
  // A transcript from the research store, or one pasted by hand, needs no fetch status.
  if ((d.transcriptText && !d.fetchedOnSave) || (idea && idea.transcript && !(f && f.status === 'ok'))) return null;
  if (!f) return canFetch(cfg, d, idea) ? { state: 'none', canFetch: true } : null;
  if (f.status === 'ok') return { state: 'ok', fetchedAt: f.fetchedAt, words: f.text.trim().split(/\s+/).filter(Boolean).length };
  if (f.status === 'pending' && fetcherOf(cfg).has(idea.id)) return { state: 'fetching', requestedAt: f.requestedAt };
  const error = f.status === 'pending' ? "Couldn't fetch subtitles: the dashboard was restarted before the fetch finished." : f.error;
  return { state: 'failed', error, fetchedAt: f.fetchedAt || null, canFetch: canFetch(cfg, d, idea) };
}
// For tests and the server: resolves once no fetch is waiting or running.
export const fetchesIdle = cfg => fetcherOf(cfg).idle();

// A transcript Mits pasted himself, for a post whose search fetched none. It lives on the idea in ideas.json
// (research imports rewrite the post store, so it would not survive there) and is always labelled as pasted.
// A fetched transcript always wins: the paste box is only offered when none was fetched.
// Order: the research store's own transcript, then YouTube subtitles fetched on save, then one pasted by hand.
export function withManualTranscript(d, idea) {
  if (!d || d.transcriptText || !idea) return d;
  const f = idea.fetched;
  if (f && f.status === 'ok' && f.text) return { ...d, transcriptText: f.text, transcriptPassage: null, evidence: 'transcript', fetchedOnSave: true,
    transcript: { origin: 'subtitles', provider: null, capturedAt: f.fetchedAt, words: f.text.trim().split(/\s+/).filter(Boolean).length } };
  if (!(idea.transcript && idea.transcript.text)) return d;
  const text = idea.transcript.text;
  return { ...d, transcriptText: text, transcriptPassage: null, evidence: 'manual', manualTranscript: true,
    transcript: { origin: 'manual', provider: null, capturedAt: idea.transcript.savedAt, words: text.trim().split(/\s+/).filter(Boolean).length } };
}

// Short-form handoff needs a verified short format, a real full transcript, a source link and a duration.
// A caption or a search excerpt is not a transcript. Long-form has no production workflow connected yet.
export function handoff(d) {
  const reasons = [];
  if (d.format === 'long') reasons.push('This is long-form. Its production workflow is not connected yet; copy the brief instead.');
  else if (d.format !== 'short') reasons.push('The format is not verified as short-form.');
  if (!d.transcriptText) reasons.push((d.caption || d.excerpts.length ? 'No full transcript was fetched. A caption or a search excerpt is not a transcript.' : 'No full transcript was fetched.') + ' You can paste one under Evidence saved.');
  if (!d.url) reasons.push('There is no source link.');
  if (!(d.durationSeconds > 0)) reasons.push('The duration is unknown.');
  return { ok: reasons.length === 0, reasons };
}

const creatorOf = d => d.creator.handle ? String(d.creator.handle).replace(/^@/, '') : d.creator.name || 'unknown creator';
function statsLine(d) {
  const o = d.engagement && d.observations.find(x => x.provider === d.engagement.provider && x.measuredAt === d.engagement.measuredAt && x.metrics[d.engagement.metric] === d.engagement.value);
  const parts = [d.publishedAt ? `published ${date(d.publishedAt)}` : 'publication date unknown'];
  if (o) for (const [k, v] of Object.entries(o.metrics)) if (k !== 'followers') parts.push(`${v} ${k}`);
  return parts.join(', ') + (o ? ` (${PROVIDER[o.provider]}, ${o.measuredAt ? 'measured ' + date(o.measuredAt) : 'measurement time unknown'})` : ' (no counts recorded)');
}

// The transcript file /rewrite-reels expects: a "## Reel:" heading, Source, Duration, one Stats line, then the
// spoken words. Mits's direction goes in its own "Note from Mits:" header line, never among the spoken words.
export const exportName = d => `research-${d.platform}-${d.nativeId}.md`;
export function exportText(d, idea) {
  const head = [`## Reel: ${oneLine(creatorOf(d))} — ${oneLine(d.title) || 'untitled'}`, '', `Source: ${d.url}`, `Duration: ${Math.round(d.durationSeconds)}s`, `Stats: ${statsLine(d)}`];
  if (oneLine(idea.angle)) head.push(`Note from Mits: ${oneLine(idea.angle)}`);
  return head.join('\n') + '\n\n' + d.transcriptText.trim() + '\n';
}

// A plain-text brief for any saved idea, long-form included. Each kind of text is labelled for what it is.
export function briefText(d, idea) {
  const L = [];
  L.push('RESEARCH BRIEF', `Title: ${oneLine(d.title) || 'untitled'}`, `Source: ${d.url}`, `Platform and format: ${PLATFORM[d.platform]}, ${FORMAT[d.format]}`, `Creator: ${creatorOf(d)}`,
    `Published: ${d.publishedAt ? date(d.publishedAt) : 'unknown'}`, `Duration: ${d.durationSeconds > 0 ? clock(d.durationSeconds) : 'unknown'}`,
    `Found by: ${d.runs.map(r => `${PROVIDER[r.provider]} (${r.laneLabel}, search "${r.query}", ${r.rank} of ${r.of} top matches)`).join('; ') || 'no search run on record'}`);
  L.push('', 'MY ANGLE (my own direction, not from the source)', idea.angle.trim() || 'Not written yet.');
  L.push('', 'MEASUREMENTS (public counts; they show association, not cause)');
  if (!d.observations.length) L.push('None recorded.');
  for (const o of d.observations) L.push(`- ${PROVIDER[o.provider]}, ${o.measuredAt ? 'measured ' + date(o.measuredAt) : 'measurement time unknown'}: ${Object.entries(o.metrics).map(([k, v]) => `${v} ${k}`).join(', ') || 'no counts'}${o.outlier && o.outlier.rankable ? `; creator outlier ${o.outlier.value} (${o.outlier.label})` : ''}`);
  for (const x of d.excerpts) L.push('', `SEARCH EXCERPT (${x.kind === 'hook' ? 'opening lines' : 'passage around the match'}, returned by ${PROVIDER[x.provider]}; ${x.complete === false ? 'word for word but only partly copied' : 'word for word'}; not the full transcript)`, x.text);
  L.push('', 'CAPTION OR DESCRIPTION (written by the creator, not spoken)', d.caption ? d.caption.trim() : 'None saved.');
  if (d.transcriptText) {
    const words = d.transcriptText.trim().split(/\s+/); const cut = words.length > 250;
    const by = d.manualTranscript ? ', pasted by Mits' : d.fetchedOnSave ? ', YouTube subtitles fetched when the idea was saved' : '';
    L.push('', cut ? `TRANSCRIPT EXCERPT (spoken words${by}: the first 250 of ${words.length}; the full transcript is on the post's page)` : `FULL TRANSCRIPT (spoken words${by}, ${words.length} words)`, cut ? words.slice(0, 250).join(' ') + ' …' : d.transcriptText.trim());
  } else L.push('', 'TRANSCRIPT', 'No transcript was fetched for this post.');
  return L.join('\n') + '\n';
}

// The Pipeline item an exported idea became: matched by the transcript file the export wrote.
const linkedItem = (idea, items) => { const ex = idea && idea.exports && idea.exports[0]; return ex ? items.find(i => i.files && i.files.source && basename(i.files.source) === basename(ex.file)) || null : null; };

// Where an idea is in its life. Worked out from the files each time, so nothing has to be moved by hand:
// to do (saved) -> in production (exported) -> used (its reel is on Instagram). Mits can also close an idea
// himself as used (made outside the dashboard) or dropped; that choice wins and can be undone.
export const IDEA_STAGES = { todo: 'To do', production: 'In production', used: 'Used', dropped: 'Dropped' };
export function ideaStage(idea, items = []) {
  if (!idea) return null;
  const item = linkedItem(idea, items), reel = item ? { id: item.id, title: item.title } : null;
  const posted = item && item.platforms && item.platforms.ig && item.platforms.ig.state === 'published';
  if (idea.closed) return { key: idea.closed.as, at: idea.closed.at, manual: true, reel };
  if (posted) return { key: 'used', at: item.platforms.ig.at || null, manual: false, reel };
  if (idea.exports && idea.exports.length) return { key: 'production', at: idea.exports[0].at, manual: false, reel };
  return { key: 'todo', at: idea.createdAt, manual: false, reel: null };
}
// postId -> stage, for marking rows in Signals.
export const ideaStages = (cfg, items = []) => Object.fromEntries(readIdeas(cfg).map(i => { const s = ideaStage(i, items); return [i.postId, { key: s.key, reel: s.reel && s.reel.title }]; }));

// What the page needs about one idea. items: the pipeline items from buildState, to link an exported file.
export function ideaInfo(cfg, d, idea, items = []) {
  const h = handoff(d); const ex = idea && idea.exports && idea.exports[0];
  let exported = null;
  if (ex) {
    const waiting = existsSync(join(cfg.root, ex.file));
    const item = linkedItem(idea, items);
    exported = { file: ex.file, at: ex.at, waiting, pipelineId: item ? item.id : null, pipelineTitle: item ? item.title : null, pipelineStatus: item ? (item.needs[0] || {}).label || item.note || null : null, angleChanged: sha(oneLine(idea.angle)) !== ex.angleSha, command: '/rewrite-reels' };
  }
  // The page never needs the fetched text twice: it is already in transcriptText.
  const pub = idea && idea.fetched && idea.fetched.text ? { ...idea, fetched: { ...idea.fetched, text: undefined } } : idea;
  return { idea: pub || null, handoff: h, brief: idea ? briefText(d, idea) : null, exported, stage: ideaStage(idea, items), fetch: fetchView(cfg, d, idea) };
}

export function ideasView(cfg, items = [], now = new Date()) {
  const groups = readGroups(cfg), groupOf = id => { const g = groups.find(x => x.ideaIds.includes(id)); return g ? { id: g.id, name: g.name } : null; };
  return readIdeas(cfg).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(idea => {
    const d = withManualTranscript(researchPost(cfg, idea.postId, '', now), idea);
    if (!d) return { idea, missing: true, group: groupOf(idea.id) };
    return { ...ideaInfo(cfg, d, idea, items), group: groupOf(idea.id), post: { id: d.id, title: d.title, platform: d.platform, format: d.format, url: d.url, creator: d.creator, evidence: d.evidence, publishedAt: d.publishedAt, publishedAgeDays: d.publishedAgeDays, durationSeconds: d.durationSeconds } };
  });
}

// ---- group views ----
const creatorName = d => [d.creator.name, d.creator.handle && '@' + String(d.creator.handle).replace(/^@/, '')].filter(Boolean).join(' · ') || null;
// One member of a group, with everything the side-by-side columns show.
function memberOf(cfg, ideas, ideaId, now) {
  const idea = ideas.find(x => x.id === ideaId); if (!idea) return { ideaId, missing: true };
  const d = withManualTranscript(researchPost(cfg, idea.postId, '', now), idea); if (!d) return { ideaId, postId: idea.postId, missing: true, angle: idea.angle };
  const m = d.metrics || {};
  return { ideaId, postId: d.id, title: d.title, creator: creatorName(d), url: d.url, format: d.format, publishedAt: d.publishedAt, durationSeconds: d.durationSeconds,
    views: m.views ?? null, viewsMeasuredAt: m.views != null ? m.measuredAt || null : null, angle: idea.angle,
    transcriptText: d.transcriptText || null, transcriptWords: d.transcript ? d.transcript.words : null,
    transcriptLabel: !d.transcriptText ? null : d.manualTranscript ? 'pasted by you' : d.fetchedOnSave ? 'YouTube subtitles fetched when you saved the idea' : d.transcript.origin === 'subtitles' ? 'YouTube subtitles' : 'transcript from the research store',
    fetch: fetchView(cfg, d, idea) };
}
// Every member's transcript, labelled, for pasting into Claude. Titles and angles are marked as what they are.
export function groupBundle(g, members) {
  const L = [`GROUP: ${oneLine(g.name)}`, `${members.length} YouTube ${members.length === 1 ? 'video' : 'videos'}. TRANSCRIPT sections are the creators' spoken words; MY ANGLE lines are my own direction.`];
  members.forEach((m, i) => {
    L.push('', `=== VIDEO ${i + 1} of ${members.length}: ${m.missing ? 'source post no longer in the research store' : oneLine(m.title) || 'untitled'}`);
    if (!m.missing) L.push(`Creator: ${m.creator || 'unknown'}`, `Source: ${m.url}`, `Published: ${m.publishedAt ? date(m.publishedAt) : 'unknown'} · Duration: ${m.durationSeconds > 0 ? clock(m.durationSeconds) : 'unknown'} · Views: ${m.views != null ? m.views + (m.viewsMeasuredAt ? ` (measured ${date(m.viewsMeasuredAt)})` : ' (measurement time unknown)') : 'unknown'}`);
    L.push(`MY ANGLE: ${oneLine(m.angle) || 'not written yet'}`);
    if (m.transcriptText) L.push(`TRANSCRIPT (${m.transcriptLabel}, ${m.transcriptWords} words):`, m.transcriptText.trim());
    else L.push(`TRANSCRIPT: none yet${m.fetch && m.fetch.state === 'fetching' ? ' (still being fetched)' : m.fetch && m.fetch.state === 'failed' ? " (couldn't fetch subtitles)" : ''}.`);
  });
  return L.join('\n') + '\n';
}
export function groupsSummary(cfg) {
  const ideas = readIdeas(cfg);
  return readGroups(cfg).slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map(g => ({ id: g.id, name: g.name, count: g.ideaIds.length, hasDraft: !!String(g.draft || '').trim(), updatedAt: g.updatedAt,
    titles: g.ideaIds.map(id => { const i = ideas.find(x => x.id === id); const d = i && researchPost(cfg, i.postId, ''); return d ? d.title || 'Untitled post' : 'Source post not found'; }) }));
}
// One group's page: its members side by side, the script, ideas that could join it, and the bundle to copy.
export function groupView(cfg, id, now = new Date()) {
  const groups = readGroups(cfg), g = groups.find(x => x.id === id); if (!g) return null;
  const ideas = readIdeas(cfg), members = g.ideaIds.map(x => memberOf(cfg, ideas, x, now));
  const grouped = new Set(groups.flatMap(x => x.ideaIds));
  const candidates = g.ideaIds.length >= MAX_GROUP ? [] : ideas.filter(i => i.postId.startsWith('youtube-') && !grouped.has(i.id)).map(i => { const d = researchPost(cfg, i.postId, '', now); return d ? { ideaId: i.id, title: d.title || 'Untitled post' } : null; }).filter(Boolean);
  return { group: { id: g.id, name: g.name, draft: g.draft || '', createdAt: g.createdAt, updatedAt: g.updatedAt, draftSavedAt: g.draftSavedAt || null }, members, candidates, max: MAX_GROUP, bundle: groupBundle(g, members) };
}

// One action from the Research page. Every one is safe to repeat.
export function ideaAction(cfg, body, now = new Date()) {
  const a = body || {}; const at = now.toISOString(); const ideas = readIdeas(cfg);
  const angleOf = v => { const t = String(v ?? '').trim(); if (t.length > MAX_ANGLE) throw new Error(`Keep the angle under ${MAX_ANGLE.toLocaleString('en-GB')} characters`); return t; };
  const find = () => { const i = ideas.find(x => x.id === a.ideaId); if (!i) throw new Error('That idea no longer exists'); return i; };

  if (a.type === 'save-idea') {
    if (!researchPost(cfg, a.postId, '', now)) throw new Error('Unknown post');
    const have = ideas.find(x => x.postId === a.postId);
    if (have) return { message: 'Already saved. Nothing was duplicated.', ideaId: have.id }; // a second click changes nothing, not even the angle
    const idea = { id: 'idea-' + a.postId, postId: a.postId, angle: angleOf(a.angle), createdAt: at, updatedAt: at, exports: [] };
    // A YouTube post with no transcript: its subtitles are fetched in the background. Instagram and TikTok: no fetch.
    const d = researchPost(cfg, a.postId, '', now), go = canFetch(cfg, d, idea) ? startFetch(cfg, d, idea, at) : null;
    writeIdeas(cfg, [...ideas, idea]); if (go) go();
    return { message: go ? 'Idea saved. Fetching its YouTube transcript now.' : 'Idea saved.', ideaId: idea.id };
  }
  // Fetch (or retry) the YouTube transcript for one saved idea. Repeat-safe: one already waiting or running is left alone.
  if (a.type === 'fetch-transcript') {
    const idea = find(); const d = researchPost(cfg, idea.postId, '', now);
    if (idea.fetched && idea.fetched.status === 'pending' && fetcherOf(cfg).has(idea.id)) return { message: 'Already fetching this transcript.', ideaId: idea.id };
    if (!canFetch(cfg, d, idea)) return { message: videoIdOf(d) ? 'This idea already has a transcript, so nothing was fetched.' : 'Transcripts are fetched for YouTube ideas only.', ideaId: idea.id };
    const go = startFetch(cfg, d, idea, at); idea.updatedAt = at; writeIdeas(cfg, ideas); go();
    return { message: 'Fetching the YouTube transcript now.', ideaId: idea.id };
  }
  // Every saved YouTube idea still without a transcript, queued one at a time. Ones already queued are not added again.
  if (a.type === 'fetch-missing') {
    const go = [];
    for (const idea of ideas) { const d = researchPost(cfg, idea.postId, '', now); if (canFetch(cfg, d, idea)) { go.push(startFetch(cfg, d, idea, at)); idea.updatedAt = at; } }
    if (!go.length) return { message: 'No saved YouTube idea is missing a transcript, or they are already being fetched.', ideaId: null };
    writeIdeas(cfg, ideas); go.forEach(f => f());
    return { message: `Fetching ${go.length} YouTube ${go.length === 1 ? 'transcript' : 'transcripts'}, one at a time.`, ideaId: null };
  }
  // Close an idea as used (made outside the dashboard) or dropped, or reopen it (as: ''). Nothing else changes.
  if (a.type === 'close-idea') {
    const idea = find(); const as = a.as || '';
    if (!['used', 'dropped', ''].includes(as)) throw new Error('Choose used or dropped');
    if (!as) { if (!idea.closed) return { message: 'No change.', ideaId: idea.id }; delete idea.closed; idea.updatedAt = at; writeIdeas(cfg, ideas); return { message: 'Idea reopened.', ideaId: idea.id }; }
    if (idea.closed && idea.closed.as === as) return { message: 'No change.', ideaId: idea.id };
    idea.closed = { as, at }; idea.updatedAt = at; writeIdeas(cfg, ideas); return { message: as === 'used' ? 'Marked as used.' : 'Idea dropped. It stays under Dropped.', ideaId: idea.id };
  }
  if (a.type === 'set-angle') {
    const idea = find(); const angle = angleOf(a.angle);
    if (angle === idea.angle) return { message: 'No change.', ideaId: idea.id };
    idea.angle = angle; idea.updatedAt = at; writeIdeas(cfg, ideas); return { message: 'Angle saved.', ideaId: idea.id };
  }
  // Paste or replace a transcript by hand. Saves the idea first if it is not saved yet.
  if (a.type === 'set-transcript') {
    const d = researchPost(cfg, a.postId, '', now); if (!d) throw new Error('Unknown post');
    if (d.transcriptText) throw new Error('This post already has a fetched transcript, so a pasted one is not needed.');
    const had = ideas.find(x => x.postId === a.postId);
    if (had && had.fetched && had.fetched.status === 'ok') throw new Error('This idea already has its YouTube subtitles, so a pasted transcript is not needed.');
    if (had && had.fetched && had.fetched.status === 'pending' && fetcherOf(cfg).has(had.id)) throw new Error('The YouTube transcript is still being fetched. Paste one only if that fails.');
    const text = String(a.text ?? '').replace(/\r\n/g, '\n').trim();
    if (!text) throw new Error('Paste the transcript first.');
    if (text.length > MAX_TRANSCRIPT) throw new Error(`Keep the transcript under ${MAX_TRANSCRIPT.toLocaleString('en-GB')} characters`);
    let idea = ideas.find(x => x.postId === a.postId), created = false;
    if (!idea) { idea = { id: 'idea-' + a.postId, postId: a.postId, angle: angleOf(a.angle), createdAt: at, updatedAt: at, exports: [] }; ideas.push(idea); created = true; }
    if (idea.exports.length) throw new Error('This idea was already exported, so its transcript is kept as it was exported.');
    if (idea.transcript && idea.transcript.text === text) return { message: 'No change.', ideaId: idea.id };
    idea.transcript = { text, savedAt: at, by: 'manual' }; idea.updatedAt = at; writeIdeas(cfg, ideas);
    return { message: created ? 'Transcript saved, and the idea with it.' : 'Transcript saved.', ideaId: idea.id };
  }
  if (a.type === 'remove-transcript') {
    const idea = find();
    if (idea.exports.length) throw new Error('This idea was already exported, so its transcript is kept as it was exported.');
    if (!idea.transcript) return { message: 'No pasted transcript to remove.', ideaId: idea.id };
    delete idea.transcript; idea.updatedAt = at; writeIdeas(cfg, ideas); return { message: 'Pasted transcript removed. The idea is kept.', ideaId: idea.id };
  }
  if (a.type === 'remove-idea') {
    const idea = find();
    if (idea.exports.length) throw new Error('This idea was exported to the script workflow, so its record is kept.');
    fetcherOf(cfg).drop(idea.id); // a fetch already running finishes, and its result is dropped
    // It leaves its group too; the group and its script stay, even if it was the last idea in it.
    writeAll(cfg, j => ({ ideas: ideas.filter(x => x !== idea), ...(Array.isArray(j.groups) ? { groups: j.groups.map(g => g.ideaIds.includes(idea.id) ? { ...g, ideaIds: g.ideaIds.filter(x => x !== idea.id), updatedAt: at } : g) } : {}) }));
    return { message: 'Idea removed. The research post is unchanged.', ideaId: null };
  }
  if (a.type === 'export-idea') {
    const idea = find(); const d = withManualTranscript(researchPost(cfg, idea.postId, '', now), idea);
    if (!d) throw new Error('The source post is no longer in the research store');
    if (idea.exports.length) return { message: `Already exported on ${date(idea.exports[0].at)}. Nothing was written.`, ideaId: idea.id };
    const h = handoff(d); if (!h.ok) throw new Error('Cannot export. ' + h.reasons.join(' '));
    const name = exportName(d), target = join(cfg.dropDir, name), text = exportText(d, idea);
    mkdirSync(cfg.dropDir, { recursive: true });
    try { writeFileSync(target, text, { flag: 'wx' }); } // fails rather than replace a file that is already there
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // The same file from an interrupted export is adopted; anything else is left alone.
      if (sha(readFileSync(target, 'utf8')) !== sha(text)) throw new Error(`A different file named ${name} is already in Instagram_transcript. Nothing was overwritten.`);
    }
    idea.exports.push({ file: `Instagram_transcript/${name}`, at, sha256: sha(text), angleSha: sha(oneLine(idea.angle)), postId: d.id, sourceUrl: d.url });
    idea.updatedAt = at; writeIdeas(cfg, ideas);
    return { message: `Exported to Instagram_transcript/${name}. Run /rewrite-reels in Claude Code to start the scripts.`, ideaId: idea.id };
  }
  // ---- groups ----
  const groups = readGroups(cfg);
  const gfind = () => { const g = groups.find(x => x.id === a.groupId); if (!g) throw new Error('That group no longer exists'); return g; };
  const grouped = id => groups.find(g => g.ideaIds.includes(id));
  const youtubeIdea = id => { const i = ideas.find(x => x.id === id); if (!i) throw new Error('That idea no longer exists'); if (!i.postId.startsWith('youtube-')) throw new Error('Only YouTube ideas can be grouped.'); return i; };
  const nameOf = v => { const t = oneLine(v); if (t.length > MAX_NAME) throw new Error(`Keep the group name under ${MAX_NAME} characters`); return t; };
  // Created with 1 to 3 YouTube ideas. Pressing it twice for the same ideas returns the group already made.
  if (a.type === 'create-group') {
    const ids = [...new Set((Array.isArray(a.ideaIds) ? a.ideaIds : []).map(String))];
    if (!ids.length) throw new Error('Choose at least one YouTube idea for the group.');
    if (ids.length > MAX_GROUP) throw new Error(`A group holds at most ${MAX_GROUP} ideas.`);
    ids.forEach(youtubeIdea);
    const same = groups.find(g => g.ideaIds.length === ids.length && ids.every(i => g.ideaIds.includes(i)));
    if (same) return { message: 'These ideas are already a group. Nothing was duplicated.', groupId: same.id };
    const taken = ids.map(grouped).find(Boolean);
    if (taken) throw new Error(`One of these ideas is already in the group “${taken.name}”. Remove it there first.`);
    const first = researchPost(cfg, ideas.find(x => x.id === ids[0]).postId, '', now);
    const name = nameOf(a.name) || oneLine((first && first.title) || 'New group').slice(0, MAX_NAME);
    const g = { id: 'group-' + sha(at + ids.join(',')).slice(0, 12), name, ideaIds: ids, draft: '', createdAt: at, updatedAt: at };
    writeGroups(cfg, [...groups, g]); return { message: 'Group created.', groupId: g.id };
  }
  if (a.type === 'add-to-group') {
    const g = gfind(); const idea = youtubeIdea(String(a.ideaId));
    if (g.ideaIds.includes(idea.id)) return { message: 'Already in this group.', groupId: g.id };
    const other = grouped(idea.id); if (other) throw new Error(`That idea is already in the group “${other.name}”. Remove it there first.`);
    if (g.ideaIds.length >= MAX_GROUP) throw new Error(`This group already holds ${MAX_GROUP} ideas.`);
    g.ideaIds.push(idea.id); g.updatedAt = at; writeGroups(cfg, groups); return { message: 'Added to the group.', groupId: g.id };
  }
  // Removing the last idea leaves the group, and its script, in place.
  if (a.type === 'remove-from-group') {
    const g = gfind(); if (!g.ideaIds.includes(String(a.ideaId))) return { message: 'Not in this group.', groupId: g.id };
    g.ideaIds = g.ideaIds.filter(x => x !== String(a.ideaId)); g.updatedAt = at; writeGroups(cfg, groups);
    return { message: g.ideaIds.length ? 'Removed from the group. The idea is kept.' : 'Removed from the group. The group and its script are kept.', groupId: g.id };
  }
  if (a.type === 'rename-group') {
    const g = gfind(); const name = nameOf(a.name); if (!name) throw new Error('Give the group a name.');
    if (name === g.name) return { message: 'No change.', groupId: g.id };
    g.name = name; g.updatedAt = at; writeGroups(cfg, groups); return { message: 'Group renamed.', groupId: g.id };
  }
  if (a.type === 'set-group-draft') {
    const g = gfind(); const draft = String(a.draft ?? '').replace(/\r\n/g, '\n');
    if (draft.length > MAX_DRAFT) throw new Error(`Keep the script under ${MAX_DRAFT.toLocaleString('en-GB')} characters`);
    if (draft === (g.draft || '')) return { message: 'No change.', groupId: g.id, savedAt: g.draftSavedAt || null };
    g.draft = draft; g.draftSavedAt = at; g.updatedAt = at; writeGroups(cfg, groups); return { message: 'Script saved.', groupId: g.id, savedAt: at };
  }
  // Only this removes a group. The page asks first when it has a script. Its ideas are kept.
  if (a.type === 'delete-group') {
    const g = groups.find(x => x.id === a.groupId); if (!g) return { message: 'That group was already deleted.', groupId: null };
    writeGroups(cfg, groups.filter(x => x !== g)); return { message: 'Group deleted. Its ideas are kept.', groupId: null };
  }
  throw new Error('Unknown action');
}
