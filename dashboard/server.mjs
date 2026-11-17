// Content dashboard. Local; reads the workflow's files and writes its own records in reels-data/content/.
// The few changes it makes to workflow records are listed in dashboard/README.md. Run: node dashboard/server.mjs
import http from 'node:http';
import { createReadStream, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, sep, extname, basename, dirname } from 'node:path';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { loadConfig } from './lib/config.mjs';
import { buildState, itemDetail } from './lib/state.mjs';
import { applyAction, readManifests, updateManifest, liveAfterUpload } from './lib/manifest.mjs';
import { probeQueue, queueMission, runUpload, checkUpload, classifyUpload, approvalPrompt, approvalCommand, revisionPrompt } from './lib/jobs.mjs';
import { loadPreflight } from './lib/workflow.mjs';
import { researchList, researchSearches, researchPost, researchCsv } from './lib/research-view.mjs';
import { readIdeas, ideaInfo, ideasView, ideaAction } from './lib/ideas.mjs';
import * as zernio from './lib/zernio.mjs';
const STATIC = { '/research.js': 'text/javascript; charset=utf-8', '/research.css': 'text/css; charset=utf-8', '/publish.js': 'text/javascript; charset=utf-8', '/publish.css': 'text/css; charset=utf-8' };
await loadPreflight(loadConfig()); // the Gate B report comes from the Reel Studio script itself

// One action from the page. Records it, then hands on any follow-up work: an upload for an approved PDF,
// or an agent job for a script approval or a PDF revision. Returns a short message for the page.
export async function handleAction(cfg, body, { wait = false } = {}) {
  if (['zernio-send', 'zernio-retry'].includes((body || {}).type)) await zernio.accounts(cfg, { fresh: true }); // read-only check immediately before submission
  const state = buildState(cfg); const item = state.items.find(i => i.id === (body || {}).id);
  const saved = applyAction(cfg, state, body);
  if (body.type === 'zernio-send' || body.type === 'zernio-retry') {
    const ids = body.type === 'zernio-retry' ? [body.submission] : saved.zernio.posts.filter(p => p.state === 'prepared' && body.destinations.includes(p.platform)).map(p => p.id);
    const work = zernio.send(cfg, item.id, { update: updateManifest, ids }); if (wait) await work; else work.catch(() => {});
    if (body.type === 'zernio-retry') return 'Retry recorded for this destination only, with its saved video and text.';
    return body.mode === 'schedule' ? 'Recorded. Sending the schedule to Zernio now; once Zernio accepts it, this PC can be off.' : 'Recorded. Sending to Zernio now.';
  }
  if (body.type === 'zernio-check') { await zernio.check(cfg, item.id, { update: updateManifest }); return 'Status checked with Zernio.'; }
  if (body.type === 'zernio-draft') return 'Text saved. Nothing was sent.';
  const upload = () => {
    const kw = item.resource.keyword, sha = item.resource.sha; cfg.runtime.uploads[kw] = true;
    const done = runUpload(cfg, kw).then(r => { delete cfg.runtime.uploads[kw]; const st = classifyUpload(r); updateManifest(cfg, item.id, m => { m.upload = { state: st, code: r.code, log: r.log, sha, at: new Date().toISOString() }; }); liveAfterUpload(cfg, item, st); });
    return wait ? done : (done.catch(() => { delete cfg.runtime.uploads[kw]; }), null);
  };
  const job = (kind, title, prompt, command) => {
    const q = queueMission(cfg, title, prompt);
    if (q.queued) { updateManifest(cfg, item.id, m => { (m.jobs ||= []).push({ id: q.id, kind, title, at: new Date().toISOString() }); }); return 'Recorded, and the job is queued in ClaudeClaw.'; }
    return `Recorded. No job was started (${q.reason}). Paste this into Claude Code: ${command}`;
  };
  if (body.type === 'approve-pdf') return 'Approved: this exact file. Nothing was uploaded.';
  if (body.type === 'check-upload') {
    const result = checkUpload(cfg, item.resource);
    const status = classifyUpload(result);
    updateManifest(cfg, item.id, manifest => { manifest.upload = { state: status, code: result.code, log: result.log, sha: item.resource.sha, at: new Date().toISOString() }; });
    const live = liveAfterUpload(cfg, item, status);
    return status === 'uploaded' ? `Verified: the approved PDF is on Gumroad and listed on a content page.${live ? ` Keyword ${item.resource.keyword} is now live.` : ''}` : 'Upload status checked. See the log; nothing was uploaded.';
  }
  if (body.type === 'upload-pdf' || body.type === 'retry-upload') { await upload(); return 'Uploading this exact approved PDF to Gumroad now.'; }
  if (body.type === 'decide' && body.version) return job('approve', `Approve reel ${item.reel} version ${body.version} (${item.batch})`, approvalPrompt(item, body.version), approvalCommand(item, body.version));
  if (body.type === 'decide') return 'Choice cleared.';
  if (body.type === 'feedback') return 'Feedback recorded against this version. Nothing has started.';
  if (body.type === 'approve-external') { const f = buildState(cfg).items.find(i => i.id === item.id)?.project?.finalFile || ''; return `Approved the outside edit. That exact file is now ${f.replace(`video-projects/${item.project.slug}/`, '')}; a kept copy is in renders/approved/.`; }
  if (body.type === 'restore-external') return 'Restored the approved outside edit from its kept copy. The approval is unchanged.';
  if (body.type === 'approve-hook') return 'Hook approved and saved in reel.json. The rest of the reel can now be built.';
  if (body.type === 'approve-candidate') return item.candidate.restore ? 'Restored the approved final video. The original approval is unchanged.' : 'Approved. That exact file is now ' + item.project.finalFile.replace(`video-projects/${item.project.slug}/`, '') + '.';
  if (body.type === 'start-revision' && item.feedback[body.index].asset !== 'pdf') return `Revision marked as started. Video work runs in Claude Code, so paste this there: ${item.feedback[body.index].command}`;
  if (body.type === 'start-revision') { const f = item.feedback[body.index]; return job('revise-pdf', `Revise PDF guide ${item.resource.keyword}`, revisionPrompt(item.resource.keyword, f.text), revisionPrompt(item.resource.keyword, f.text)); }
  if (body.type === 'withdraw-feedback') return 'Feedback withdrawn.';
  if (body.type === 'publish') return body.platform === 'instagram' ? 'Recorded. Shorts and TikTok now have a due date.' : 'Recorded for this platform only.';
  if (body.type === 'unpublish') return 'Record withdrawn.';
  if (body.type === 'confirm-post') return 'Confirmed in ig-insights. This post now counts as published.';
  if (body.type === 'resource-status') return body.to === 'live' ? `Keyword ${item.resource.keyword} is now live in resources.md.` : `Keyword ${item.resource.keyword} is back to draft in resources.md.`;
  return 'Saved';
}

