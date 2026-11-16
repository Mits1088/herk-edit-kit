// Screenshots of every Command Centre view on the real data, desktop and phone. Reads only: it sends no actions.
// Run: node dashboard/dev/shots.mjs <label>   (writes tmp/command-centre/<label>/)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const { loadConfig } = await import('../lib/config.mjs');
const { createServer } = await import('../server.mjs');

const label = process.argv[2] || 'now';
const out = join(import.meta.dirname, '..', '..', 'tmp', 'command-centre', label); mkdirSync(out, { recursive: true });
const srv = createServer(loadConfig()); await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = 'http://localhost:' + srv.address().port;
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const TRIAL = '2026-11-16-001-01';
for (const [name, w, h] of [['desk', 1280, 900], ['phone', 390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } }); const page = await ctx.newPage();
  const shot = async l => { await page.waitForTimeout(400); await page.screenshot({ path: join(out, `${name}-${l}.png`), fullPage: true }); };
  const go = async v => { await page.click(`button[data-view="${v}"]`); await page.waitForTimeout(300); };
  await page.goto(base); await page.waitForSelector('#nav button');
  await go('attention'); await shot('1-needs-me');
  await go('pipeline'); await shot('2-pipeline');
  await page.evaluate(id => open(id), TRIAL); await shot('3-project-trial-drafts');
  await go('pipeline'); const row = page.locator('.prow').first(); if (await row.count()) { await row.click(); await shot('4-project-first-row'); }
  await go('schedule'); await shot('5-schedule');
  await go('research'); await page.waitForSelector('.r-seg'); await shot('6-research-signals');
  await page.selectOption('#r-window', 'all'); await page.waitForTimeout(300);
  const saved = page.locator('tr:has(.r-saved) .r-open').first(); if (await saved.count()) { await saved.click(); await page.waitForSelector('#r-title'); await shot('7-research-post-with-idea'); await page.click('[data-r-back]'); }
  await page.click('[data-r-tab="ideas"]'); await shot('8-research-ideas');
  await page.click('[data-r-tab="searches"]'); await shot('9-research-searches');
  await ctx.close();
}
await browser.close(); srv.close(); console.log('Screenshots: ' + out);
