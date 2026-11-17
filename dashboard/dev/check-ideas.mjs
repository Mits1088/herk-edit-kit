// Dev check for saved ideas, Copy brief and the short-form export. Everything runs against a throwaway folder, so
// the real research store and the real Instagram_transcript/ are never touched. Headless Edge, desktop and phone
// widths, and a keyboard-only pass. Run: node dashboard/dev/check-ideas.mjs   (screenshots: tmp/research-ui/)
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { loadConfig } = await import('../lib/config.mjs');
const { createServer, lanAddresses } = await import('../server.mjs');
const { importBatch, readPost } = await import('../lib/research.mjs');
const { readIdeas } = await import('../lib/ideas.mjs');

const out = join(import.meta.dirname, '..', '..', 'tmp', 'research-ui'); mkdirSync(out, { recursive: true });
const rep = []; const ok = (name, pass, extra = '') => rep.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const now = new Date(), iso = d => d.toISOString().replace(/\.\d+Z$/, 'Z'), daysAgo = n => iso(new Date(now - n * 86400e3));
const SPOKEN = 'So Claude Code is actually better at N8N than N8N is itself. Let me explain.\nNote that this line is spoken: it stays in the transcript.';
const T = { full: 'Fixture: short with a full transcript', cap: 'Fixture: caption and excerpt only', nodur: 'Fixture: transcript but no duration', long: 'Fixture: long-form video', unk: 'Fixture: format unknown', tt: 'Fixture: TikTok without a transcript' };
const ig = (id, url, title, extra = {}) => ({ platform: 'instagram', id, provider: 'signal-room', url, format: 'short', creator: { handle: 'sample.creator' }, title, caption: 'Comment agent for the guide', publishedAt: daysAgo(3), durationSeconds: 39.1, transcript: null, observation: null, ...extra });

function store() {
  const cfg = loadConfig({ root: mkdtempSync(join(tmpdir(), 'ideas-ui-')) });
  importBatch(cfg, { schema: 1, batchId: 'fx-1', retrievedAt: daysAgo(1), search: { query: 'n8n', windowDays: 30 }, runs: [
    { provider: 'signal-room', lane: 'instagram_short_form', status: 'ok', results: ['instagram:3802204658396629750', 'instagram:3789920030163839258', 'instagram:3803030861483167224'] },
    { provider: 'signal-room', lane: 'youtube_long_form', status: 'ok', results: ['youtube:ynEEbqKQSaY'] },
    { provider: 'last30free', lane: 'youtube_discovery', status: 'ok', results: ['youtube:EuUF53Wwfm0'] },
    { provider: 'last30free', lane: 'tiktok_hashtag', status: 'ok', results: ['tiktok:7708502162103438612'] }],
  posts: [
    ig('3802204658396629750', 'https://www.instagram.com/p/DTEJP3rEQr2/', T.full, { transcript: { text: SPOKEN, origin: 'signal-room', capturedAt: daysAgo(2) }, excerpts: [{ kind: 'hook', text: 'So Claude Code is actually better at N8N than N8N is itself.', complete: false }], observation: { measuredAt: daysAgo(2), metrics: { plays: 34999, likes: 1220 } } }),
    ig('3789920030163839258', 'https://www.instagram.com/p/DSYgDAFDaka/', T.cap, { excerpts: [{ kind: 'snippet', text: 'If you are someone who uses N8N.' }] }),
    ig('3803030861483167224', 'https://www.instagram.com/p/DTHFGtQjU34/', T.nodur, { durationSeconds: null, transcript: { text: 'Spoken words here.', origin: 'signal-room', capturedAt: null } }),
    { platform: 'youtube', id: 'ynEEbqKQSaY', provider: 'signal-room', url: 'https://www.youtube.com/watch?v=ynEEbqKQSaY', format: 'long', creator: { name: 'A Channel' }, title: T.long, caption: 'Description text', publishedAt: daysAgo(2), durationSeconds: 754, transcript: { text: Array.from({ length: 300 }, (_, i) => 'word' + i).join(' '), origin: 'signal-room', capturedAt: null }, observation: { measuredAt: null, metrics: { views: 151632 } } },
    { platform: 'youtube', id: 'EuUF53Wwfm0', provider: 'last30free', url: 'https://www.youtube.com/watch?v=EuUF53Wwfm0', format: 'unknown', title: T.unk, publishedAt: daysAgo(1), durationSeconds: 45, transcript: { text: 'Subtitle words.', origin: 'subtitles', capturedAt: daysAgo(1) }, observation: null },
    { platform: 'tiktok', id: '7708502162103438612', provider: 'last30free', url: 'https://www.tiktok.com/@someone/video/7708502162103438612', format: 'short', title: T.tt, caption: 'my system #n8n', publishedAt: daysAgo(2), durationSeconds: 66, transcript: null, observation: { measuredAt: daysAgo(1), metrics: { views: 3260 }, discoveryScore: 7.6 } }] });
  return cfg;
}
const listen = (cfg, host = '127.0.0.1') => new Promise(r => { const s = createServer(cfg); s.listen(0, host, () => r(s)); });
const drop = cfg => (existsSync(cfg.dropDir) ? readdirSync(cfg.dropDir) : []);

