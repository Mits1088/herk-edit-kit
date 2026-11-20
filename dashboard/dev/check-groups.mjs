// Dev check for idea groups. A throwaway store and a fake subtitle runner, so nothing reaches YouTube.
// Headless Edge, desktop and phone widths. Run: node dashboard/dev/check-groups.mjs   (screenshots: tmp/research-ui/)
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { loadConfig } = await import('../lib/config.mjs');
const { createServer } = await import('../server.mjs');
const { importBatch } = await import('../lib/research.mjs');
const { readIdeas, readGroups, ideaAction } = await import('../lib/ideas.mjs');

const out = join(import.meta.dirname, '..', '..', 'tmp', 'research-ui'); mkdirSync(out, { recursive: true });
const rep = []; const ok = (name, pass, extra = '') => rep.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const now = new Date(), iso = d => d.toISOString().replace(/\.\d+Z$/, 'Z'), daysAgo = n => iso(new Date(now - n * 86400e3));
const Y = ['AAAAAAAAAA1', 'BBBBBBBBBB2', 'CCCCCCCCCC3', 'DDDDDDDDDD4'], TT = '7708502162103438612', key = id => 'youtube-' + Buffer.from(id).toString('hex');
const LONG = i => Array.from({ length: 400 }, (_, k) => `video${i + 1}word${k}`).join(' ');

function store() {
  const cfg = loadConfig({ root: mkdtempSync(join(tmpdir(), 'groups-ui-')), subtitleGapMs: 0, subtitleRunner: () => new Promise(() => {}) });
  importBatch(cfg, { schema: 1, batchId: 'fx-1', retrievedAt: daysAgo(1), search: { query: 'claude', windowDays: 30 }, runs: [
    { provider: 'last30free', lane: 'youtube_discovery', status: 'ok', results: Y.map(y => 'youtube:' + y) }, { provider: 'last30free', lane: 'tiktok_hashtag', status: 'ok', results: ['tiktok:' + TT] }],
  posts: [...Y.map((y, i) => ({ platform: 'youtube', id: y, provider: 'last30free', url: 'https://www.youtube.com/watch?v=' + y, format: 'long', creator: { name: 'Channel ' + (i + 1) }, title: `Fixture: similar Claude video ${i + 1}`, publishedAt: daysAgo(3), durationSeconds: 600,
      transcript: { text: LONG(i), origin: 'subtitles', capturedAt: daysAgo(1) }, observation: { measuredAt: daysAgo(1), metrics: { views: 125000 * (i + 1) } } })),
    { platform: 'tiktok', id: TT, provider: 'last30free', url: `https://www.tiktok.com/@x/video/${TT}`, format: 'short', title: 'Fixture: TikTok', publishedAt: daysAgo(2), durationSeconds: 66, transcript: null, observation: null }] });
  for (const y of Y) ideaAction(cfg, { type: 'save-idea', postId: key(y), angle: 'My angle on ' + y });
  ideaAction(cfg, { type: 'save-idea', postId: 'tiktok-' + TT });
  return cfg;
}

