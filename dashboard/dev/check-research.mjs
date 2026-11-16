// Dev check for the Research page: starts the real dashboard on a spare port, drives it in headless Edge at desktop
// and phone widths, and saves screenshots. It sends no actions, so it changes nothing. A second pass uses a
// throwaway store to show an unknown publication date and a failed source.
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
  const shot = async label => { const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(`${name} ${label}: no sideways scroll`, o <= 0, 'overflowX=' + o); await page.screenshot({ path: join(out, `${name}-${label}.png`), fullPage: true }); };
  const text = () => page.evaluate(() => document.querySelector('#app').innerText);
  const settle = () => page.waitForTimeout(350);
  return { page, shot, text, settle, errs, close: () => ctx.close() };
}

// ---------- real data ----------
const real = await listen(loadConfig(), 4397); const base = 'http://localhost:4397';
for (const [name, w, h] of [['desk', 1280, 900], ['phone', 390, 844]]) {
  const s = await session(base, name, w, h); const { page } = s;
  // navigation
  await page.click('button[data-view="research"]'); await page.waitForSelector('#r-form'); await s.settle();
  ok(`${name}: Research opens from the main navigation`, await page.evaluate(() => document.querySelector('button[data-view="research"]').getAttribute('aria-current') === 'true'));
  await s.shot('signals-30-days');
  let t = await s.text();
  ok(`${name}: says the filters search saved research`, /search research already saved on this PC\. They do not run a new search/.test(t) && /\/research-signals/.test(t));
  // date window: no Instagram post in the last 30 days; they stay available as historical references
  const groups = () => page.evaluate(() => [...document.querySelectorAll('.r-group')].map(g => ({ label: g.getAttribute('aria-label'), main: g.querySelectorAll(':scope > .r-frame tbody tr').length, hist: g.querySelectorAll('details.r-hist tbody tr').length, histOpen: [...g.querySelectorAll('details.r-hist')].some(d => d.open), text: g.innerText })));
  let g = await groups(); const insta = g.find(x => x.label === 'Instagram');
  ok(`${name}: Instagram shows 0 posts in the last 30 days`, insta && insta.main === 0 && /No saved Instagram post was published in the last 30 days/.test(insta.text), JSON.stringify(g.map(x => [x.label, x.main, x.hist])));
  ok(`${name}: the 8 older Instagram posts are kept as collapsed historical references`, insta && insta.hist === 8 && !insta.histOpen && /8 historical references, published before the last 30 days/.test(insta.text));
  ok(`${name}: summary counts match`, /10 published in the last 30 days · 15 older, kept as historical references/.test(t), (t.match(/\d+ published in[^\n]*/) || [''])[0]);
  // every main-list row is inside the window; unknown measurement time is said plainly
  ok(`${name}: undated measurements read "Measurement time unknown"`, /Measurement time unknown/.test(t) && /Not ranked/.test(t) && /Growth unavailable/.test(t));
  // filters
  await page.selectOption('#r-platform', 'tiktok'); await s.settle(); g = await groups();
  ok(`${name}: platform filter leaves only TikTok`, g.length === 1 && g[0].label === 'TikTok' && g[0].main === 6);
  await page.selectOption('#r-platform', ''); await page.selectOption('#r-format', 'long'); await s.settle(); g = await groups();
  ok(`${name}: format filter leaves only long-form`, g.length === 1 && g[0].label === 'YouTube long-form', JSON.stringify(g.map(x => [x.label, x.main, x.hist])));
  await page.selectOption('#r-format', ''); await page.selectOption('#r-window', 'all'); await s.settle(); g = await groups();
  ok(`${name}: "any date" brings the Instagram posts into the list`, g.find(x => x.label === 'Instagram').main === 8);
  await page.selectOption('#r-sort', 'outlier'); await s.settle();
  const firstLong = await page.evaluate(() => { const g = [...document.querySelectorAll('.r-group')].find(x => x.getAttribute('aria-label') === 'YouTube long-form'); return [...g.querySelectorAll('tbody tr')].map(r => r.querySelector('td[data-label="Creator outlier"]').innerText.replace(/\s+/g, ' ')); });
  ok(`${name}: outlier sort puts ranked posts first and unstable signals last`, /age-adjusted/.test(firstLong[0]) && /Not ranked/.test(firstLong[firstLong.length - 1]), firstLong.join(' | '));
  await page.fill('#r-q', '"claude code"'); await page.keyboard.press('Enter'); await s.settle(); t = await s.text();
  ok(`${name}: exact phrase filter works from the keyboard`, /7 of 25 saved posts match/.test(t), (t.match(/\d+ of 25 saved posts match/) || [''])[0]);
  await s.shot('signals-phrase-any-date');
  await page.fill('#r-q', 'MCP50'); await page.keyboard.press('Enter'); await s.settle();
  ok(`${name}: a word that is in no saved text finds nothing`, /No saved post matches these filters/.test(await s.text()));
  await page.click('[data-r-reset]'); await s.settle();
  ok(`${name}: Reset filters returns to the 30-day default`, await page.evaluate(() => document.querySelector('#r-window').value === '30' && document.querySelector('#r-q').value === ''));
  // detail: transcript present
  await page.selectOption('#r-search', 'n8n'); await page.selectOption('#r-window', 'all'); await s.settle();
  await page.locator('.r-open', { hasText: 'Comment “agent” to get the full Claude code + n8n guide' }).first().click(); await page.waitForSelector('#r-title'); await s.settle(); t = await s.text();
  ok(`${name}: detail shows provenance (search, run, source, position)`, /“n8n”/.test(t) && /2026-11-16-n8n/.test(t) && /1 of 8 top matches/.test(t) && /Signal Room/.test(t));
  ok(`${name}: detail separates measured and retrieved times and marks the stale measurement`, /16 Aug 2026/.test(t) && /\(stale\)/.test(t) && /reach per follower/.test(t) && /Growth unavailable/.test(t));
  ok(`${name}: detail shows the transcript with a working Copy transcript button`, /Full transcript \(spoken words\)/.test(t) && /131 words/.test(t) && await page.locator('[data-r-copytranscript]').count() === 1);
  ok(`${name}: detail shows the exact excerpt and the caption as separate things`, /Search excerpt \(opening lines\)/.test(t) && /Caption or description \(written by the creator, not spoken\)/.test(t) && await page.locator('.r-text mark').count() > 0);
  ok(`${name}: detail offers the original records`, /Search match, as copied from Signal Room/.test(t) && /Item detail, as copied from Signal Room/.test(t) && /reels-data\/research\/sources\/2026-11-16-n8n/.test(t));
  ok(`${name}: focus moves to the post title`, await page.evaluate(() => document.activeElement && document.activeElement.id === 'r-title'));
  await s.shot('detail-with-transcript');
  await page.click('[data-r-back]'); await s.settle();
  ok(`${name}: Back returns focus to the row that was opened`, await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('r-open') && /full Claude code/.test(document.activeElement.innerText)));
  // detail: no transcript (TikTok)
  await page.locator('.r-group[aria-label="TikTok"] .r-open').first().click(); await page.waitForSelector('#r-title'); await s.settle(); t = await s.text();
  ok(`${name}: a post without a transcript says so and offers no transcript action`, /No transcript was fetched for this post/.test(t) && /No search excerpt was saved/.test(t) && await page.locator('[data-r-copytranscript]').count() === 0);
  ok(`${name}: TikTok detail labels the hashtag run and discovery score`, /TikTok hashtag/.test(t) && /last30free engagement score at fetch/.test(t));
  await s.shot('detail-tiktok-no-transcript');
  await page.click('[data-r-back]'); await s.settle();
  // searches, including the real failed "AI" search
  await page.click('[data-r-tab="searches"]'); await page.waitForSelector('[data-r-show]'); await s.settle(); t = await s.text();
  ok(`${name}: search history lists both imports and the real failure`, /“n8n”/.test(t) && /“AI”/.test(t) && /Failed/.test(t) && /The research backend is temporarily unavailable/.test(t));
  ok(`${name}: run notes carry the sampling and relevance limits`, /top matches from this search/.test(t) && /hashtag search #n8n only, no transcripts/.test(t) && /fallback because/.test(t));
  await s.shot('searches');
  await page.locator('[data-r-show="AI"]').click(); await page.waitForSelector('#r-form'); await s.settle(); t = await s.text();
  ok(`${name}: "Show results" for the failed search shows the failure, not an empty success`, /Instagram search failed for “AI”/.test(t) && /No saved post matches these filters/.test(t));
  await s.shot('signals-failed-search');
  // keyboard: every control is reachable and named
  await page.click('[data-r-reset]'); await s.settle();
  const a11y = await page.evaluate(() => { const r = document.querySelector('#research-root'); const ctl = [...r.querySelectorAll('button,select,input,a,summary')];
    return { unnamed: ctl.filter(c => !(c.textContent.trim() || c.getAttribute('aria-label') || (c.id && document.querySelector(`label[for="${c.id}"]`))) ).length, positiveTabindex: [...r.querySelectorAll('[tabindex]')].filter(x => Number(x.getAttribute('tabindex')) > 0).length, small: innerWidth < 500 ? ctl.filter(c => { const b = c.getBoundingClientRect(); return b.height > 0 && b.height < 44; }).map(c => (c.innerText || c.id).slice(0, 30) + ':' + Math.round(c.getBoundingClientRect().height)) : [] }; });
  ok(`${name}: every control has a name, none has a positive tabindex`, a11y.unnamed === 0 && a11y.positiveTabindex === 0, JSON.stringify(a11y));
  if (name === 'phone') ok('phone: every Research control is at least 44px tall', a11y.small.length === 0, a11y.small.join(', '));
  await page.focus('#r-search'); const stops = []; for (let i = 0; i < 9; i++) { await page.keyboard.press('Tab'); stops.push(await page.evaluate(() => { const a = document.activeElement; return a.id || a.dataset.rReset && 'reset' || a.type === 'submit' && 'submit' || a.tagName.toLowerCase(); })); }
  ok(`${name}: Tab walks the filters in reading order`, stops.slice(0, 7).join(',') === 'r-q,r-platform,r-format,r-window,r-sort,submit,reset', stops.join(','));
  // existing views still work
  for (const v of ['attention', 'pipeline', 'schedule']) { await page.click(`button[data-view="${v}"]`); await s.settle(); const has = await page.evaluate(() => !!document.querySelector('#app h2') && !document.querySelector('#research-root')); ok(`${name}: ${v} view still renders`, has); }
  await page.click('button[data-view="pipeline"]'); const row = page.locator('.prow').first();
  if (await row.count()) { await row.click(); await page.waitForTimeout(600); ok(`${name}: a pipeline project still opens with its tabs`, await page.locator('[data-tab-go]').count() === 5); await page.click('.back'); }
  await page.click('button[data-view="research"]'); await page.waitForSelector('#r-form');
  ok(`${name}: returning to Research works`, true);
  ok(`${name}: no console or page errors`, s.errs.length === 0, s.errs.slice(0, 3).join(' | '));
  await s.close();
}
real.close();

