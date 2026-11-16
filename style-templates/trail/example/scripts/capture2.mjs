// Section captures of usehallmark.com that animate in on scroll: node scripts/capture2.mjs
import { chromium } from 'playwright';
const OUT = 'assets/captures';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--disable-features=PointerLock'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce' });
const p = await ctx.newPage();
await p.goto('https://www.usehallmark.com/', { waitUntil: 'networkidle', timeout: 60000 });
for (const [re, file] of [[/one prompt, two pages/i, 'two-pages'], [/designs before it codes/i, 'designs-before'], [/fifty themes/i, 'fifty-themes']]) {
  const h = p.getByText(re).first();
  if (!(await h.count())) { console.log('missing', re); continue; }
  await h.scrollIntoViewIfNeeded(); await p.waitForTimeout(400);
  await p.evaluate(() => window.scrollBy(0, -80));
  for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 150); await p.waitForTimeout(250); }
  await p.waitForTimeout(1500);
  const sec = h.locator('xpath=ancestor::section[1]');
  if (await sec.count()) { await sec.scrollIntoViewIfNeeded(); await p.waitForTimeout(1500); await sec.screenshot({ path: `${OUT}/${file}.png` }); console.log('ok', file); }
  else console.log('no section for', file);
}
await browser.close();