for (const [name, w, h] of [['desk', 1280, 900], ['phone', 390, 844]]) {
  const cfg = store(); const srv = await new Promise(r => { const s = createServer(cfg); s.listen(0, '127.0.0.1', () => r(s)); }); const base = 'http://localhost:' + srv.address().port;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ['clipboard-read', 'clipboard-write'] }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const text = () => page.evaluate(() => document.querySelector('#app').innerText);
  const clip = async () => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
  const shot = async label => { const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(`${name} ${label}: no sideways scroll`, o <= 0, 'overflowX=' + o); await page.screenshot({ path: join(out, `${name}-groups-${label}.png`), fullPage: true }); };
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(150); } return false; };
  const toIdeas = async () => { await page.goto(base); await page.waitForSelector('#nav button'); await page.click('button[data-view="research"]'); await page.waitForSelector('.r-seg'); await page.click('[data-r-tab="ideas"]'); await page.waitForSelector('.r-stage'); };
  const g = () => readGroups(cfg)[0];

  // ---- pick and create ----
  await toIdeas();
  ok(`${name}: Group selected starts disabled at 0/3`, await page.locator('[data-r-gcreate]').isDisabled() && /Group selected \(0\/3\)/.test(await text()));
  ok(`${name}: only YouTube ideas can be picked`, await page.locator('[data-r-sel]').count() === 4);
  for (const y of Y.slice(0, 3)) await page.check(`#r-sel-${CSS_escape('idea-' + key(y))}`);
  ok(`${name}: after 3 picks the 4th box is disabled and the button reads 3/3`, await page.locator(`#r-sel-${CSS_escape('idea-' + key(Y[3]))}`).isDisabled() && /Group selected \(3\/3\)/.test(await text()));
  await shot('picked');
  await page.click('[data-r-gcreate]'); await page.waitForSelector('#r-gtitle'); await page.waitForSelector('.r-gcol');
  ok(`${name}: creating opens the group with 3 videos`, await page.locator('.r-gcol').count() === 3 && readGroups(cfg).length === 1 && g().ideaIds.length === 3);
  const tops = await page.$$eval('.r-gcol', els => els.map(e => Math.round(e.getBoundingClientRect().top)));
  ok(`${name}: ${name === 'desk' ? 'columns sit side by side' : 'columns stack on a phone'}`, name === 'desk' ? new Set(tops).size === 1 : tops[0] < tops[1] && tops[1] < tops[2], tops.join(','));
  const t = await text();
  ok(`${name}: each column shows title, creator, views, angle and the full transcript`, [1, 2, 3].every(i => t.includes(`Fixture: similar Claude video ${i}`) && t.includes(`Channel ${i}`)) && /375,000/.test(t) && t.includes('My angle on ' + Y[0]) && await page.locator('.r-gtext').count() === 3 && (await page.locator('.r-gtext').first().textContent()).endsWith('video1word399'));
  ok(`${name}: the script box starts blank`, (await page.inputValue('#r-gdraft')) === '');
  await shot('group');

  // ---- the script saves itself and survives a reload ----
  await page.fill('#r-gdraft', ''); await page.type('#r-gdraft', 'My combined script.', { delay: 5 });
  ok(`${name}: the script saves a moment after typing stops`, await until(() => g().draft === 'My combined script.'));
  ok(`${name}: it says when it saved`, await until(async () => /^Saved /.test(await page.textContent('#r-gsave'))));
  await page.click('[data-r-gbundle]'); const b = await clip();
  ok(`${name}: Copy all transcripts labels every video`, b.startsWith('GROUP: Fixture: similar Claude video 1') && [1, 2, 3].every(i => b.includes(`=== VIDEO ${i} of 3`)) && b.includes('MY ANGLE: My angle on ' + Y[0]) && b.includes('video3word399'));
  // typing, then leaving at once: nothing is lost
  await page.fill('#r-gdraft', 'Typed and left at once.'); await page.click('[data-r-gback]'); await page.waitForSelector('.r-gcard');
  ok(`${name}: typing then pressing Back straight away still saves`, await until(() => g().draft === 'Typed and left at once.'));
  ok(`${name}: the Ideas tab lists the group and marks its ideas`, /3\/3 ideas/.test(await text()) && /Script written/.test(await text()) && await page.locator('.r-ingroup').count() === 3 && await page.locator('[data-r-sel]').count() === 1);

  // ---- empty the group: it and its script stay, after a reload too ----
  await page.click('.r-gcard [data-r-group]'); await page.waitForSelector('.r-gcol');
  for (let i = 0; i < 3; i++) { await page.locator('[data-r-gremove]').first().click(); await until(async () => (await page.locator('.r-gcol').count()) === 2 - i); }
  ok(`${name}: the last idea removed leaves an empty group with its script`, await page.locator('.r-gcol').count() === 0 && /No ideas in this group now/.test(await text()) && (await page.inputValue('#r-gdraft')) === 'Typed and left at once.' && g().ideaIds.length === 0);
  await toIdeas(); ok(`${name}: after a reload the empty group is still listed`, /0\/3 ideas/.test(await text()) && /No ideas in it now\. Its script is kept\./.test(await text()));
  await page.click('.r-gcard [data-r-group]'); await page.waitForSelector('#r-gdraft');
  ok(`${name}: and its script is still there`, (await page.inputValue('#r-gdraft')) === 'Typed and left at once.');
  await page.selectOption('#r-gaddsel', 'idea-' + key(Y[3])); await page.click('[data-r-gadd]');
  ok(`${name}: an idea can be added back to the empty group`, await until(async () => (await page.locator('.r-gcol').count()) === 1) && g().ideaIds.length === 1);
  await shot('one-left');

  // ---- delete: asks first when there is a script; Copy and Cancel leave the group ----
  await page.click('[data-r-gdelete]'); await page.waitForSelector('[data-r-gdelyes]');
  ok(`${name}: Delete group with a script asks first and offers Copy script`, /Delete this group and its script\?/.test(await text()) && await page.locator('.r-gdel [data-r-gcopydraft]').count() === 1 && readGroups(cfg).length === 1);
  await shot('delete-ask');
  await page.click('.r-gdel [data-r-gcopydraft]'); await page.waitForTimeout(200);
  ok(`${name}: Copy script copies it and deletes nothing`, (await clip()) === 'Typed and left at once.' && readGroups(cfg).length === 1 && await page.locator('[data-r-gdelyes]').count() === 1);
  await page.click('[data-r-gdelno]');
  ok(`${name}: Cancel leaves the group and script intact`, await page.locator('[data-r-gdelyes]').count() === 0 && readGroups(cfg).length === 1 && g().draft === 'Typed and left at once.');
  await page.click('[data-r-gdelete]'); await page.click('[data-r-gdelyes]'); await page.waitForSelector('.r-stage');
  ok(`${name}: Yes deletes the group and keeps every idea`, await until(() => readGroups(cfg).length === 0) && readIdeas(cfg).length === 5 && !/Typed and left/.test(await text()));
  // an empty-script group is deleted without asking
  await page.check(`#r-sel-${CSS_escape('idea-' + key(Y[0]))}`); await page.click('[data-r-gcreate]'); await page.waitForSelector('#r-gdraft');
  await page.click('[data-r-gdelete]'); ok(`${name}: a group with no script is deleted without asking`, await until(() => readGroups(cfg).length === 0));
  ok(`${name}: no page errors`, errs.length === 0, errs.join(' | '));
  await ctx.close(); srv.close();
}
await browser.close();
console.log(rep.join('\n')); console.log(`\n${rep.filter(r => r.startsWith('FAIL')).length} failed of ${rep.length}`);
process.exit(rep.some(r => r.startsWith('FAIL')) ? 1 : 0);
function CSS_escape(s) { return s.replace(/([^A-Za-z0-9_-])/g, '\\$1'); }
