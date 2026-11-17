// Dev check for the Research page: starts the real dashboard on a spare port, drives it in headless Edge at desktop
// and phone widths, and saves screenshots. It sends no actions, so it changes nothing. The main pass uses a
// throwaway store (fixed content); a short pass opens the real store and checks it renders without errors.
// Run: node dashboard/dev/check-research.mjs   (screenshots: tmp/research-ui/)
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { loadConfig } = await import('../lib/config.mjs');
const { createServer } = await import('../server.mjs');
const { importBatch } = await import('../lib/research.mjs');

const out = join(import.meta.dirname, '..', '..', 'tmp', 'research-ui'); mkdirSync(out, { recursive: true });
const rep = []; const ok = (name, pass, extra = '') => rep.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const listen = (cfg, port) => new Promise(r => { const s = createServer(cfg); s.listen(port, '127.0.0.1', () => r(s)); });

async function session(base, name, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(base); await page.waitForSelector('#nav button');
  const shot = async label => { const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(`${name} ${label}: no sideways page scroll`, o <= 0, 'overflowX=' + o); await page.screenshot({ path: join(out, `${name}-${label}.png`), fullPage: true }); };
  const text = () => page.evaluate(() => document.querySelector('#app').innerText);
  const settle = () => page.waitForTimeout(350);
  const rows = () => page.evaluate(() => [...document.querySelectorAll('.r-metrics:not(details .r-metrics) tbody tr')].map(tr => tr.querySelector('.r-open').innerText));
  return { page, shot, text, settle, rows, errs, close: () => ctx.close() };
}

// ---------- throwaway store ----------
const cfg = loadConfig({ root: mkdtempSync(join(tmpdir(), 'research-ui-')) });
const now = new Date(), iso = d => d.toISOString().replace(/\.\d+Z$/, 'Z'), daysAgo = n => iso(new Date(now - n * 86400e3));
const tt = (i, extra = {}) => ({ platform: 'tiktok', id: String(7708502162103438000n + BigInt(i)), provider: 'last30free', url: `https://www.tiktok.com/@maker/video/${7708502162103438000n + BigInt(i)}`, format: 'short', creator: { handle: 'maker' }, title: `TikTok post ${i}`, publishedAt: daysAgo(2 + (i % 20)), durationSeconds: 30,
  observation: { measuredAt: daysAgo(1), measuredBasis: 'collection', metrics: { views: 1000 * (i + 1), likes: 50 * (i + 1), comments: 5 * (i + 1), shares: i % 3 ? 2 * i : null }, discoveryScore: 5 + i / 10, scoreFormula: 'l30-tiktok-v1' }, ...extra });
const tiktoks = Array.from({ length: 55 }, (_, i) => tt(i));
const kept = tt(99, { title: 'Older TikTok kept from the same run', publishedAt: daysAgo(80) });
importBatch(cfg, { schema: 1, batchId: 'fixture-1', retrievedAt: daysAgo(1), search: { query: 'n8n', windowDays: 30 }, posts: [...tiktoks, kept,
    { platform: 'instagram', id: '3802204658396629750', provider: 'signal-room', url: 'https://www.instagram.com/p/DTEJP3rEQr2/', format: 'short', title: 'Instagram reel about n8n', publishedAt: daysAgo(3), observation: { measuredAt: daysAgo(1), metrics: { plays: 90000, likes: 900, comments: 40, shares: 300 } } },
    { platform: 'instagram', id: '3803030861483167224', provider: 'signal-room', url: 'https://www.instagram.com/p/DTHFGtQjU34/', format: 'short', title: 'Reel with no publication date', publishedAt: null, observation: null },
    { platform: 'youtube', id: 'ynEEbqKQSaY', provider: 'last30free', url: 'https://www.youtube.com/watch?v=ynEEbqKQSaY', format: 'long', title: 'Long n8n tutorial', publishedAt: daysAgo(4), durationSeconds: 900, observation: { measuredAt: daysAgo(1), metrics: { views: 5000, likes: 100, comments: 20 }, discoveryScore: 9 } }],
  runs: [{ provider: 'last30free', lane: 'tiktok_hashtag', status: 'ok', results: tiktoks.map(p => `tiktok:${p.id}`), fetchedOnly: [`tiktok:${kept.id}`], counts: { fetched: 56 }, cost: { run_id: 'RUN1', status: 'SUCCEEDED', charged_usd: 0.19 } },
    { provider: 'signal-room', lane: 'instagram_short_form', status: 'ok', results: ['instagram:3802204658396629750', 'instagram:3803030861483167224'] },
    { provider: 'last30free', lane: 'youtube_discovery', status: 'ok', results: ['youtube:ynEEbqKQSaY'] }] });
