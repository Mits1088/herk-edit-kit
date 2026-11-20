// Dev check for YouTube transcripts fetched on save. A throwaway store and a fake subtitle runner that the check
// releases by hand, so nothing reaches YouTube. Headless Edge, desktop and phone widths.
// Run: node dashboard/dev/check-transcript-fetch.mjs   (screenshots: tmp/research-ui/)
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { loadConfig } = await import('../lib/config.mjs');
const { createServer } = await import('../server.mjs');
const { importBatch } = await import('../lib/research.mjs');
const { readIdeas } = await import('../lib/ideas.mjs');

const out = join(import.meta.dirname, '..', '..', 'tmp', 'research-ui'); mkdirSync(out, { recursive: true });
const rep = []; const ok = (name, pass, extra = '') => rep.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const now = new Date(), iso = d => d.toISOString().replace(/\.\d+Z$/, 'Z'), daysAgo = n => iso(new Date(now - n * 86400e3));
const A = 'AbC-_12xYz9', B = 'Zz9-_87yXw1', key = id => 'youtube-' + Buffer.from(id).toString('hex');
const SUBS = 'Fetched subtitle words for the whole video, start to finish.';

function store(runner) {
  const cfg = loadConfig({ root: mkdtempSync(join(tmpdir(), 'fetch-ui-')), subtitleRunner: runner, subtitleGapMs: 0 });
  importBatch(cfg, { schema: 1, batchId: 'fx-1', retrievedAt: daysAgo(1), search: { query: 'claude', windowDays: 30 }, runs: [
    { provider: 'last30free', lane: 'youtube_discovery', status: 'ok', results: ['youtube:' + A, 'youtube:' + B] }],
  posts: [A, B].map((id, i) => ({ platform: 'youtube', id, provider: 'last30free', url: 'https://www.youtube.com/watch?v=' + id, format: 'long', title: `Fixture: YouTube video ${i + 1}`, publishedAt: daysAgo(2), durationSeconds: 600, transcript: null, observation: null })) });
  return cfg;
}

for (const [name, w, h] of [['desk', 1280, 900], ['phone', 390, 844]]) {
  const calls = [], pending = []; const runner = (cfg, id) => { calls.push(id); return new Promise(r => pending.push(r)); };
  const cfg = store(runner); const srv = await new Promise(r => { const s = createServer(cfg); s.listen(0, '127.0.0.1', () => r(s)); }); const base = 'http://localhost:' + srv.address().port;
  const ctx = await browser.newContext({ viewport: { width: w, height: h } }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const text = () => page.evaluate(() => document.querySelector('#app').innerText);
  const shot = async label => { const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(`${name} ${label}: no sideways scroll`, o <= 0, 'overflowX=' + o); await page.screenshot({ path: join(out, `${name}-fetch-${label}.png`), fullPage: true }); };
  const until = async (fn, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(250); } return false; };

  await page.goto(base); await page.waitForSelector('#nav button'); await page.click('button[data-view="research"]'); await page.waitForSelector('.r-seg');
  await page.evaluate(id => Research.open(id), key(A)); await page.waitForSelector('#r-title');
  ok(`${name}: an unsaved YouTube post says saving fetches its transcript`, /Saving also fetches its full YouTube transcript/.test(await text()));
  await page.fill('#r-angle', 'My angle'); await page.click('[data-r-save]'); await page.waitForSelector('[data-r-angle]');
  ok(`${name}: after Save, the page says it is fetching and offers no paste box yet`, /Fetching the YouTube transcript/.test(await text()) && await page.locator('#r-trtext').count() === 0);
  ok(`${name}: the runner got the original video id once`, calls.join() === A, calls.join());
  await shot('fetching');
  // type into the angle box while the fetch runs, then let it finish: the page updates by itself and keeps the typing
  await page.fill('#r-angle', 'Typed while it fetched'); await page.focus('#r-angle');
  pending.shift()({ ok: true, text: SUBS });
  const shown = await until(async () => /Fetched subtitle words for the whole video/.test(await text()));
  ok(`${name}: the transcript appears without a reload`, shown);
  ok(`${name}: it is labelled as YouTube subtitles fetched on save`, /YouTube subtitles fetched when you saved this idea/.test(await text()));
  ok(`${name}: text typed during the fetch is kept on screen`, (await page.inputValue('#r-angle')) === 'Typed while it fetched');
  ok(`${name}: the unsaved typing was not written for you`, readIdeas(cfg)[0].angle === 'My angle');
  await shot('fetched');

  // a second idea that fails, then Retry from the Ideas tab
  await page.evaluate(id => Research.open(id), key(B)); await page.waitForSelector('#r-title'); await page.click('[data-r-save]'); await page.waitForSelector('[data-r-angle]');
  pending.shift()({ ok: false, error: "Couldn't fetch subtitles. The video may have no captions, or YouTube refused the request." });
  ok(`${name}: a failure says it couldn't fetch, with Retry and the paste box`, await until(async () => /Couldn't fetch subtitles/.test(await text()) && await page.locator('[data-r-fetch]').count() === 1 && await page.locator('#r-trtext').count() === 1));
  ok(`${name}: it never claims the video has no subtitles`, !/No subtitles/.test(await text()));
  await page.click('[data-r-back]'); await page.click('[data-r-tab="ideas"]'); await page.waitForSelector('.r-stage');
  ok(`${name}: the Ideas tab shows the fetched one and the failed one`, /Transcript fetched: 10 words of YouTube subtitles/.test(await text()) && /Couldn't fetch subtitles/.test(await text()));
  ok(`${name}: Fetch missing transcripts counts the failed one`, /Fetch missing transcripts \(1\)/.test(await text()));
  await shot('ideas-failed');
  await page.click('[data-r-fetch]');
  ok(`${name}: Retry starts a fetch for the same video`, await until(async () => /Fetching the YouTube transcript/.test(await text())) && calls.join() === [A, B, B].join(), calls.join());
  pending.shift()({ ok: true, text: 'Second video words.' });
  ok(`${name}: the Ideas tab updates by itself when it lands`, await until(async () => /Transcript fetched: 3 words/.test(await text()) && !/Fetch missing transcripts/.test(await text())));
  ok(`${name}: no page errors`, errs.length === 0, errs.join(' | '));
  await ctx.close(); srv.close();
}
await browser.close();
console.log(rep.join('\n')); console.log(`\n${rep.filter(r => r.startsWith('FAIL')).length} failed of ${rep.length}`);
process.exit(rep.some(r => r.startsWith('FAIL')) ? 1 : 0);