// ---------- throwaway store: unknown publication date, a failed source next to kept results ----------
const cfg = loadConfig({ root: mkdtempSync(join(tmpdir(), 'research-ui-')) });
const now = new Date(), iso = d => d.toISOString().replace(/\.\d+Z$/, 'Z'), daysAgo = n => iso(new Date(now - n * 86400e3));
importBatch(cfg, { schema: 1, batchId: 'fixture-1', retrievedAt: daysAgo(1), search: { query: 'n8n', windowDays: 30 }, runs: [{ provider: 'signal-room', lane: 'instagram_short_form', status: 'ok', results: ['instagram:3802204658396629750', 'instagram:3803030861483167224'] }, { provider: 'last30free', lane: 'tiktok_hashtag', status: 'ok', results: ['tiktok:7708502162103438612'] }],
  posts: [{ platform: 'instagram', id: '3802204658396629750', provider: 'signal-room', url: 'https://www.instagram.com/p/DTEJP3rEQr2/', format: 'short', title: 'Fixture: dated n8n post', publishedAt: daysAgo(3), observation: null },
    { platform: 'instagram', id: '3803030861483167224', provider: 'signal-room', url: 'https://www.instagram.com/p/DTHFGtQjU34/', format: 'short', title: 'Fixture: n8n post with no publication date', publishedAt: null, observation: null },
    { platform: 'tiktok', id: '7708502162103438612', provider: 'last30free', url: 'https://www.tiktok.com/@someone/video/7708502162103438612', format: 'short', title: 'Fixture: TikTok find kept after a failure', publishedAt: daysAgo(2), observation: { measuredAt: daysAgo(1), metrics: { views: 3260 }, discoveryScore: 7.6 } }] });
