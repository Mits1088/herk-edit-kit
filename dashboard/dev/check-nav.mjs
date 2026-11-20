// Dev check for Command Centre navigation: where you are, the next step, and the way back, across Needs me,
// Pipeline, Schedule, Research and Insights. Throwaway folder only; headless Edge at desktop and phone widths.
// Run: node dashboard/dev/check-nav.mjs   (screenshots: tmp/command-centre/nav/)
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
const { loadConfig } = await import('../lib/config.mjs');
const { createServer } = await import('../server.mjs');
const { importBatch } = await import('../lib/research.mjs');
const { ideaAction } = await import('../lib/ideas.mjs');

const out = join(import.meta.dirname, '..', '..', 'tmp', 'command-centre', 'nav'); mkdirSync(out, { recursive: true });
const rep = []; const ok = (name, pass, extra = '') => rep.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
const now = new Date(), iso = d => d.toISOString().replace(/\.\d+Z$/, 'Z'), daysAgo = n => iso(new Date(now - n * 86400e3));
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const IG = '3802204658396629750', BATCH = `batch-${today}-001`, ITEM = `${today}-001-01`;
const bar = '='.repeat(40), sec = (n, b) => `${bar}\n${n}\n${bar}\n\n${b}\n\n`;
const draft = `### REEL 1 — Fixture\n\n**VERSION A — Faithful Rewrite**\n\nDraft A words.\n\n**VERSION B — Stronger Alternative**\n\nDraft B words.\n\n**FINAL COMPARISON**\n\n- Publication status: PENDING REVIEW\n`;

function store() {
  const cfg = loadConfig({ root: mkdtempSync(join(tmpdir(), 'nav-ui-')) });
  const put = (p, t) => { mkdirSync(dirname(join(cfg.root, p)), { recursive: true }); writeFileSync(join(cfg.root, p), t); };
  // research: one exportable post, saved and exported, then batched by the workflow with drafts written
  importBatch(cfg, { schema: 1, batchId: 'fx-1', retrievedAt: daysAgo(1), search: { query: 'n8n', windowDays: 30 }, runs: [{ provider: 'signal-room', lane: 'instagram_short_form', status: 'ok', results: ['instagram:' + IG, ...Array.from({ length: 14 }, (_, i) => 'instagram:' + (3802204658396620000n + BigInt(i)))] }],
    posts: [{ platform: 'instagram', id: IG, provider: 'signal-room', url: 'https://www.instagram.com/p/DTEJP3rEQr2/', format: 'short', creator: { handle: 'sample.creator' }, title: 'Fixture: the exported idea', publishedAt: daysAgo(20), durationSeconds: 39, transcript: { text: 'Spoken words about n8n.', origin: 'signal-room', capturedAt: daysAgo(2) }, observation: null },
      ...Array.from({ length: 14 }, (_, i) => ({ platform: 'instagram', id: String(3802204658396620000n + BigInt(i)), provider: 'signal-room', url: `https://www.instagram.com/p/F${i}/`, format: 'short', creator: { handle: 'filler' }, title: `Fixture: filler post ${i + 1}`, publishedAt: daysAgo(i + 1), durationSeconds: 30, transcript: null, observation: null }))] });
  ideaAction(cfg, { type: 'save-idea', postId: 'instagram-' + IG, angle: 'Open on the result.' }); ideaAction(cfg, { type: 'export-idea', ideaId: 'idea-instagram-' + IG });
  const name = `research-instagram-${IG}.md`; mkdirSync(join(cfg.inputsDir, BATCH), { recursive: true }); renameSync(join(cfg.dropDir, name), join(cfg.inputsDir, BATCH, name));
  put(`reels-data/outputs/${BATCH}/reel-01-fixture.md`, draft);
  // production: enough reviewed scripts to make the Pipeline list scroll
  for (let i = 2; i <= 9; i++) put(`instagram_scripts_output/batch-${today}-00${i}/01-filler-${i}.txt`, `REEL 1: Filler script ${i}\nStatus: READY TO RECORD\n\n${sec('VERSION A', 'A text')}${sec('VERSION B', 'B text')}`);
  return cfg;
}