importBatch(cfg, { schema: 1, batchId: 'fixture-2', retrievedAt: iso(now), search: { query: 'n8n', windowDays: 30 }, runs: [{ provider: 'signal-room', lane: 'instagram_short_form', status: 'ok', results: [] }, { provider: 'last30free', lane: 'tiktok_hashtag', status: 'error', error: 'TikTok search failed: timeout', results: [] }], posts: [] });
const fx = await listen(cfg, 4396);
for (const [name, w, h] of [['desk', 1280, 900], ['phone', 390, 844]]) {
  const s = await session('http://localhost:4396', name, w, h); const { page } = s;
  await page.click('button[data-view="research"]'); await page.waitForSelector('#r-form'); await s.settle(); let t = await s.text();
  ok(`${name}: opens on Short-form, last 30 days, sorted by average views per day`, await page.evaluate(() => document.querySelector('[data-r-format="short"]').getAttribute('aria-current') === 'true' && document.querySelector('#r-window').value === '30' && document.querySelector('#r-sort').value === 'speed'));
  let r = await s.rows();
  ok(`${name}: the list is the top 50, with more on request`, r.length === 50 && /6 more match these filters/.test(t), `${r.length} rows`);
  ok(`${name}: metric columns are present and an unknown share reads as a dash`, await page.evaluate(() => ['Views', 'Avg views/day', 'Likes', 'Comments', 'Shares', 'Engagement', 'Share rate', 'Score', 'Growth', 'Last checked'].every(h => [...document.querySelectorAll('.r-metrics th')].some(th => th.innerText.trim() === h)) && [...document.querySelectorAll('td[data-label="Shares"]')].some(td => td.innerText.trim() === '–')));
  ok(`${name}: the undated reel and the older kept TikTok are counted, not listed`, /1 published before the last 30 days and 1 with no publication date/.test(t), (t.match(/Not listed:[^\n]*/) || [''])[0]);
  ok(`${name}: the failed TikTok run is said plainly while earlier finds stay listed`, /TikTok hashtag did not run/.test(t) && r.some(x => /TikTok post/.test(x)));
  await s.shot('short-30-days');
  await page.click('[data-r-more]'); await s.settle(); r = await s.rows();
  ok(`${name}: Show more adds the rest`, r.length === 56, `${r.length} rows`);
  if (name === 'desk') {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('a[href^="/api/research/export.csv"]')]);
    const csv = await (await import('node:fs')).promises.readFile(await dl.path(), 'utf8');
    ok(`${name}: Export CSV downloads the whole filtered table`, /^research-short-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()) && csv.trim().split(/\r?\n/).length === 57, dl.suggestedFilename());
  }
  await page.selectOption('#r-sort', 'score'); await s.settle(); t = await s.text();
  ok(`${name}: score on a mixed list asks for a platform`, /Scores are only comparable within one platform/.test(t));
  await page.selectOption('#r-platform', 'tiktok'); await s.settle(); t = await s.text(); r = await s.rows();
  ok(`${name}: score within TikTok sorts by score`, !/Scores are only comparable/.test(t) && r[0] === 'TikTok post 54', r[0]);
  await page.click('[data-r-format="long"]'); await s.settle(); r = await s.rows();
  ok(`${name}: the Long-form tab keeps the platform filter`, r.length === 0 && /No saved long-form post matches/.test(await s.text()));
  await page.click('[data-r-reset]'); await s.settle(); await page.click('[data-r-format="long"]'); await s.settle(); r = await s.rows();
  ok(`${name}: Long-form lists the YouTube tutorial`, r.length === 1 && r[0] === 'Long n8n tutorial');
  await page.click('[data-r-format="short"]'); await s.settle();
  await page.click('[data-r-window="all"]'); await s.settle(); t = await s.text();
  ok(`${name}: "Show any date" lists the older kept post and keeps the undated one apart`, (await s.rows()).includes('Older TikTok kept from the same run') && /1 with no publication date/.test(t));
  await page.locator('.r-open', { hasText: 'Older TikTok kept' }).first().click(); await page.waitForSelector('#r-title'); await s.settle(); t = await s.text();
  ok(`${name}: a kept post's page says it was fetched and kept, not a top match`, /Fetched and kept, not in the top matches/.test(t));
  await page.click('[data-r-back]'); await s.settle();
  await page.click('[data-r-tab="searches"]'); await page.waitForSelector('[data-r-show]'); await s.settle(); t = await s.text();
  ok(`${name}: Searches shows kept posts and the Apify charge`, /\+ 1 more fetched and kept/.test(t) && /Apify charge \$0\.190/.test(t) && /TikTok search failed: timeout/.test(t));
  await s.shot('searches');
  await page.click('[data-r-tab="signals"]'); await page.waitForSelector('#r-form'); await s.settle();
  const a11y = await page.evaluate(() => { const r = document.querySelector('#research-root'); const ctl = [...r.querySelectorAll('button,select,input:not([type=hidden]),a,summary')];
    return { unnamed: ctl.filter(c => !(c.textContent.trim() || c.getAttribute('aria-label') || (c.id && document.querySelector(`label[for="${c.id}"]`)))).length, small: innerWidth < 500 ? ctl.filter(c => { const b = c.getBoundingClientRect(); return b.height > 0 && b.height < 44; }).map(c => (c.innerText || c.id).slice(0, 30) + ':' + Math.round(c.getBoundingClientRect().height)) : [] }; });
  ok(`${name}: every control has a name`, a11y.unnamed === 0, JSON.stringify(a11y));
  if (name === 'phone') ok('phone: every Research control is at least 44px tall', a11y.small.length === 0, a11y.small.join(', '));
  ok(`${name}: no console or page errors`, s.errs.length === 0, s.errs.slice(0, 3).join(' | '));
  await s.close();
}
fx.close();