importBatch(cfg, { schema: 1, batchId: 'fixture-2', retrievedAt: iso(now), search: { query: 'n8n', windowDays: 30 }, runs: [{ provider: 'signal-room', lane: 'instagram_short_form', status: 'ok', results: [] }, { provider: 'last30free', lane: 'tiktok_hashtag', status: 'error', error: 'TikTok search failed: timeout', results: [] }], posts: [] });
const fx = await listen(cfg, 4396);
{
  const s = await session('http://localhost:4396', 'fixture', 1280, 900); const { page } = s;
  await page.click('button[data-view="research"]'); await page.waitForSelector('#r-form'); await s.settle(); let t = await s.text();
  ok('fixture: an unknown publication date is not counted as recent', /1 with no publication date/.test(t) && /2 published in the last 30 days/.test(t), (t.match(/\d+ published in[^\n]*/) || [''])[0]);
  ok('fixture: the failed TikTok run is shown while its earlier find stays listed', /TikTok hashtag search failed for “n8n”/.test(t) && /TikTok search failed: timeout/.test(t) && /Fixture: TikTok find kept after a failure/.test(t));
  await page.selectOption('#r-window', 'all'); await s.settle();
  ok('fixture: "any date" still keeps the undated post apart', await page.evaluate(() => { const g = document.querySelector('.r-group[aria-label="Instagram"]'); return g.querySelectorAll(':scope > .r-frame tbody tr').length === 1 && /1 with no publication date/.test(g.innerText); }));
  await page.locator('details.r-hist summary', { hasText: 'with no publication date' }).click(); await s.settle(); await s.shot('unknown-date-and-failure');
  await page.locator('.r-open', { hasText: 'no publication date' }).click(); await page.waitForSelector('#r-title'); await s.settle(); t = await s.text();
  ok('fixture: detail of a bare post states each missing thing', /Unknown: the source gave no date/.test(t) && /No measurement was recorded/.test(t) && /No transcript was fetched/.test(t) && /No caption was saved/.test(t) && /not kept for this batch/.test(t) && /Growth unavailable/.test(t));
  await s.shot('detail-everything-missing');
  ok('fixture: no console or page errors', s.errs.length === 0, s.errs.slice(0, 3).join(' | '));
  await s.close();
}
fx.close(); await browser.close();
console.log(rep.join('\n')); console.log(`\n${rep.filter(r => r.startsWith('PASS')).length} passed, ${rep.filter(r => r.startsWith('FAIL')).length} failed. Screenshots: ${out}`);
process.exit(rep.some(r => r.startsWith('FAIL')) ? 1 : 0);
