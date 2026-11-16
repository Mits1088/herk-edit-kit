// Headless stills of index.html at given times: node scripts/shots.mjs <outdir> t1 t2 ...  (emulates clip visibility)
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
const [out, ...ts] = process.argv.slice(2); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--disable-features=PointerLock', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 0.5 })).newPage();
page.on('pageerror', e => console.log('ERR', e.message)); page.on('console', m => { if (m.type() === 'error') console.log('console:', m.text()); });
await page.goto(pathToFileURL(resolve('index.html')).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
for (const t of ts.map(Number)) {
  await page.evaluate(async t => {
    const tl = window.__timelines['hallmark-websites']; tl.time(t);
    document.querySelectorAll('.clip').forEach(c => { const a = +c.dataset.start, d = +c.dataset.duration; c.style.visibility = (t >= a && t < a + d) ? 'visible' : 'hidden'; });
    const v = document.getElementById('face'); v.currentTime = t; await new Promise(r => { v.onseeked = r; setTimeout(r, 1500); });
  }, t);
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${out}/t${t.toFixed(2).padStart(5, '0')}.png` });
}
await browser.close(); console.log('ok');
