// The places the dashboard changes a record the workflow owns. Each happens only on an explicit click:
// one line of reels-data/resources.md (draft <-> live); an ig-insights link confirmation through link.py, so
// links.json stays the single record of what was published on Instagram; and the hook and candidate approvals,
// which run the Reel Studio scripts (preflight-reel.mjs, approve-reel.mjs) so every rule of theirs still applies.
import { readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// Changes the status word at the end of one keyword's line and nothing else. Line endings are kept as they were.
export function setResourceStatus(cfg, keyword, from, to) {
  if (!/^[A-Z][A-Z0-9]{2,}$/.test(String(keyword))) throw new Error('Invalid keyword');
  if (!['draft', 'live'].includes(from) || !['draft', 'live'].includes(to) || from === to) throw new Error('Invalid status change');
  const parts = readFileSync(cfg.resourcesMd, 'utf8').split(/(\r?\n)/);
  const hits = [];
  parts.forEach((line, i) => {
    const m = line.match(/^(-\s+([A-Z][A-Z0-9]{2,}):\s*.+\|\s*)(\S+)(\s*)$/);
    if (m && m[2] === keyword && line.split('|').length >= 4 && m[3].toLowerCase() === from) hits.push([i, m[1] + to + m[4]]);
  });
  if (hits.length !== 1) throw new Error(hits.length ? `Keyword ${keyword} has more than one ${from} line in resources.md; fix the file by hand` : `Keyword ${keyword} has no ${from} line in resources.md`);
  parts[hits[0][0]] = hits[0][1];
  const tmp = cfg.resourcesMd + '.tmp'; writeFileSync(tmp, parts.join('')); renameSync(tmp, cfg.resourcesMd);
}

// Confirms a link ig-insights proposed. The key is the Instagram media id of that proposal.
export function confirmLink(cfg, key, slug) {
  if (!/^\d{5,40}$/.test(String(key))) throw new Error('Invalid post id');
  if (slug && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(slug)) throw new Error('Invalid project name');
  const [bin, ...pre] = cfg.linkCommand; const args = [...pre, 'confirm', String(key)]; if (slug) args.push('--project', slug);
  const r = spawnSync(bin, args, { cwd: cfg.root, encoding: 'utf8', timeout: 60000, windowsHide: true, env: { ...process.env, HERK_BASE: cfg.root.replaceAll('\\', '/') } });
  if (r.error || r.status !== 0) throw new Error('ig-insights did not confirm the post: ' + (String((r.error && r.error.message) || r.stderr || r.stdout || 'no output').trim().split('\n').pop() || '').slice(0, 200));
}

// ---- hook (Gate B) and candidate approvals
const sha256 = f => createHash('sha256').update(readFileSync(f)).digest('hex');
const readJson = f => JSON.parse(readFileSync(f, 'utf8'));
const lastLine = r => (String((r.error && r.error.message) || r.stderr || r.stdout || 'no output').trim().split('\n').pop() || '').replace(/^Not approved:\s*/, '').slice(0, 300);
const reelScript = (cfg, name, args, timeout = 120000) => spawnSync(process.execPath, [join(cfg.reelScriptsDir, name), ...args], { cwd: cfg.root, encoding: 'utf8', timeout, windowsHide: true });

// The read-only Gate B report, from the script's own function so the fingerprint is the one --approve will check.
let preflightModule;
const reportCache = new Map();
export async function loadPreflight(cfg) { if (preflightModule === undefined) { try { preflightModule = await import(pathToFileURL(join(cfg.reelScriptsDir, 'preflight-reel.mjs')).href); } catch { preflightModule = null; } } return preflightModule; }
export function hookReport(cfg, dir) {
  if (!preflightModule) return { error: 'The Reel Studio preflight script could not be loaded' };
  const stamp = ['reel.json', 'assets/plan.json', 'assets/transcript.json'].map(f => { try { return statSync(join(dir, f)).mtimeMs; } catch { return 0; } }).join(':');
  const hit = reportCache.get(dir); if (hit && hit.stamp === stamp) return hit.value;
  let value;
  try {
    const r = preflightModule.preflightReport(dir); const op = preflightModule.openingStatus(r.reel, r.dir); const o = r.reel.openingPreview;
    const scenes = Array.isArray(r.plan && r.plan.scenes) ? r.plan.scenes : [];
    value = { valid: !r.errors.length, errors: r.errors.slice(0, 6), fingerprint: r.status.fingerprint || null, openingOk: !!op.ok, openingRequired: !!op.required,
      paidAssets: (r.status.validation && r.status.validation.metrics && r.status.validation.metrics.paidAssets) || [],
      previewChanged: !!(o && o.sha256 && existsSync(join(dir, o.file)) && sha256(join(dir, o.file)) !== o.sha256),
      // The preview record does not name a plan, so the only check available is order: was the plan edited after the preview was shown?
      // Is the preview on record the one for this plan? A record made since 2026-11-16 names its plan; an older one
      // can only be checked by order (was the plan file edited after the preview was shown?).
      planAfterPreview: !!o && (o.planFingerprint ? o.planFingerprint !== r.status.fingerprint
        : !!(o.recordedAt && existsSync(join(dir, 'assets/plan.json')) && statSync(join(dir, 'assets/plan.json')).mtimeMs > Date.parse(o.recordedAt))),
      scenes: scenes.slice(0, 40).map(s => ({ id: s.id, start: s.start, end: s.end, purpose: s.visualPurpose || null, intent: s.visualIntent || null })) };
  } catch (e) { value = { error: String(e.message || e).slice(0, 200) }; }
  reportCache.set(dir, { stamp, value }); return value;
}

// Runs the real command, then reads the record back: the approval counts only if the script saved it.
export function approveHook(cfg, slug, fingerprint) {
  const dir = join(cfg.projectsDir, slug);
  const r = reelScript(cfg, 'preflight-reel.mjs', [dir, '--approve', '--fingerprint', fingerprint, '--approved-by', cfg.approver, '--note', 'Approved in the content dashboard']);
  if (r.error || r.status !== 0) throw new Error('The hook was not approved: ' + lastLine(r));
  const pf = readJson(join(dir, 'reel.json')).preflight;
  if (!pf || pf.status !== 'approved' || pf.fingerprint !== fingerprint) throw new Error('The approval script finished but no matching approval is saved in reel.json');
}
export function approveCandidate(cfg, slug, candidate, sha) {
  const dir = join(cfg.projectsDir, slug);
  const r = reelScript(cfg, 'approve-reel.mjs', [dir, '--candidate', candidate, '--sha', sha, '--approved-by', cfg.approver, '--note', 'Approved in the content dashboard']);
  if (r.error || r.status !== 0) throw new Error('The candidate was not approved: ' + lastLine(r));
  const ok = (readJson(join(dir, 'reel.json')).approvals || []).some(a => a.status === 'approved' && a.candidate === candidate && a.sha256 === sha);
  const reel = readJson(join(dir, 'reel.json'));
  const rel = reel.finalFile || (reel.approvals || []).filter(a => a.status === 'approved').at(-1)?.promotedTo || 'renders/final.mp4';
  const final = /^renders\/[A-Za-z0-9][A-Za-z0-9._-]*\.mp4$/.test(rel) ? join(dir, rel) : null;
  if (!ok || !final || !existsSync(final) || sha256(final) !== sha) throw new Error('The approval script finished but the recorded final video is not the approved file');
}

// An outside finishing edit (e.g. Canva). The script decodes the whole file, so a 4K export gets more time.
const latestApproval = dir => (readJson(join(dir, 'reel.json')).approvals || []).filter(a => a.status === 'approved').at(-1);
const finalMatches = (dir, a) => !!a && /^renders\/[A-Za-z0-9][A-Za-z0-9._-]*\.mp4$/.test(a.promotedTo || '') && existsSync(join(dir, a.promotedTo)) && sha256(join(dir, a.promotedTo)) === a.sha256;
export function approveExternal(cfg, slug, file, sha, source) {
  const dir = join(cfg.projectsDir, slug);
  const r = reelScript(cfg, 'approve-external.mjs', [dir, '--file', file, '--sha', sha, '--approved-by', cfg.approver, '--source', source, '--note', 'Approved in the content dashboard'], 900000);
  if (r.error || r.status !== 0) throw new Error('The outside edit was not approved: ' + lastLine(r));
  const a = latestApproval(dir);
  if (!a || a.kind !== 'external-edit' || a.file !== file || a.sha256 !== sha || !finalMatches(dir, a)) throw new Error('The approval script finished but the recorded final video is not the approved outside edit');
  return { warnings: String(r.stdout || '').split(/\r?\n/).filter(l => l.startsWith('Warning: ')).map(l => l.slice(9).trim()) };
}
export function restoreExternal(cfg, slug) {
  const dir = join(cfg.projectsDir, slug);
  const r = reelScript(cfg, 'approve-external.mjs', [dir, '--restore'], 300000);
  if (r.error || r.status !== 0) throw new Error('The outside edit was not restored: ' + lastLine(r));
  if (!finalMatches(dir, latestApproval(dir))) throw new Error('The restore finished but the final video does not match the approval');
}
