// Instagram view for the dashboard. Reads ig-insights' own history (reels-data/insights/), never edits it.
// The Refresh button runs ig-insights' collector (GET requests to Instagram only, which appends one new
// snapshot run as that skill always does) and then `link.py propose` so new posts get link proposals.
// The written weekly report (sections 8 to 10) still comes from /ig-insights in Claude Code.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, sep, extname } from 'node:path';
import { spawn } from 'node:child_process';

const lines = f => { try { return readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const jsonl = dir => { try { return readdirSync(dir).filter(n => n.endsWith('.jsonl')).sort().flatMap(n => lines(join(dir, n))); } catch { return []; } };

export function insightsView(cfg) {
  const dir = cfg.insightsDir;
  const snaps = jsonl(join(dir, 'snapshots'));
  const runs = [...new Set(snaps.map(s => s.run_id))].sort();
  const last = runs.at(-1), prev = runs.at(-2);
  const prevBy = new Map(snaps.filter(s => s.run_id === prev).map(s => [s.media_id, s]));
  let links = {}; try { links = JSON.parse(readFileSync(cfg.linksJson, 'utf8')).entries || {}; } catch {}
  const reels = snaps.filter(s => s.run_id === last).map(s => {
    const m = s.metrics || {}, p = prevBy.get(s.media_id), l = links[s.media_id];
    return {
      id: s.media_id, url: s.permalink, publishedAt: s.published_at, ageHours: s.age_hours,
      title: String(s.caption || '').split('\n').find(Boolean)?.slice(0, 90) || '(no caption)',
      views: m.views ?? null, viewsBefore: p && p.metrics ? p.metrics.views ?? null : null,
      reach: m.reach ?? null, skipRate: m.reels_skip_rate ?? null,
      avgWatch: m.ig_reels_avg_watch_time != null ? m.ig_reels_avg_watch_time / 1000 : null,
      likes: m.likes ?? null, comments: m.comments ?? null, saves: m.saved ?? null, shares: m.shares ?? null,
      missing: Object.keys(s.unavailable || {}),
      project: l && l.project ? l.project.slug : null, link: l ? l.status : null,
    };
  }).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const acct = jsonl(join(dir, 'account')).at(-1) || null;
  const account = acct ? { takenAt: acct.taken_at, followers: acct.profile?.followers_count ?? null, media: acct.profile?.media_count ?? null, d7: acct.windows?.['7d'] || null, d28: acct.windows?.['28d'] || null } : null;
  let reports = [];
  try { reports = readdirSync(join(dir, 'reports')).filter(n => /^[\w.-]+\.html$/.test(n)).map(n => ({ name: n, at: statSync(join(dir, 'reports', n)).mtime.toISOString() })).sort((a, b) => b.at.localeCompare(a.at)); } catch {}
  const r = cfg.runtime.insights || null;
  return {
    takenAt: last ? snaps.find(s => s.run_id === last).taken_at : null,
    previousAt: prev ? snaps.find(s => s.run_id === prev).taken_at : null,
    reels, account, reports, refresh: r && { running: r.running, startedAt: r.startedAt, finishedAt: r.finishedAt, ok: r.ok, message: r.message, log: r.log },
  };
}

// A report page or the frame thumbnails it points to (../frames/<slug>/<file>.png). Nothing else.
const ASSET_TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg' };
export function insightsAsset(cfg, path) {
  const m = /^\/insights\/(reports\/[\w.-]+\.html|frames\/[\w.-]+\/[\w.-]+\.(?:png|jpg))$/.exec(path); if (!m) return null;
  const base = resolve(cfg.insightsDir) + sep, full = resolve(cfg.insightsDir, m[1]);
  if (!full.startsWith(base) || !existsSync(full)) return null;
  return { full, type: ASSET_TYPES[extname(full).toLowerCase()] };
}

const run = (cmd, args, cwd, ms) => new Promise(done => {
  let out = ''; let p;
  try { p = spawn(cmd, args, { cwd, windowsHide: true }); } catch (e) { return done({ code: -1, out: e.message }); }
  const t = setTimeout(() => { p.kill(); out += '\nStopped: took longer than ' + ms / 60000 + ' minutes.'; }, ms);
  p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
  p.on('error', e => { clearTimeout(t); done({ code: -1, out: out + '\n' + e.message }); });
  p.on('close', code => { clearTimeout(t); done({ code, out }); });
});
const tail = s => s.replace(/access_token=[^&\s"]+/gi, 'access_token=[hidden]').split(/\r?\n/).filter(l => l.trim()).slice(-30).join('\n');

export function refreshInsights(cfg) {
  const r = cfg.runtime.insights;
  if (r && r.running) return { started: false, message: 'A refresh is already running.' };
  const state = cfg.runtime.insights = { running: true, startedAt: new Date().toISOString(), finishedAt: null, ok: null, message: 'Reading Instagram…', log: '' };
  const work = (async () => {
    const c = await run(cfg.collectCommand[0], cfg.collectCommand.slice(1), cfg.root, 5 * 60000);
    state.log = 'collect.ps1\n' + tail(c.out);
    if (c.code !== 0) { Object.assign(state, { running: false, ok: false, finishedAt: new Date().toISOString(), message: 'Instagram could not be read (collect.ps1 exit code ' + c.code + '). See the log.' }); return; }
    state.message = 'Proposing links for new posts…';
    const l = await run(cfg.linkCommand[0], [...cfg.linkCommand.slice(1), 'propose'], cfg.root, 2 * 60000);
    state.log += '\n\nlink.py propose\n' + tail(l.out);
    Object.assign(state, { running: false, ok: l.code === 0, finishedAt: new Date().toISOString(), message: l.code === 0 ? 'Updated from Instagram.' : 'Numbers updated, but link proposals failed (link.py exit code ' + l.code + ').' });
  })();
  work.catch(e => Object.assign(state, { running: false, ok: false, finishedAt: new Date().toISOString(), message: e.message }));
  return { started: true, work, message: 'Refreshing from Instagram. This takes a minute or two.' };
}
