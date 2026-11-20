// Dev check for transcripts pasted by hand on a research post (Research > a post > Evidence saved).
// Throwaway folder only; the page part runs in headless Edge. Run: node dashboard/dev/check-manual-transcript.mjs
import { chromium } from 'playwright';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { loadConfig } = await import('../lib/config.mjs');
const { createServer } = await import('../server.mjs');
const { importBatch } = await import('../lib/research.mjs');
const { ideaAction, readIdeas } = await import('../lib/ideas.mjs');

const rep = []; const ok = (name, pass, extra = '') => rep.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const iso = d => d.toISOString().replace(/\.\d+Z$/, 'Z'), daysAgo = n => iso(new Date(Date.now() - n * 86400e3));
const NO = '3802204658396600001', HAS = '3802204658396600002', UI = '3802204658396600003';
const post = (id, transcript) => ({ platform: 'instagram', id, provider: 'signal-room', url: `https://www.instagram.com/p/X${id.slice(-1)}/`, format: 'short', creator: { handle: 'sample.creator' }, title: `Fixture post ${id.slice(-1)}`, publishedAt: daysAgo(3), durationSeconds: 40, caption: 'A caption, not spoken words.', transcript, observation: null });
const cfg = loadConfig({ root: mkdtempSync(join(tmpdir(), 'manual-tr-')) });
importBatch(cfg, { schema: 1, batchId: 'fx-1', retrievedAt: daysAgo(1), search: { query: 'claude', windowDays: 30 }, runs: [{ provider: 'signal-room', lane: 'instagram_short_form', status: 'ok', results: [NO, HAS, UI].map(x => 'instagram:' + x) }],
  posts: [post(NO, null), post(HAS, { text: 'Fetched spoken words.', origin: 'signal-room', capturedAt: daysAgo(1) }), post(UI, null)] });

// ---- server side ----
const P = 'instagram-' + NO;
ok('empty paste is refused', throws(() => ideaAction(cfg, { type: 'set-transcript', postId: P, text: '   ' }), /Paste the transcript/));
ok('a post with a fetched transcript refuses a pasted one', throws(() => ideaAction(cfg, { type: 'set-transcript', postId: 'instagram-' + HAS, text: 'x' }), /already has a fetched transcript/));
let r = ideaAction(cfg, { type: 'set-transcript', postId: P, text: 'Hello there.\r\nThis is what was said.', angle: 'Show it live' });
let idea = readIdeas(cfg).find(i => i.postId === P);
ok('saving a transcript also saves the idea, with the angle', /and the idea/.test(r.message) && idea && idea.angle === 'Show it live' && idea.transcript.text === 'Hello there.\nThis is what was said.' && idea.transcript.by === 'manual');
ok('the same paste again changes nothing', ideaAction(cfg, { type: 'set-transcript', postId: P, text: 'Hello there.\nThis is what was said.' }).message === 'No change.');
ideaAction(cfg, { type: 'set-transcript', postId: P, text: 'Hello there. This is what was said, edited.' });
ok('editing replaces the pasted text', readIdeas(cfg).find(i => i.postId === P).transcript.text.endsWith('edited.'));
ideaAction(cfg, { type: 'remove-transcript', ideaId: idea.id });
idea = readIdeas(cfg).find(i => i.postId === P);
ok('removing the transcript keeps the idea', idea && !idea.transcript && idea.angle === 'Show it live');
ideaAction(cfg, { type: 'set-transcript', postId: P, text: 'Final spoken words for export.' });

const srv = createServer(cfg); await new Promise(res => srv.listen(0, '127.0.0.1', res)); const base = `http://127.0.0.1:${srv.address().port}`;
const d = await (await fetch(`${base}/api/research/post?id=${P}`)).json();
ok('the post view labels the transcript as pasted and allows export', d.manualTranscript === true && d.evidence === 'manual' && d.transcriptText === 'Final spoken words for export.' && d.handoff.ok && /pasted by Mits/.test(d.brief));
const list = await (await fetch(`${base}/api/research/ideas`)).json();
ok('the Ideas list shows it as a pasted transcript', list.ideas.find(x => x.idea.postId === P).post.evidence === 'manual');
r = ideaAction(cfg, { type: 'export-idea', ideaId: idea.id });
const file = join(cfg.dropDir, `research-instagram-${NO}.md`);
ok('export writes the pasted words as the transcript', existsSync(file) && readFileSync(file, 'utf8').trimEnd().endsWith('Final spoken words for export.') && /Note from Mits: Show it live/.test(readFileSync(file, 'utf8')));
ok('after export the pasted transcript is locked', throws(() => ideaAction(cfg, { type: 'set-transcript', postId: P, text: 'changed' }), /already exported/) && throws(() => ideaAction(cfg, { type: 'remove-transcript', ideaId: idea.id }), /already exported/));
const h = await (await fetch(`${base}/api/research/post?id=instagram-${HAS}`)).json();
ok('a fetched transcript is shown as fetched', !h.manualTranscript && h.transcriptText === 'Fetched spoken words.');

// ---- the page ----
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
for (const [name, w] of [['desk', 1280], ['phone', 390]]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: 900 } })).newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(base); await page.waitForSelector('[data-view="research"]'); await page.click('[data-view="research"]');
  await page.evaluate(id => window.Research.open(id), 'instagram-' + UI); await page.waitForSelector(name === 'desk' ? '#r-trtext' : '#r-transcript');
  if (name === 'desk') {
    await page.fill('#r-trtext', 'Typed by hand in the page.'); await page.click('[data-r-trsave]'); await page.waitForSelector('#r-transcript');
    const t = await page.textContent('[aria-label="Evidence"]');
    ok('page: Save transcript shows it, labelled as pasted by you, with Edit and Remove', /pasted by you/.test(t) && /Typed by hand in the page\./.test(t) && !!(await page.$('[data-r-tredit]')) && !!(await page.$('[data-r-trremove]')));
    ok('page: the idea panel now shows Saved and the export button', /Saved/.test(await page.textContent('.r-idea')) && !!(await page.$('[data-r-export]')));
    await page.click('[data-r-tredit]'); ok('page: Edit opens the box with the saved text', (await page.inputValue('#r-trtext')) === 'Typed by hand in the page.');
    await page.click('[data-r-trcancel]');
    await page.screenshot({ path: join(import.meta.dirname, '..', '..', 'tmp', 'command-centre', 'manual-transcript-desk.png'), fullPage: true });
  } else {
    ok('phone: no sideways scroll on the post page', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  ok(`${name}: no console or page errors`, errs.length === 0, errs.join(' | '));
}
await browser.close(); srv.close();
console.log(rep.join('\n')); const f = rep.filter(x => x.startsWith('FAIL')).length; console.log(`\n${rep.length - f} passed, ${f} failed.`); process.exit(f ? 1 : 0);