// ---------- the real store: it renders, without errors ----------
const real = await listen(loadConfig(), 4397);
for (const [name, w, h] of [['real-desk', 1280, 900], ['real-phone', 390, 844]]) {
  const s = await session('http://localhost:4397', name, w, h); const { page } = s;
  await page.click('button[data-view="research"]'); await page.waitForSelector('#r-form'); await s.settle();
  ok(`${name}: the real store lists short-form posts`, (await s.rows()).length > 0, `${(await s.rows()).length} rows`);
  await s.shot('short-30-days');
  for (const v of ['attention', 'pipeline', 'schedule']) { await page.click(`button[data-view="${v}"]`); await s.settle(); ok(`${name}: ${v} view still renders`, await page.evaluate(() => !!document.querySelector('#app h2') && !document.querySelector('#research-root'))); }
  ok(`${name}: no console or page errors`, s.errs.length === 0, s.errs.slice(0, 3).join(' | '));
  await s.close();
}
real.close(); await browser.close();
console.log(rep.join('\n')); console.log(`\n${rep.filter(r => r.startsWith('PASS')).length} passed, ${rep.filter(r => r.startsWith('FAIL')).length} failed. Screenshots: ${out}`);
process.exit(rep.some(r => r.startsWith('FAIL')) ? 1 : 0);
