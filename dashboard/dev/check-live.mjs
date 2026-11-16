// Dev check: starts the real dashboard on a spare port, looks at it in headless Edge, tests the server guards, and
// stops it. Sends no actions, so it changes nothing. Run: node dashboard/dev/check-live.mjs
// Screenshots go to the system temp folder (path printed at the end). Uses the repo's Playwright with installed Edge.
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { loadConfig } = await import('../lib/config.mjs');
const { createServer, lanAddresses } = await import('../server.mjs');
const out = join(tmpdir(), 'content-dashboard-check'); mkdirSync(out, { recursive: true });
const cfg = loadConfig(); const srv = createServer(cfg); await new Promise(r => srv.listen(4399, '127.0.0.1', r));
const base = 'http://localhost:4399'; const rep = [];
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
for (const [name, w, h] of [['desk', 1280, 900], ['phone', 390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(base); await page.waitForSelector('.task, .sub');  await page.waitForTimeout(400);
  const snap = async l => { const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); rep.push(`${name}-${l}: overflowX=${o}`); await page.screenshot({ path: join(out, `${name}-${l}.png`), fullPage: true }); };
  await snap('attention');
  await page.click('button[data-view="pipeline"]'); await snap('pipeline');
  await page.click('button[data-view="schedule"]'); await snap('schedule');
  if (name === 'desk') {
    await page.click('button[data-view="pipeline"]'); await page.click('button[data-all="1"]'); // finished reels leave the Active list
    for (const [label, title, tabs] of [['approved', 'Anthropic Engineers', ['scripts', 'resource', 'recording', 'video', 'publish']], ['choose', 'Elephant Goldfish', ['scripts']], ['proposal', 'Founder Skill', ['video', 'publish']], ['published', 'Make Animated Reels', ['resource', 'publish']], ['candidate', 'Mythos Glasswing', ['video']], ['hook-not-ready', 'Reverse Engineer Feature', ['video']]]) {
      await page.locator('.prow', { hasText: title }).first().click(); await page.waitForTimeout(700);
      for (const t of tabs) { await page.click(`[data-tab-go="${t}"]`); await page.waitForTimeout(300); await snap(`${label}-${t}`); }
      if (label === 'approved') { await page.click('[data-tab-go="video"]'); const ok = await page.evaluate(() => new Promise(r => { const v = document.querySelector('video'); if (!v) return r('no video element'); if (v.readyState >= 1) return r('metadata ' + Math.round(v.duration) + 's'); v.onloadedmetadata = () => r('metadata ' + Math.round(v.duration) + 's'); v.onerror = () => r('error'); setTimeout(() => r('timeout'), 6000); })); rep.push('video: ' + ok); }
      if (label === 'published') { // open the forms without saving: these clicks only change what the page shows
        await page.click('[data-pubopen="yt"]'); await page.waitForTimeout(200); await snap('published-publish-form'); rep.push('publish form: ' + await page.evaluate(() => !!document.getElementById('pubat').value && !!document.querySelector('[data-pubsave="yt"]'))); await page.click('[data-pubopen=""]');
        await page.click('[data-tab-go="resource"]'); const lb = await page.$('[data-liveopen="1"]'); if (lb) { await lb.click(); await page.waitForTimeout(200); await snap('published-resource-live-form'); await page.click('[data-liveopen="0"]'); } rep.push('mark-live control offered: ' + !!lb);
      }
      await page.click('.back');
    }
  }
  rep.push(`${name}: console errors=${errs.length}${errs.length ? ' ' + errs.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}
// guards on the live server
const get = async (p, h) => { const r = await fetch(base + p, { headers: h || {} }); return r.status; };
rep.push('GET /file .env -> ' + await get('/file?p=.env'));
rep.push('GET /file reel.json -> ' + await get('/file?p=video-projects/founder-100-buyers/reel.json'));
rep.push('GET /file raw-media -> ' + await get('/file?p=' + encodeURIComponent('raw-media/Stop building AI agents for every job_1080p.mp4')));
rep.push('GET /file range -> ' + await get('/file?p=video-projects/founder-100-buyers/renders/final.mp4', { range: 'bytes=0-99' }));
const post = await fetch(base + '/api/action', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.com' }, body: '{}' }); rep.push('POST cross-site -> ' + post.status);
// phone access: a second server on the home-network address with a throwaway token. Nothing is saved; the one POST is refused before it is handled.
const ip = lanAddresses()[0];
if (!ip) rep.push('phone: no home-network address on this PC, not checked');
else {
  const tok = 'check' + Math.random().toString(36).slice(2).padEnd(40, 'x'); const srv2 = createServer({ ...cfg, lan: true, token: tok }); await new Promise(r => srv2.listen(4398, '0.0.0.0', r));
  const lan = `http://${ip}:4398`; const ck = { cookie: 'dash_k=' + tok }; const st = async (p, o) => (await fetch(lan + p, o)).status;
  rep.push('phone: no token -> ' + await st('/')); rep.push('phone: wrong token -> ' + await st('/?k=' + 'z'.repeat(45)));
  const first = await fetch(lan + '/?k=' + tok, { redirect: 'manual' }); rep.push(`phone: token -> ${first.status}, cookie set=${/dash_k=/.test(first.headers.get('set-cookie') || '')}`);
  rep.push('phone: state says remote=' + (await (await fetch(lan + '/api/state', { headers: ck })).json()).remote);
  rep.push('phone: raw-media -> ' + await st('/file?p=' + encodeURIComponent('raw-media/Stop building AI agents for every job_1080p.mp4'), { headers: ck }));
  const dl = await fetch(lan + '/file?p=video-projects/founder-100-buyers/renders/final.mp4&dl=1', { headers: { ...ck, range: 'bytes=0-99' } }); rep.push(`phone: download -> ${dl.status} ${dl.headers.get('content-disposition')}`);
  const refused = await fetch(lan + '/api/action', { method: 'POST', headers: { ...ck, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'none', type: 'hide', hidden: true }) }); rep.push(`phone: PC-only action -> ${refused.status} ${(await refused.json()).error}`);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(lan + '/?k=' + tok); await page.waitForSelector('.task, .sub'); await page.click('button[data-view="pipeline"]');
  await page.locator('.prow', { hasText: 'Make Animated Reels' }).first().click(); await page.waitForTimeout(700); await page.click('[data-tab-go="publish"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, 'phone-lan-publish.png'), fullPage: true });
  rep.push('phone: page url=' + new URL(page.url()).pathname + new URL(page.url()).search + ' secure context=' + await page.evaluate(() => window.isSecureContext) + ' overflowX=' + await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
  await page.locator('[data-copy]').first().click(); await page.waitForTimeout(300); rep.push('phone: copy button says "' + await page.locator('#toast').textContent() + '"');
  rep.push('phone: download link present=' + !!(await page.$('a[href*="dl=1"]')) + ' page errors=' + errs.length);
  await ctx.close(); srv2.close();
}
await browser.close(); srv.close(); console.log(rep.join('\n')); console.log('Screenshots: ' + out);