const TYPES = { '.mp4': 'video/mp4', '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
const MEDIA_TYPES = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac' };

// raw-media is private. A file there is served only if you linked it to a project in the dashboard.
export function linkedMedia(cfg, p) {
  if (typeof p !== 'string' || !p.startsWith('raw-media/') || p.includes('\0')) return null;
  const name = p.slice('raw-media/'.length); const type = MEDIA_TYPES[extname(name).toLowerCase()]; if (!type) return null;
  const linked = Object.values(readManifests(cfg)).some(m => m.links && (m.links.voiceover === name || m.links.footage === name));
  if (!linked) return null;
  const full = resolve(cfg.rawMedia, name); if (!full.startsWith(resolve(cfg.rawMedia) + sep)) return null;
  try { const st = statSync(full); return st.isFile() ? { full, size: st.size, type } : null; } catch { return null; }
}

// Only finished assets may be served, and only from the folders that hold them.
export function safeFile(cfg, p) {
  if (typeof p !== 'string' || !p || p.includes('\0')) return null;
  const type = TYPES[extname(p).toLowerCase()]; if (!type) return null;
  const full = resolve(cfg.root, p);
  const roots = [cfg.projectsDir, join(cfg.scriptsOut, 'resources')].map(r => resolve(r) + sep);
  if (!roots.some(r => full.startsWith(r))) return null;
  try { const st = statSync(full); return st.isFile() ? { full, size: st.size, type } : null; } catch { return null; }
}

// ---- phone access over home Wi-Fi (only when started with DASH_LAN=1) ----
const loopback = a => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
const privateNet = a => { const v = String(a || '').replace(/^::ffff:/, ''); return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(v) || /^(fe80|f[cd])/i.test(v); };
export const lanAddresses = () => Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal && privateNet(i.address)).map(i => i.address);
export function phoneToken(cfg) {
  if (existsSync(cfg.tokenFile)) { const t = readFileSync(cfg.tokenFile, 'utf8').trim(); if (/^[A-Za-z0-9_-]{40,}$/.test(t)) return t; }
  const t = randomBytes(32).toString('base64url'); mkdirSync(dirname(cfg.tokenFile), { recursive: true }); writeFileSync(cfg.tokenFile, t + '\n'); return t;
}
const sameToken = (a, b) => { const h = x => createHash('sha256').update(String(x)).digest(); return !!a && !!b && timingSafeEqual(h(a), h(b)); };
const REMOTE_ACTIONS = ['publish', 'unpublish', 'confirm-post']; // a phone records publication; everything else stays on the PC

