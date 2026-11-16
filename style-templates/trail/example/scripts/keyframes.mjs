// Gate B keyframes: node scripts/keyframes.mjs  -> keyframes/<scene>.png (s00 comes from the trial composition)
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--disable-features=PointerLock'] });
const page = await (await browser.newContext({ viewport: { width: 1080, height: 1920 } })).newPage();
page.on('pageerror', e => console.log('ERR', e.message));
for (const id of ['s06', 's08']) {
  await page.goto('about:blank');
  await page.goto(pathToFileURL(resolve('keyframes/src/kf.html')).href + '#' + id);
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(600);
  await page.screenshot({ path: `keyframes/${id}.png` }); console.log('ok', id);
}
await browser.close();
