// Diagnose a seek pixel diff: node scripts/diag-seek.mjs [t] [selectorToHide...]
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const [t = '0', ...hide] = process.argv.slice(2);
const b = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--allow-file-access-from-files', '--disable-gpu', '--force-color-profile=srgb', '--hide-scrollbars'] });
const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await p.goto(pathToFileURL(resolve('index.html')).href, { waitUntil: 'load' });
await p.evaluate(() => document.fonts.ready);
if (hide.length) await p.evaluate(h => h.forEach(s => document.querySelectorAll(s).forEach(e => e.style.setProperty('display', 'none', 'important'))), hide);
const seek = async x => { await p.evaluate(x => new Promise(r => { const tl = window.__timelines['hallmark-websites']; tl.seek(x, false); requestAnimationFrame(() => requestAnimationFrame(r)); }), x); return await p.screenshot(); };
const a = await seek(+t);
for (const x of [34.6, 29.633, 24.7, 19.767, 14.833, 9.867, 4.933]) await seek(x);
const c = await seek(+t);
const fs = await import('node:fs'); fs.writeFileSync('tmp/diag-a.png', a); fs.writeFileSync('tmp/diag-b.png', c);
await b.close();