// Who is asking: 'local' (this PC), 'remote' (a device on the home network holding the token), or a refusal.
export function classify(cfg, req, u) {
  const host = String(req.headers.host || '').replace(/:\d+$/, ''); const addr = req.socket.remoteAddress;
  if (loopback(addr)) return ['127.0.0.1', 'localhost'].includes(host) ? { who: 'local' } : { refuse: 'Local access only' };
  if (!cfg.lan || !cfg.token) return { refuse: 'Local access only' };
  if (!privateNet(addr) || !lanAddresses().includes(host)) return { refuse: 'Home network only' };
  const cookie = (/(?:^|;\s*)dash_k=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '') || [])[1];
  if (sameToken(cookie, cfg.token)) return { who: 'remote' };
  if (sameToken(u.searchParams.get('k'), cfg.token)) return { who: 'remote', setCookie: true };
  return { refuse: 'Open the link shown in the dashboard window on your PC' };
}

export function createServer(cfg) {
  const page = () => readFileSync(join(import.meta.dirname, 'public', 'index.html'));
  const send = (res, code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  return http.createServer((req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost');
      // Requests must come from this PC, or from the home network with the token, and writes from the dashboard page itself.
      const c = classify(cfg, req, u); if (c.refuse) return send(res, 403, { error: c.refuse });
      const remote = c.who === 'remote';
      if (c.setCookie) { res.writeHead(303, { location: '/', 'set-cookie': `dash_k=${cfg.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`, 'cache-control': 'no-store' }); return res.end(); }
      if (req.method === 'GET' && u.pathname === '/') return send(res, 200, page(), 'text/html; charset=utf-8');
      if (req.method === 'GET' && u.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
      if (req.method === 'GET' && u.pathname === '/api/state') return send(res, 200, { ...buildState(cfg), remote });
      if (req.method === 'GET' && u.pathname === '/api/item') { const d = itemDetail(cfg, buildState(cfg), u.searchParams.get('id')); return d ? send(res, 200, d) : send(res, 404, { error: 'Unknown project' }); }
      // Research: these GET routes only read reels-data/research/. New research runs in Claude Code. Saved ideas
      // and the short-form export go through POST /api/research/action below, on the PC only.
      if (req.method === 'GET' && STATIC[u.pathname]) return send(res, 200, readFileSync(join(import.meta.dirname, 'public', u.pathname.slice(1))), STATIC[u.pathname]);
      if (req.method === 'GET' && u.pathname === '/api/research') return send(res, 200, { ...researchList(cfg, Object.fromEntries(u.searchParams)), ideaPosts: readIdeas(cfg).map(i => i.postId), remote });
      // The current Research table as a CSV download (read-only; opens in Excel).
      if (req.method === 'GET' && u.pathname === '/api/research/export.csv') {
        const f = Object.fromEntries(u.searchParams); const name = `research-${['short', 'long', 'unknown'].includes(f.format) ? f.format : 'short'}-${new Date().toISOString().slice(0, 10)}.csv`;
        res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        return res.end(researchCsv(cfg, f));
      }
      if (req.method === 'GET' && u.pathname === '/api/research/searches') return send(res, 200, { searches: researchSearches(cfg) });
      if (req.method === 'GET' && u.pathname === '/api/research/post') { const d = researchPost(cfg, u.searchParams.get('id'), u.searchParams.get('q')); return d ? send(res, 200, { ...d, ...ideaInfo(cfg, d, readIdeas(cfg).find(i => i.postId === d.id), buildState(cfg).items), remote }) : send(res, 404, { error: 'Unknown post' }); }
      // Zernio: connected accounts and their health, read-only. Keys stay on the server.
      if (req.method === 'GET' && u.pathname === '/api/zernio/accounts') { zernio.accounts(cfg, { fresh: u.searchParams.get('fresh') === '1' && !remote }).then(d => send(res, 200, d), e => send(res, 502, { error: zernio.scrub(e.message) })); return; }
      if (req.method === 'GET' && u.pathname === '/api/research/ideas') return send(res, 200, { ideas: ideasView(cfg, buildState(cfg).items), remote });
      if (req.method === 'GET' && u.pathname === '/file') {
        const f = safeFile(cfg, u.searchParams.get('p')) || (remote ? null : linkedMedia(cfg, u.searchParams.get('p'))); if (!f) return send(res, 404, { error: 'Not available' });
        const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || ''); const head = { 'content-type': f.type, 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
        if (u.searchParams.get('dl') === '1') { const n = (basename(f.full) === 'final.mp4' ? basename(dirname(dirname(f.full))) + '.mp4' : basename(f.full)).replace(/[^A-Za-z0-9 ._-]/g, '_'); head['content-disposition'] = `attachment; filename="${n}"`; }
        if (m && (m[1] || m[2])) {
          let start = m[1] ? Number(m[1]) : Math.max(0, f.size - Number(m[2])); let end = m[1] && m[2] ? Math.min(Number(m[2]), f.size - 1) : f.size - 1;
          if (start > end || start >= f.size) { res.writeHead(416, { 'content-range': `bytes */${f.size}` }); return res.end(); }
          res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${f.size}`, 'content-length': end - start + 1 });
          return createReadStream(f.full, { start, end }).pipe(res);
        }
        res.writeHead(200, { ...head, 'content-length': f.size }); return createReadStream(f.full).pipe(res);
      }
      if (req.method === 'POST' && (u.pathname === '/api/action' || u.pathname === '/api/research/action')) {
        const research = u.pathname === '/api/research/action';
        const origin = req.headers.origin;
        if (origin && origin !== 'http://' + req.headers.host) return send(res, 403, { error: 'Cross-site request refused' });
        if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'JSON only' });
        let body = ''; req.on('data', c => { body += c; if (body.length > 65536) req.destroy(); });
        req.on('end', () => { let parsed; try { parsed = JSON.parse(body); } catch { return send(res, 400, { error: 'Bad request' }); } if (remote && (research || !REMOTE_ACTIONS.includes((parsed || {}).type))) return send(res, 403, { error: 'Do this one on the PC. The phone can only record what you published.' });
          if (research) { try { return send(res, 200, { ok: true, ...ideaAction(cfg, parsed) }); } catch (e) { return send(res, 400, { error: e.message }); } }
          handleAction(cfg, parsed).then(message => send(res, 200, { ok: true, message }), e => send(res, 400, { error: e.message })); });
        return;
      }
      send(res, 404, { error: 'Not found' });
    } catch (e) { send(res, 500, { error: e.message }); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const cfg = loadConfig();
  probeQueue(cfg); setInterval(() => probeQueue(cfg), 30000).unref();
  if (cfg.lan) cfg.token = phoneToken(cfg);
  createServer(cfg).listen(cfg.port, cfg.host, () => {
    console.log(`Content dashboard: http://localhost:${cfg.port}  (reading ${cfg.root})`);
    if (cfg.lan) { const ips = lanAddresses(); console.log(ips.length ? 'Phone, on the same Wi-Fi (keep this link private):\n' + ips.map(ip => `  http://${ip}:${cfg.port}/?k=${cfg.token}`).join('\n') : 'Phone access is on, but no home-network address was found.'); }
  });
}
