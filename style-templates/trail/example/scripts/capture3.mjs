// Both ends of the "One prompt, two pages" comparison slider, plus the raw SKILL.md: node scripts/capture3.mjs
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const OUT = 'assets/captures';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--disable-features=PointerLock'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce' });
const p = await ctx.newPage();
await p.goto('https://www.usehallmark.com/', { waitUntil: 'networkidle', timeout: 60000 });
const h = p.getByText(/one prompt, two pages/i).first();
await h.scrollIntoViewIfNeeded(); await p.waitForTimeout(800);
await p.evaluate(() => window.scrollBy(0, 330)); await p.waitForTimeout(1500);
// the slider: the widest element whose text contains both labels
const box = await p.evaluate(() => {
  const els = [...document.querySelectorAll('div,figure,section')].filter(e => /Without/.test(e.innerText || '') && /With Hallmark/.test(e.innerText || ''));
  els.sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height);
  const r = els[0].getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
});
console.log('widget', box);
const cy = box.y + box.h / 2;
for (const [frac, file] of [[0.995, 'compare-without'], [0.005, 'compare-with'], [0.5, 'compare-half']]) {
  await p.mouse.move(box.x + box.w * 0.5, cy); await p.mouse.down();
  await p.mouse.move(box.x + box.w * frac, cy, { steps: 12 }); await p.mouse.up();
  await p.keyboard.press('Escape').catch(() => {});
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/${file}.png`, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  console.log('ok', file);
}
const r = await p.request.get('https://raw.githubusercontent.com/Nutlope/hallmark/main/skills/hallmark/SKILL.md');
writeFileSync(`${OUT}/SKILL.md.txt`, await r.text()); console.log('skill', r.status());
await browser.close();
