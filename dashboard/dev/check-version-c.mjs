// Dev check for Version C, the script Mits writes himself on the Scripts tab: empty box, Start from A,
// unsaved state, save, approve, locked while chosen, Change my choice. Throwaway folder only; headless Edge.
// Run: node dashboard/dev/check-version-c.mjs   (screenshots: tmp/command-centre/version-c/)
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
const { loadConfig } = await import('../lib/config.mjs');
const { createServer } = await import('../server.mjs');

const out = join(import.meta.dirname, '..', '..', 'tmp', 'command-centre', 'version-c'); mkdirSync(out, { recursive: true });
const rep = []; const ok = (name, pass, extra = '') => rep.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
const BATCH = 'batch-2026-11-18-001', ITEM = '2026-11-18-001-01';
const bar = '='.repeat(40), sec = (n, b) => `${bar}\n${n}\n${bar}\n\n${b}\n\n`;

const cfg = loadConfig({ root: mkdtempSync(join(tmpdir(), 'vc-ui-')) });
cfg.missionCli = join(cfg.root, 'no-claudeclaw', 'bin', 'missing.mjs'); // never queue a real job from a check
const put = (p, t) => { mkdirSync(dirname(join(cfg.root, p)), { recursive: true }); writeFileSync(join(cfg.root, p), t); };
put(`instagram_scripts_output/${BATCH}/01-fixture-reel.txt`, `REEL 1: Fixture reel\nStatus: READY TO RECORD\n\n${sec('VERSION A', 'Version A hook.\nVersion A payoff.')}${sec('VERSION B', 'Version B hook.\nVersion B payoff.')}${sec('FINAL COMPARISON', 'A is safer.')}`);

const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const srv = createServer(cfg); await new Promise(r => srv.listen(0, '127.0.0.1', r));
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); const errs = [];
page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('dialog', d => d.accept());
const settle = () => page.waitForTimeout(400);
const text = () => page.evaluate(() => document.querySelector('#app').innerText);
const visible = sel => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.hidden && e.getBoundingClientRect().height > 0; }, sel);
const shot = l => page.screenshot({ path: join(out, `${l}.png`), fullPage: true });
const cFile = join(cfg.root, 'reels-data/content/version-c', ITEM + '.txt');
try {
  await page.goto('http://localhost:' + srv.address().port); await page.waitForSelector('#nav button'); await settle();
  let t = await text();
  ok('Needs me names all three versions', /Choose Version A, B or C/.test(t));
  await page.click(`[data-open="${ITEM}"]`); await page.waitForSelector('#vctext'); await settle();
  ok('the Scripts tab shows an empty Version C box beside A and B', (await page.inputValue('#vctext')) === '' && /Version C \(yours\)/.test(await text()));
  ok('Version C cannot be approved while empty', !(await visible('[data-vcapprove]')));
  ok('there are no Start from A or B buttons', !(await page.$('[data-vcfrom]')) && !/Start from/.test(await text()));
  await shot('1-empty');
  await page.fill('#vctext', 'Version A hook.\nMy own payoff, combining both.'); await settle();
  ok('typing shows Approve Version C and "Not saved"', (await visible('[data-vcapprove]')) && await visible('#vcdirty'));
  await shot('2-edited');
  await page.click('[data-vcsave]'); await page.waitForTimeout(900);
  ok('Save without approving writes the file in reels-data/content/version-c', existsSync(cFile) && readFileSync(cFile, 'utf8') === 'Version A hook.\nMy own payoff, combining both.\n');
  ok('after saving, "Not saved" goes and nothing is chosen', !(await visible('#vcdirty')) && !/You chose Version C/.test(await text()));
  await page.focus('#vctext'); await page.keyboard.press('Control+End'); await page.keyboard.type(' extra'); await settle();
  ok('typing after a save reads "Not saved", Approve still offered', (await visible('#vcdirty')) && await visible('[data-vcapprove]'));
  await page.click('[data-vcapprove]'); await page.waitForTimeout(1200); t = await text();
  ok('one click on Approve saves the unsaved words first', readFileSync(cFile, 'utf8') === 'Version A hook.\nMy own payoff, combining both. extra\n');
  ok('approving C records the choice and gives the approve-reel command with the file', /You chose Version C/.test(t) && /version C, batch batch-2026-11-18-001 \(Mits's own script, in reels-data\/content\/version-c\/2026-11-18-001-01\.txt/.test(t));
  ok('while chosen, the box is locked (shown as text, no textarea)', !(await page.$('#vctext')) && /My own payoff, combining both\. extra/.test(t));
  ok('A and B lose their approve buttons while C is chosen', !(await page.$('[data-decide="A"]')) && !(await page.$('[data-decide="B"]')));
  await shot('3-chosen');
  await page.click('[data-back]'); await settle(); t = await text();
  ok('Needs me then reads "Finish approving Version C"', /Finish approving Version C/.test(t));
  await page.click(`[data-open="${ITEM}"]`); await page.waitForSelector('[data-decide=""]'); await settle();
  await page.click('[data-decide=""]'); await page.waitForSelector('#vctext'); await settle();
  ok('Change my choice unlocks the box with the saved words', (await page.inputValue('#vctext')) === 'Version A hook.\nMy own payoff, combining both. extra');
  ok('no console or page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) { ok('the check ran to the end', false, e.message); await shot('error').catch(() => {}); }
await browser.close(); srv.close();
console.log(rep.join('\n')); const bad = rep.filter(r => r.startsWith('FAIL')).length;
console.log(`\n${rep.length - bad} passed, ${bad} failed. Screenshots: ${out}`); process.exit(bad ? 1 : 0);
