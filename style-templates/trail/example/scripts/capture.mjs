// Headless captures of public pages for evidence (no login, no cookies kept): node scripts/capture.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = 'assets/captures'; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--disable-features=PointerLock'] });
async function shot(url, w, h, file, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: opts.dpr || 2, colorScheme: 'light' });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(e => console.log('nav', url, e.message));
  await p.waitForTimeout(1500);
  if (opts.before) await opts.before(p);
  await p.screenshot({ path: `${OUT}/${file}`, fullPage: !!opts.full });
  console.log('ok', file); await ctx.close();
}
await shot('https://github.com/Nutlope/hallmark', 1280, 900, 'github-readme.png', { full: true, dpr: 1.5 });
await shot('https://www.usehallmark.com/', 1440, 900, 'site-full.png', { full: true, dpr: 1.5, before: async p => {
  const b = p.getByText(/show all 50/i).first(); if (await b.count()) { await b.click().catch(() => {}); await p.waitForTimeout(1200); }
  for (let y = 0; y < 30000; y += 800) { await p.mouse.wheel(0, 800); await p.waitForTimeout(120); }
  await p.waitForTimeout(1500);
} });
for (const [w, h] of [[1440, 900], [834, 1112], [390, 844]]) await shot('https://www.usehallmark.com/themes/refract/', w, h, `refract-${w}.png`);
await browser.close();
