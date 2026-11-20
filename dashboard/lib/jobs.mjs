// Work the dashboard hands to something else: agent jobs through ClaudeClaw's mission queue, and the Gumroad
// upload script. The dashboard never runs an agent itself.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const clawDir = cfg => dirname(dirname(cfg.missionCli)); // the CLI reads its own settings from its install folder

// The wording an agent (queued or pasted into Claude Code) receives. Kept here so both routes say the same thing.
// Version C is Mits's own script, typed in the dashboard. Its words live in this file, not in the batch.
export const versionCFile = id => `reels-data/content/version-c/${id}.txt`;
const cNote = (it, v) => v === 'C' ? ` (Mits's own script, in ${versionCFile(it.id)}; use its words exactly as the SCRIPT, and take the captions and CTA from the batch file)` : '';
export const approvalCommand = (it, v) => `/approve-reel reel ${it.reel} version ${v}, batch ${it.batch}${cNote(it, v)}`;
export const approvalPrompt = (it, v) => `Run the approve-reel skill: approve reel ${it.reel} version ${v}, batch ${it.batch}${cNote(it, v)}. Write the Instagram, TikTok and YouTube Shorts captions from the approved script if the batch has none, and have them reviewed. Build the resource PDF if the call to action needs one. Do not upload to Gumroad: Mits approves the PDF in the content dashboard.`;
export const revisionPrompt = (kw, text) => `Revise the resource guide for keyword ${kw} (reels-data/resource-sources/${kw.toLowerCase()}.md) to address this feedback from Mits: "${text.replace(/"/g, "'")}". Confirm any changed step at its official source, rebuild with the approve-reel skill's guide_to_pdf.mjs (${kw.toLowerCase()} --preview) and fix every CHECK. Do not upload to Gumroad: the rebuilt PDF needs Mits's approval in the content dashboard.`;

// Video work runs in Claude Code, never as a queued job, so this is always a command to paste.
export const videoRevisionPrompt = (slug, asset, version, text) => asset === 'hook'
  ? `/create-reel Revise the opening of video-projects/${slug} to address this feedback from Mits on the hook preview (plan ${String(version).slice(0, 12)}): "${text.replace(/"/g, "'")}". Rebuild the first seconds in Studio, record the opening again with preflight-reel --record-opening, and stop at Gate B. Do not approve it: Mits approves the hook in the content dashboard.`
  : `/create-reel Revise video-projects/${slug} to address this feedback from Mits on candidate ${String(version).slice(0, 12)}: "${text.replace(/"/g, "'")}". Render a new candidate and run full QA on it. Do not approve it: Mits approves the candidate in the content dashboard.`;

export function parseMissions(text) {
  const out = []; let cur = null;
  for (const l of String(text || '').split('\n')) {
    const m = l.match(/^(\S+) \[([^\]]+)\] @(\S*)/);
    if (m) { cur = { id: m[1], status: m[2], agent: m[3], title: '' }; out.push(cur); continue; }
    const t = cur && l.match(/^\s+Title:\s+(.*)$/); if (t) cur.title = t[1].trim();
  }
  return out;
}

export function listMissions(cfg) {
  if (!cfg.missionCli || !existsSync(cfg.missionCli)) return { ok: false, reason: 'ClaudeClaw was not found', missions: [] };
  const r = spawnSync(process.execPath, [cfg.missionCli, 'list'], { cwd: clawDir(cfg), encoding: 'utf8', timeout: 8000, windowsHide: true });
  if (r.status !== 0) return { ok: false, reason: 'the ClaudeClaw queue did not answer', missions: [] };
  return { ok: true, missions: parseMissions(r.stdout) };
}

// A queued job only runs if ClaudeClaw itself is up, so both are checked before the dashboard offers to queue.
export async function probeQueue(cfg) {
  const l = listMissions(cfg); let running = false;
  if (l.ok && cfg.queueHealthUrl) { try { await fetch(cfg.queueHealthUrl, { signal: AbortSignal.timeout(1500) }); running = true; } catch { /* not running */ } }
  cfg.runtime.queue = { available: l.ok, running, reason: !l.ok ? l.reason : running ? null : 'ClaudeClaw is not running', missions: l.missions };
  return cfg.runtime.queue;
}