for (const [name, w, h] of [['desk', 1280, 900], ['phone', 390, 844]]) {
  const cfg = store(); const srv = await listen(cfg); const base = 'http://localhost:' + srv.address().port;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ['clipboard-read', 'clipboard-write'] }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/status of 40[03]/.test(m.text())) errs.push(m.text()); });
  const settle = () => page.waitForTimeout(350);
  const text = () => page.evaluate(() => document.querySelector('#app').innerText);
  const clip = async () => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'); // Windows hands the clipboard back with CRLF
  const toastText = () => page.evaluate(() => { const t = document.querySelector('#toast'); return t.hidden ? '' : t.textContent; });
  const shot = async label => { const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(`${name} ${label}: no sideways scroll`, o <= 0, 'overflowX=' + o); await page.screenshot({ path: join(out, `${name}-ideas-${label}.png`), fullPage: true }); };
  const research = async () => { await page.click('button[data-view="research"]'); await page.waitForSelector('.r-seg'); await settle(); };
  const openPost = async title => { if (await page.locator('[data-r-back]').count()) { await page.click('[data-r-back]'); await settle(); } if (!(await page.locator('#r-form').count())) { await page.click('[data-r-tab="signals"]'); await page.waitForSelector('#r-form'); await settle(); } await page.locator('.r-open', { hasText: title }).first().click(); await page.waitForSelector('#r-title'); await settle(); };
  const small = () => page.evaluate(() => [...document.querySelectorAll('#research-root button, #research-root textarea, #research-root select, #research-root input')].filter(c => { const b = c.getBoundingClientRect(); return b.height > 0 && b.height < 44; }).map(c => (c.innerText || c.id).slice(0, 30) + ':' + Math.round(c.getBoundingClientRect().height)));

  await page.goto(base); await page.waitForSelector('#nav button'); await research();
  ok(`${name}: Research has an Ideas view between Signals and Searches`, (await page.evaluate(() => [...document.querySelectorAll('.r-seg button')].map(b => b.textContent).join(','))) === 'Signals,Ideas,Searches');
  await page.click('[data-r-tab="ideas"]'); await settle();
  ok(`${name}: empty Ideas view explains how to save one`, /No idea is saved yet/.test(await text()));

  // ---- save a post that has no transcript, by keyboard, and press the button more than once ----
  await openPost(T.tt); let t = await text();
  ok(`${name}: the idea panel sits above a "Source evidence" heading`, await page.evaluate(() => { const p = document.querySelector('.r-idea'), h = document.querySelector('.r-divide'); return !!p && !!h && h.textContent === 'Source evidence' && !!(p.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING) && !p.contains(document.querySelector('.r-text')); }));
  ok(`${name}: an unsaved post offers Save idea and no export`, /Works with or without a transcript/.test(t) && await page.locator('[data-r-export]').count() === 0 && await page.locator('[data-r-copybrief]').count() === 0);
  await page.focus('#r-angle'); await page.keyboard.type('Show the build live.'); await page.keyboard.press('Tab');
  ok(`${name}: Tab moves from the angle box to Save idea`, await page.evaluate(() => document.activeElement.dataset.rSave === '1'));
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.waitForSelector('[data-r-angle]'); await settle();
  ok(`${name}: Save idea from the keyboard, pressed twice, saves exactly one idea`, readIdeas(cfg).length === 1 && readIdeas(cfg)[0].angle === 'Show the build live.', JSON.stringify(readIdeas(cfg).map(i => i.angle)));
  const again = await page.evaluate(async id => (await (await fetch('/api/research/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'save-idea', postId: id, angle: 'other words' }) })).json()).message, 'tiktok-7708502162103438612');
  ok(`${name}: a repeated save request changes nothing`, /Already saved/.test(again) && readIdeas(cfg).length === 1 && readIdeas(cfg)[0].angle === 'Show the build live.', again);
  t = await text();
  ok(`${name}: caption-only post cannot export and says why`, await page.locator('[data-r-export]').count() === 0 && /Not available for this post/.test(t) && /A caption or a search excerpt is not a transcript/.test(t));
  ok(`${name}: focus stays in the idea panel after saving`, await page.evaluate(() => !!document.activeElement.closest('.r-idea')));
  if (name === 'phone') ok('phone: idea controls are at least 44px tall', (await small()).length === 0, (await small()).join(', '));
  await shot('saved-no-transcript');

  // ---- edit the note; it survives a refresh and a research import ----
  await page.fill('#r-angle', 'Show the build live,\nthen the result.'); await page.click('[data-r-angle]'); await settle();
  ok(`${name}: Save angle stores the edited note`, readIdeas(cfg)[0].angle === 'Show the build live,\nthen the result.' && /Angle saved/.test(await toastText()));
  const before = readFileSync(join(cfg.researchDir, 'ideas.json'), 'utf8');
  importBatch(cfg, { schema: 1, batchId: 'fx-2-' + name, retrievedAt: iso(now), search: { query: 'n8n', windowDays: 30 }, runs: [{ provider: 'last30free', lane: 'tiktok_hashtag', status: 'ok', results: ['tiktok:7708502162103438612'] }], posts: [{ platform: 'tiktok', id: '7708502162103438612', provider: 'last30free', url: 'https://www.tiktok.com/@someone/video/7708502162103438612', format: 'short', title: T.tt, publishedAt: daysAgo(2), durationSeconds: 66, observation: { measuredAt: iso(now), metrics: { views: 4100 } } }] });
  await page.reload(); await page.waitForSelector('#nav button'); await research();
  ok(`${name}: the saved post is badged in Signals after a refresh`, await page.locator('.r-saved').count() === 1);
  await openPost(T.tt);
  ok(`${name}: the note survives a refresh and a research import`, (await page.inputValue('#r-angle')) === 'Show the build live,\nthen the result.' && readFileSync(join(cfg.researchDir, 'ideas.json'), 'utf8') === before && /4,?100/.test(await text()));

  // ---- posts that must not export ----
  for (const [title, why] of [[T.cap, /A caption or a search excerpt is not a transcript/], [T.nodur, /The duration is unknown/], [T.unk, /not verified as short-form/]]) {
    await openPost(title); await page.click('[data-r-save]'); await page.waitForSelector('[data-r-angle]'); await settle(); t = await text();
    ok(`${name}: "${title.replace('Fixture: ', '')}" saves but offers no export`, await page.locator('[data-r-export]').count() === 0 && why.test(t), (t.match(/Not available for this post:[^]*?\n\n/) || [''])[0].replace(/\s+/g, ' ').slice(0, 160));
  }
  const refused = await page.evaluate(async () => { const r = await fetch('/api/research/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'export-idea', ideaId: 'idea-instagram-3803030861483167224' }) }); return [r.status, (await r.json()).error]; });
  ok(`${name}: a forced export request for one of them is refused and writes nothing`, refused[0] === 400 && /^Cannot export/.test(refused[1]) && drop(cfg).length === 0, refused.join(' '));

  // ---- long-form: save and copy a brief ----
  await openPost(T.long); await page.fill('#r-angle', 'Compare it with my own agent setup.'); await page.click('[data-r-save]'); await page.waitForSelector('[data-r-copybrief]'); await settle(); t = await text();
  ok(`${name}: long-form saves, with no export and a plain reason`, await page.locator('[data-r-export]').count() === 0 && /long-form\. Its production workflow is not connected yet; copy the brief instead/.test(t));
  await page.click('[data-r-copybrief]'); await settle(); let b = await clip();
  ok(`${name}: Copy brief for long-form carries the link, format, angle and labelled evidence`, /Brief copied/.test(await toastText()) && b.includes('Source: https://www.youtube.com/watch?v=ynEEbqKQSaY') && b.includes('Platform and format: YouTube, long-form') && b.includes('MY ANGLE (my own direction, not from the source)\nCompare it with my own agent setup.') && b.includes('CAPTION OR DESCRIPTION (written by the creator, not spoken)\nDescription text') && b.includes('TRANSCRIPT EXCERPT (spoken words: the first 250 of 300'), b.slice(0, 120).replace(/\n/g, ' / '));
  await shot('long-form-brief-only');

  // ---- the qualifying short: export, repeat, file, command, Pipeline link ----
  await openPost(T.full); await page.fill('#r-angle', 'Open on the finished workflow,\nthen show how it was built.'); await page.click('[data-r-save]'); await page.waitForSelector('[data-r-export]'); await settle();
  await page.click('[data-r-copybrief]'); await settle(); b = await clip();
  ok(`${name}: the short's brief labels the search excerpt, caption and full transcript separately`, b.includes('SEARCH EXCERPT (opening lines, returned by Signal Room; word for word but only partly copied; not the full transcript)') && b.includes('CAPTION OR DESCRIPTION (written by the creator, not spoken)') && b.includes('FULL TRANSCRIPT (spoken words, 26 words)'));
  await shot('ready-to-export');
  await page.focus('[data-r-export]'); await page.keyboard.press('Enter'); await page.waitForSelector('[data-r-pipeline]'); await settle(); t = await text();
  const file = 'research-instagram-3802204658396629750.md';
  const body = existsSync(join(cfg.dropDir, file)) ? readFileSync(join(cfg.dropDir, file), 'utf8') : '';
  ok(`${name}: export from the keyboard writes one file in the workflow's format`, drop(cfg).length === 1 && body === `## Reel: sample.creator — ${T.full}\n\nSource: https://www.instagram.com/p/DTEJP3rEQr2/\nDuration: 39s\nStats: published ${daysAgo(3).slice(0, 10)}, 34999 plays, 1220 likes (Signal Room, measured ${daysAgo(2).slice(0, 10)})\nNote from Mits: Open on the finished workflow, then show how it was built.\n\n${SPOKEN}\n`, body.slice(0, 200).replace(/\n/g, ' / '));
  ok(`${name}: after export the page shows the file and the /rewrite-reels command`, t.includes('Instagram_transcript/' + file) && /\/rewrite-reels/.test(t) && /waiting in Instagram_transcript/.test(t) && await page.locator('[data-r-export]').count() === 0);
  ok(`${name}: focus lands on Copy command after export`, await page.evaluate(() => document.activeElement.dataset.rCopy === '/rewrite-reels'));
  await page.keyboard.press('Enter'); await settle();
  ok(`${name}: Copy command copies /rewrite-reels`, (await clip()) === '/rewrite-reels');
  const rep2 = await page.evaluate(async () => (await (await fetch('/api/research/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'export-idea', ideaId: 'idea-instagram-3802204658396629750' }) })).json()).message);
  ok(`${name}: a repeated export writes nothing`, /Already exported/.test(rep2) && readFileSync(join(cfg.dropDir, file), 'utf8') === body && readIdeas(cfg).find(i => i.id === 'idea-instagram-3802204658396629750').exports.length === 1, rep2);
  ok(`${name}: an exported idea has no Remove button`, await page.locator('[data-r-remove]').count() === 0);
  await page.fill('#r-angle', 'A different angle now.'); await page.click('[data-r-angle]'); await settle();
  ok(`${name}: changing the angle after export is flagged, and the file is left alone`, /still carries the earlier one/.test(await text()) && readFileSync(join(cfg.dropDir, file), 'utf8') === body);
  await shot('exported');
  await page.click('[data-r-pipeline]'); await page.waitForSelector('[data-tab-go]'); await settle();
  ok(`${name}: the Pipeline link opens the real linked item`, /sample/i.test(await text()) && await page.locator('[data-tab-go]').count() === 5 && /Back to Research/.test(await text()));
  await page.click('.back'); await page.waitForSelector('#research-root'); await settle();
  // the file leaves the drop folder altogether: the link is not invented
  renameSync(join(cfg.dropDir, file), join(cfg.root, 'moved-away.md'));
  await page.reload(); await page.waitForSelector('#nav button'); await research(); await openPost(T.full); t = await text();
  ok(`${name}: with the file gone there is no Pipeline link`, await page.locator('[data-r-pipeline]').count() === 0 && /No Pipeline item is linked to this file yet/.test(t) && /no longer in the drop folder/.test(t));

  // ---- Ideas view ----
  await page.click('[data-r-back]'); await settle(); await page.click('[data-r-tab="ideas"]'); await page.waitForSelector('.r-ideas'); await settle(); t = await text();
  ok(`${name}: Ideas lists all six saved ideas with their state`, await page.locator('.r-ideas > section').count() === 6 && /Exported to the script workflow/.test(t) && /Brief only/.test(t) && /Your angle/.test(t));
  await page.locator('.r-ideas > section', { hasText: T.long }).locator('[data-r-briefof]').click(); await settle();
  ok(`${name}: Copy brief works from the Ideas list`, (await clip()).includes('Compare it with my own agent setup.'));
  if (name === 'phone') ok('phone: Ideas list controls are at least 44px tall', (await small()).length === 0, (await small()).join(', '));
  ok(`${name}: every Ideas control has a name`, await page.evaluate(() => [...document.querySelectorAll('#research-root button')].every(c => c.textContent.trim() || c.getAttribute('aria-label'))));
  await shot('list');

  // ---- remove, by keyboard, with a confirmation that defaults to keeping ----
  await page.locator('.r-ideas > section', { hasText: T.cap }).locator('.r-open').click(); await page.waitForSelector('#r-title'); await settle();
  await page.focus('[data-r-remove]'); await page.keyboard.press('Enter'); await settle();
  ok(`${name}: Remove asks first and puts focus on "Keep it"`, await page.evaluate(() => document.activeElement.dataset.rRemoveno === '1') && readIdeas(cfg).length === 6);
  await page.keyboard.press('Enter'); await settle();
  ok(`${name}: "Keep it" keeps the idea`, readIdeas(cfg).length === 6 && await page.locator('[data-r-remove]').count() === 1);
  await page.click('[data-r-remove]'); await page.click('[data-r-removeyes]'); await page.waitForSelector('[data-r-save]'); await settle();
  ok(`${name}: confirming removes the idea and leaves the post`, readIdeas(cfg).length === 5 && !!readPost(cfg, 'instagram-3789920030163839258'));
  await page.click('[data-r-back]'); await page.waitForSelector('.r-ideas'); await settle();
  ok(`${name}: Back from an idea returns to the Ideas list`, await page.locator('.r-ideas > section').count() === 5);

  // ---- the rest of the Command Centre ----
  for (const v of ['attention', 'pipeline', 'schedule']) { await page.click(`button[data-view="${v}"]`); await settle(); ok(`${name}: ${v} view still renders`, await page.evaluate(() => !!document.querySelector('#app h2') && !document.querySelector('#research-root'))); }
  await research(); await page.click('[data-r-tab="searches"]'); await page.waitForSelector('[data-r-show]');
  ok(`${name}: Signals and Searches still open`, true);
  ok(`${name}: no console or page errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close(); srv.close();
}

// ---- a phone on the home network: may read the idea, may not save, edit or export ----
const ip = lanAddresses()[0];
if (!ip) rep.push('SKIP  home-network phone view: this PC has no home-network address');
else {
  const cfg = store(); const tok = 'k'.repeat(45); const srv = await listen({ ...cfg, lan: true, token: tok }, '0.0.0.0'); const base = `http://${ip}:${srv.address().port}`;
  const { ideaAction } = await import('../lib/ideas.mjs'); ideaAction(cfg, { type: 'save-idea', postId: 'tiktok-7708502162103438612', angle: 'Saved on the PC.' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage();
  await page.goto(base + '/?k=' + tok); await page.waitForSelector('#nav button'); await page.click('button[data-view="research"]'); await page.waitForSelector('#r-form'); await page.waitForTimeout(350);
  await page.locator('.r-open', { hasText: T.tt }).first().click(); await page.waitForSelector('#r-title'); await page.waitForTimeout(350);
  const t = await page.evaluate(() => document.querySelector('.r-idea').innerText);
  ok('remote phone: shows the saved angle read-only, with no save, edit or export control', /Saved on the PC\./.test(t) && /on the PC/.test(t) && await page.locator('.r-idea button, .r-idea textarea').count() === 0, t.replace(/\s+/g, ' ').slice(0, 140));
  await page.screenshot({ path: join(out, 'remote-ideas-read-only.png'), fullPage: true });
  await ctx.close(); srv.close();
}

await browser.close();
console.log(rep.join('\n')); console.log(`\n${rep.filter(r => r.startsWith('PASS')).length} passed, ${rep.filter(r => r.startsWith('FAIL')).length} failed. Screenshots: ${out}`);
process.exit(rep.some(r => r.startsWith('FAIL')) ? 1 : 0);
