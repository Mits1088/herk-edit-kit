// Saved ideas: a research post plus Mits's own angle. Kept in reels-data/research/ideas.json, which the research
// importer never writes. The one workflow file this module creates is a transcript in Instagram_transcript/, and
// only when "Export to the script workflow" is pressed for a post that qualifies. It never overwrites a file.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { researchPost } from './research-view.mjs';

const MAX_ANGLE = 2000;
const PROVIDER = { 'signal-room': 'Signal Room', last30free: 'last30free' };
const PLATFORM = { instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' };
const FORMAT = { short: 'short-form', long: 'long-form', unknown: 'format unknown' };
const ideasFile = cfg => join(cfg.researchDir, 'ideas.json');
const sha = t => createHash('sha256').update(t).digest('hex');
const oneLine = t => String(t || '').replace(/\s+/g, ' ').trim();
const date = iso => String(iso).slice(0, 10);
const clock = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

// An unreadable ideas file throws, so it is never replaced by an empty one.
export function readIdeas(cfg) {
  if (!existsSync(ideasFile(cfg))) return [];
  const j = JSON.parse(readFileSync(ideasFile(cfg), 'utf8')); return Array.isArray(j.ideas) ? j.ideas : [];
}
function writeIdeas(cfg, ideas) {
  mkdirSync(cfg.researchDir, { recursive: true }); const tmp = ideasFile(cfg) + '.tmp';
  writeFileSync(tmp, JSON.stringify({ ideas }, null, 2) + '\n'); renameSync(tmp, ideasFile(cfg));
}

// Short-form handoff needs a verified short format, a real full transcript, a source link and a duration.
// A caption or a search excerpt is not a transcript. Long-form has no production workflow connected yet.
export function handoff(d) {
  const reasons = [];
  if (d.format === 'long') reasons.push('This is long-form. Its production workflow is not connected yet; copy the brief instead.');
  else if (d.format !== 'short') reasons.push('The format is not verified as short-form.');
  if (!d.transcriptText) reasons.push(d.caption || d.excerpts.length ? 'No full transcript was fetched. A caption or a search excerpt is not a transcript.' : 'No full transcript was fetched.');
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
    L.push('', cut ? `TRANSCRIPT EXCERPT (spoken words: the first 250 of ${words.length}; the full transcript is on the post's page)` : `FULL TRANSCRIPT (spoken words, ${words.length} words)`, cut ? words.slice(0, 250).join(' ') + ' …' : d.transcriptText.trim());
  } else L.push('', 'TRANSCRIPT', 'No transcript was fetched for this post.');
  return L.join('\n') + '\n';
}

// What the page needs about one idea. items: the pipeline items from buildState, to link an exported file.
export function ideaInfo(cfg, d, idea, items = []) {
  const h = handoff(d); const ex = idea && idea.exports && idea.exports[0];
  let exported = null;
  if (ex) {
    const waiting = existsSync(join(cfg.root, ex.file));
    const item = items.find(i => i.files && i.files.source && basename(i.files.source) === basename(ex.file));
    exported = { file: ex.file, at: ex.at, waiting, pipelineId: item ? item.id : null, pipelineTitle: item ? item.title : null, angleChanged: sha(oneLine(idea.angle)) !== ex.angleSha, command: '/rewrite-reels' };
  }
  return { idea: idea || null, handoff: h, brief: idea ? briefText(d, idea) : null, exported };
}

export function ideasView(cfg, items = [], now = new Date()) {
  return readIdeas(cfg).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(idea => {
    const d = researchPost(cfg, idea.postId, '', now);
    if (!d) return { idea, missing: true };
    return { ...ideaInfo(cfg, d, idea, items), post: { id: d.id, title: d.title, platform: d.platform, format: d.format, url: d.url, creator: d.creator, evidence: d.evidence, publishedAt: d.publishedAt, publishedAgeDays: d.publishedAgeDays, durationSeconds: d.durationSeconds } };
  });
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
    writeIdeas(cfg, [...ideas, idea]); return { message: 'Idea saved.', ideaId: idea.id };
  }
  if (a.type === 'set-angle') {
    const idea = find(); const angle = angleOf(a.angle);
    if (angle === idea.angle) return { message: 'No change.', ideaId: idea.id };
    idea.angle = angle; idea.updatedAt = at; writeIdeas(cfg, ideas); return { message: 'Angle saved.', ideaId: idea.id };
  }
  if (a.type === 'remove-idea') {
    const idea = find();
    if (idea.exports.length) throw new Error('This idea was exported to the script workflow, so its record is kept.');
    writeIdeas(cfg, ideas.filter(x => x !== idea)); return { message: 'Idea removed. The research post is unchanged.', ideaId: null };
  }
  if (a.type === 'export-idea') {
    const idea = find(); const d = researchPost(cfg, idea.postId, '', now);
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
  throw new Error('Unknown action');
}