export function queueMission(cfg, title, prompt) {
  const q = cfg.runtime.queue;
  if (!q || !q.available || !q.running) return { queued: false, reason: (q && q.reason) || 'job queue unavailable' };
  const r = spawnSync(process.execPath, [cfg.missionCli, 'create', '--agent', cfg.missionAgent, '--title', title, prompt], { cwd: clawDir(cfg), encoding: 'utf8', timeout: 10000, windowsHide: true });
  const m = /Mission task created:\s*(\S+)/.exec(r.stdout || '');
  if (r.status !== 0 || !m) return { queued: false, reason: 'the queue refused the job' };
  return { queued: true, id: m[1] };
}

export function runUpload(cfg, keyword) {
  return new Promise(res => {
    const c = spawn(process.execPath, [cfg.gumroadScript, keyword.toLowerCase()], { cwd: cfg.root, windowsHide: true });
    let out = ''; c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; });
    c.on('error', e => res({ code: -1, log: String(e) })); c.on('close', code => res({ code, log: out.slice(-3000) }));
  });
}

export function classifyUpload({ code, log }) {
  if (code === 0) {
    if (/Gumroad still processing/.test(log)) return 'processing';
    if (/^CHECK\b|to check [1-9]/m.test(log)) return 'needs-check';
    if (/^VERIFIED Gumroad:/m.test(log)) return 'uploaded';
    if (/not Claude-related/.test(log)) return 'not-applicable';
    if (/already on Gumroad, same size/.test(log)) return 'already-there';
    if (/^Uploaded [1-9]/m.test(log)) return 'uploaded';
    return 'nothing-uploaded';
  }
  if (code === 3) return 'login-needed';
  if (code === 4) return 'held';
  return 'failed';
}

export function checkUpload(cfg, resource) {
  const pdf = readFileSync(join(cfg.root, resource.pdf));
  if (createHash('sha256').update(pdf).digest('hex') !== resource.sha) throw new Error('The PDF changed. Review and approve the current file first.');
  const productConfig = JSON.parse(readFileSync(join(cfg.root, 'reels-data/gumroad.json'), 'utf8'));
  const localExe = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'gumroad', 'gumroad.exe');
  const [executable, ...prefix] = cfg.gumroadCommand || [localExe && existsSync(localExe) ? localExe : 'gumroad'];
  const read = args => {
    const result = spawnSync(executable, [...prefix, ...args, '--no-color', '--non-interactive'], { encoding: 'utf8', timeout: 30000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error('Could not read Gumroad upload status. Check the Gumroad CLI login and connection, then check again.');
    return JSON.parse(result.stdout);
  };
  const product = read(['products', 'view', productConfig.productId, '--json']).product;
  if (!product || product.id !== productConfig.productId) throw new Error('Gumroad returned a different product. Nothing was changed.');
  const normalize = name => String(name).toLowerCase().replace(/\.pdf$/, '').trim();
  const name = basename(resource.pdf, '.pdf');
  const file = (product.files || []).find(entry => normalize(entry.name) === normalize(name));
  if (!file) return { code: 1, log: `The PDF was not found on Gumroad: ${name}. Nothing was uploaded by this check.` };
  if (file.size == null) return { code: 0, log: `${name} (uploaded, Gumroad still processing; check its size later)` };
  if (file.size !== pdf.length) return { code: 0, log: `CHECK Gumroad: ${name} has ${file.size} bytes; the approved PDF has ${pdf.length}. Review it in Gumroad; no file was replaced.` };
  const content = read(['products', 'content', 'get', productConfig.productId]);
  if (!file.id || !JSON.stringify(content).includes(file.id)) return { code: 0, log: `CHECK Gumroad: ${name} is attached but not shown on a content page.` };
  return { code: 0, log: `VERIFIED Gumroad: ${name} (${file.size} bytes, matching the approved PDF; listed on a content page). Nothing was uploaded by this check.` };
}