const browser = await chromium.launch({ headless: true, channel: 'msedge' });
for (const [name, w, h] of [['desk', 1280, 700], ['phone', 390, 700]]) {
  const cfg = store(); const srv = createServer(cfg); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ['clipboard-read', 'clipboard-write'] }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const settle = () => page.waitForTimeout(350);
  const text = () => page.evaluate(() => document.querySelector('#app').innerText);
  const current = () => page.evaluate(() => [...document.querySelectorAll('#nav button')].filter(b => b.getAttribute('aria-current') === 'true').map(b => b.dataset.view).join(','));
  const shot = async l => { const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(`${name} ${l}: no sideways scroll`, o <= 0, 'overflowX=' + o); await page.screenshot({ path: join(out, `${name}-${l}.png`), fullPage: true }); };
  const small = () => page.evaluate(() => [...document.querySelectorAll('.wrap button, .wrap select, .wrap a.btn, .wrap summary, .wrap textarea, .wrap input')].filter(c => { const b = c.getBoundingClientRect(); return b.height > 0 && b.height < 44; }).map(c => (c.innerText || c.id || c.tagName).slice(0, 24) + ':' + Math.round(c.getBoundingClientRect().height)));
  const tall = async l => { if (name === 'phone') { const s = await small(); ok(`phone ${l}: every control is at least 44px tall`, s.length === 0, s.slice(0, 6).join(', ')); } };
  await page.goto('http://localhost:' + srv.address().port); await page.waitForSelector('#nav button'); await settle();

  // ---- Needs me: the pending drafts are named for what they are ----
  let t = await text();
  ok(`${name}: Needs me lists "Drafts awaiting review" with an Open drafts action`, /Drafts awaiting review/.test(t) && /Open drafts/.test(t) && !/abandon|status unknown/i.test(t));
  if (name === 'phone') ok('phone: the five views sit in one bottom tab bar, none clipped, each 44px or taller', await page.evaluate(() => { const bs = [...document.querySelectorAll('#nav button')]; const r = bs.map(b => b.getBoundingClientRect()); return bs.length === 5 && new Set(r.map(x => Math.round(x.top))).size === 1 && r.every(x => x.bottom <= innerHeight + 1 && x.height >= 44) && bs.every(b => b.scrollWidth <= b.clientWidth); }));
  await tall('Needs me'); await shot('needs-me');
  await page.locator('.task', { hasText: 'Drafts awaiting review' }).click(); await page.waitForSelector('[data-tab-go]'); await settle(); t = await text();
  ok(`${name}: it opens the project on Scripts, shown as drafts awaiting review`, /Draft scripts/.test(t) && /Awaiting review/.test(t) && /Not exported/.test(t) && /Version A \(draft\)/.test(t) && /Draft B words/.test(t) && /Next: You/.test(t));
  ok(`${name}: drafts offer no approval, and say how to run the review`, await page.locator('[data-decide]').count() === 0 && /nothing to approve yet/.test(t) && new RegExp(`Run the review for ${BATCH}`).test(t));
  ok(`${name}: the project page says nothing about abandonment or unknown status`, !/abandon|status unknown|Not recorded/i.test(t));
  ok(`${name}: Needs me stays marked in the navigation while its project is open`, (await current()) === 'attention', await current());
  await page.locator('.row', { hasText: 'Run the review for' }).locator('[data-copy]').click(); await settle();
  ok(`${name}: the review prompt copies`, (await page.evaluate(() => navigator.clipboard.readText())).startsWith(`Run the review for ${BATCH}`));
  await tall('project'); await shot('project-drafts');
  await page.click('[data-back]'); await settle();
  ok(`${name}: Back returns to Needs me with focus on the task that was opened`, await page.evaluate(() => document.activeElement.classList.contains('task') && /Drafts awaiting review/.test(document.activeElement.innerText)));

  // ---- Pipeline: the filter and the scroll position survive a visit to a project ----
  await page.click('button[data-view="pipeline"]'); await settle(); await page.click('[data-all="1"]'); await settle(); t = await text();
  ok(`${name}: Pipeline shows the draft item as waiting on you, as "Drafts awaiting review"`, await page.evaluate(id => { const r = document.querySelector(`.prow[data-open="${id}"]`); return !!r && /Next: You/.test(r.innerText) && /Drafts awaiting review/.test(r.innerText) && !!r.querySelector('.track .need'); }, ITEM));
  await tall('Pipeline'); await shot('pipeline');
  const last = page.locator('.prow').last(); await last.scrollIntoViewIfNeeded(); const y0 = await page.evaluate(() => window.scrollY); const lastId = await last.getAttribute('data-open');
  await last.focus(); await page.keyboard.press('Enter'); await page.waitForSelector('[data-tab-go]'); await settle();
  ok(`${name}: a project opens from the keyboard, at the top of its page`, await page.evaluate(() => window.scrollY === 0) && (await current()) === 'pipeline');
  await page.focus('[data-back]'); await page.keyboard.press('Enter'); await settle();
  const after = await page.evaluate(() => ({ y: window.scrollY, id: document.activeElement.dataset.open, all: document.querySelector('[data-all="1"]').getAttribute('aria-current') }));
  ok(`${name}: Back from the keyboard restores the All filter, the scroll position and the row`, after.all === 'true' && after.id === lastId && y0 > 0 && Math.abs(after.y - y0) <= 2, JSON.stringify({ y0, ...after }));
  ok(`${name}: the returned row shows a visible focus ring`, await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'));

  // ---- Schedule ----
  await page.click('button[data-view="schedule"]'); await settle();
  ok(`${name}: Schedule renders and is marked current`, (await current()) === 'schedule' && /Publishing schedule/.test(await text()));
  await tall('Schedule');

  // ---- research to production and back ----
  await page.click(`button[data-view="pipeline"]`); await settle(); await page.locator(`.prow[data-open="${ITEM}"]`).click(); await page.waitForSelector('[data-research]'); await settle();
  ok(`${name}: a project that came from research says so`, /Started from a saved research idea/.test(await text()));
  await page.click('[data-research]'); await page.waitForSelector('#r-title'); await settle(); t = await text();
  ok(`${name}: its link opens the idea in Research`, (await current()) === 'research' && /Fixture: the exported idea/.test(t) && /Open on the result\./.test(await page.inputValue('#r-angle')));
  ok(`${name}: the idea shows where it is in production`, /In Pipeline: Drafts awaiting review/.test(t) && await page.locator('[data-r-pipeline]').count() === 1);
  await tall('idea'); await shot('idea-in-pipeline');
  await page.click('[data-r-pipeline]'); await page.waitForSelector('[data-tab-go]'); await settle();
  ok(`${name}: the Pipeline link opens the project, with Research still marked`, /Draft scripts/.test(await text()) && (await current()) === 'research');
  await page.click('[data-back]'); await page.waitForSelector('#r-title'); await settle();
  ok(`${name}: Back from that project returns to the idea, not to a list`, /Fixture: the exported idea/.test(await text()));
  await page.click('[data-r-back]'); await page.waitForSelector('#r-form'); await settle();

  // ---- Research: filters, scroll and row survive a visit to a post ----
  await page.selectOption('#r-window', 'all'); await settle(); await page.selectOption('#r-sort', 'published'); await settle();
  const row = page.locator('.r-open', { hasText: 'Fixture: the exported idea' }).first(); await row.scrollIntoViewIfNeeded(); const ry = await page.evaluate(() => window.scrollY);
  await row.click(); await page.waitForSelector('#r-title'); await settle();
  ok(`${name}: a post's Back button names the list it returns to`, /Back to Signals/.test(await text()));
  await page.click('[data-r-back]'); await page.waitForSelector('#r-form'); await settle();
  const r2 = await page.evaluate(() => ({ y: window.scrollY, win: document.querySelector('#r-window').value, focus: document.activeElement.innerText }));
  ok(`${name}: Back keeps the filter, the scroll position and the row`, r2.win === 'all' && /the exported idea/.test(r2.focus) && Math.abs(r2.y - ry) <= 2, JSON.stringify({ ry, ...r2 }));
  await page.click('[data-r-tab="ideas"]'); await page.waitForSelector('.r-ideas'); await settle(); t = await text();
  ok(`${name}: the Ideas list shows the production state and a Pipeline button`, /In Pipeline: Drafts awaiting review/.test(t) && await page.locator('.r-ideas [data-r-pipeline]').count() === 1);
  await tall('Ideas'); await shot('ideas');
  await page.locator('.r-ideas .r-open').first().click(); await page.waitForSelector('#r-title'); await settle();
  ok(`${name}: from Ideas the Back button reads "Back to Ideas"`, /Back to Ideas/.test(await text()));
  await page.click('[data-r-back]'); await page.waitForSelector('.r-ideas'); await page.click('[data-r-tab="searches"]'); await page.waitForSelector('[data-r-show]'); await settle(); await tall('Searches');
  // leaving Research and coming back keeps the sub-view
  await page.click('button[data-view="pipeline"]'); await settle(); await page.click('button[data-view="research"]'); await page.waitForSelector('.r-seg'); await settle();
  ok(`${name}: Research reopens on the sub-view you left`, await page.evaluate(() => document.querySelector('[data-r-tab="searches"]').getAttribute('aria-current') === 'true'));

  // ---- a production action still behaves: set aside, then bring back ----
  await page.click('button[data-view="pipeline"]'); await settle(); await page.click('[data-all="0"]'); await settle();
  const n0 = await page.locator('.prow').count(); await page.locator(`[data-activity="set-aside"][data-id="${ITEM}"]`).click(); await settle(); await page.waitForTimeout(400);
  const n1 = await page.locator('.prow').count(); await page.click('[data-all="1"]'); await settle(); await page.locator(`[data-activity="active"][data-id="${ITEM}"]`).click(); await page.waitForTimeout(700); await page.click('[data-all="0"]'); await settle();
  ok(`${name}: Move to All and Move to Active still work`, n1 === n0 - 1 && await page.locator('.prow').count() === n0, `${n0} -> ${n1}`);
  ok(`${name}: no console or page errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close(); srv.close();
}
await browser.close();
console.log(rep.join('\n')); console.log(`\n${rep.filter(r => r.startsWith('PASS')).length} passed, ${rep.filter(r => r.startsWith('FAIL')).length} failed. Screenshots: ${out}`);
process.exit(rep.some(r => r.startsWith('FAIL')) ? 1 : 0);
