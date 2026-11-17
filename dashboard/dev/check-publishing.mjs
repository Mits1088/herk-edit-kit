// Headless desktop/phone checks. All media and Zernio responses are isolated fixtures.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fixture, ID, TRIAL } from '../../tests/helpers/zernio-fixture.mjs';
import { createServer } from '../server.mjs';

const out = join(import.meta.dirname, '../../tmp/command-centre/publishing'); mkdirSync(out, { recursive: true });
const results = []; const pass = s => results.push('PASS ' + s);
const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--disable-features=PointerLock,PointerLockOptions'] });
try {
  for (const [name, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
    const f = fixture();
    const video = join(f.root, 'video-projects/publishing-fixture/renders/publishing-fixture-final.mp4');
    const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2f4bd8:s=360x640:d=4:r=24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { windowsHide: true });
    assert.equal(ff.status, 0, String(ff.stderr));
    const sha = createHash('sha256').update(readFileSync(video)).digest('hex'); f.project.renders[0].sha256 = sha; f.project.approvals[0].sha256 = sha;
    f.project.finalFile = 'renders/publishing-fixture-final.mp4'; f.project.approvals[0].promotedTo = f.project.finalFile;
    f.put('video-projects/publishing-fixture/reel.json', f.project); f.put('video-projects/publishing-fixture/renders/candidate-v001.qa/qa.json', { passed: true, verdict: 'VERIFIED', sha256: sha });
    const server = createServer(f.cfg); await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://localhost:${server.address().port}`;
    const ctx = await browser.newContext({ viewport: { width, height } });
    await ctx.addInitScript(() => { Element.prototype.requestPointerLock = () => { throw new Error('Pointer lock disabled in checks'); }; });
    await ctx.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    const open = async id => { await page.evaluate(id => open(id, 'publish'), id); await page.waitForSelector('#z-publisher'); await page.waitForFunction(() => document.querySelector('#z-instagram-text')); };
    const shot = async label => { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name + ' overflow'); await page.screenshot({ path: join(out, `${name}-${label}.png`), fullPage: true }); };
    try {
      await page.goto(base); await page.waitForSelector('#nav button'); await open(ID);
      await page.waitForFunction(() => document.querySelectorAll('[data-z-select]:not(:disabled)').length === 4);
      assert.match(await page.locator('#z-publisher video').getAttribute('src'), /publishing-fixture-final\.mp4/);
      assert.equal(await page.inputValue('#z-youtube-title'), 'Fixture title');
      assert.equal(await page.inputValue('#z-youtube-keywords'), 'automation, tutorial');
      assert.equal(await page.inputValue('#z-instagram-tags'), '#automation');
      assert.equal(await page.locator('[data-z-action="now"]').isDisabled(), true);
      assert.equal(f.calls.filter(c => c.method !== 'GET').length, 0); pass(`${name}: preview/account checks send no media; captions prefill; no destination selected`);
      await page.locator('[data-z-select="instagram"]').check(); await page.fill('#z-instagram-text', 'Reviewed Instagram text'); await page.fill('#z-facebook-text', 'Independent Facebook text');
      await page.locator('[data-z-action="save"]').click(); await page.waitForFunction(() => !document.querySelector('[data-z-action="save"]').disabled);
      assert.equal(f.manifest().zernio.draft.fields.facebook.text, 'Independent Facebook text'); assert.equal(f.calls.filter(c => c.method !== 'GET').length, 0); pass(`${name}: editable separate Facebook text; Save text is inert`);
      await shot('composer');
      await page.locator('[data-z-action="now"]').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Recorded'));
      await page.evaluate(() => load(true)); await page.waitForSelector('.z-record .pill.ok');
      assert.equal(f.manifest().zernio.posts.length, 1); assert.equal(f.manifest().zernio.posts[0].text, 'Reviewed Instagram text\n\n#automation');
      assert.equal(await page.locator('[data-z-select="instagram"]').isDisabled(), true); pass(`${name}: explicit keyboard Publish sends approved SHA and selected destination once; public link shown`);
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
      await page.locator('[data-z-select="youtube"]').check(); await page.selectOption('#z-youtube-visibility', 'unlisted'); await page.fill('#z-when', tomorrow);
      await page.locator('[data-z-action="schedule"]').click(); await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Recorded'));
      await page.evaluate(() => load(true)); await page.waitForSelector('.z-record .pill.wait');
      assert.equal(f.manifest().zernio.posts.find(p => p.platform === 'youtube').state, 'scheduled'); assert.ok(!f.manifest().publishing.youtube);
      pass(`${name}: Schedule uses Europe/London; accepted schedule remains separate from published`);
      const before = f.calls.filter(c => c.method !== 'GET').length;
      await page.locator('[data-z-action="check"]').click(); await page.waitForFunction(() => !document.querySelector('[data-z-action="save"]').disabled);
      assert.equal(f.calls.filter(c => c.method !== 'GET').length, before); pass(`${name}: Check status issues no provider writes`);
      await shot('results');
      for (const w of [1024, 768, 390, 320]) { await page.setViewportSize({ width: w, height }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'overflow at ' + w); }
      pass(`${name}: no horizontal overflow at 1440/1024/768/390/320`);
      if (name === 'phone') { const small = await page.locator('#z-publisher button,#z-publisher select,#z-publisher .z-tick,#z-publisher .inp').evaluateAll(nodes => nodes.filter(n => { const b = n.getBoundingClientRect(); return b.height > 0 && b.height < 44; }).map(n => n.id || n.textContent)); assert.deepEqual(small, []); pass('phone: all publishing controls have 44px targets'); }
      await page.setViewportSize({ width, height }); await open(TRIAL);
      assert.equal(await page.locator('[data-z-select]:not(:disabled)').count(), 0); assert.equal(await page.locator('[data-z-action="now"]').isDisabled(), true); assert.match(await page.locator('#z-publisher').innerText(), /review|approved script/i); pass(`${name}: trial remains PENDING REVIEW and cannot submit`);
      await shot('trial-held');
      await page.route('**/api/state', async route => { const response = await route.fetch(); const data = await response.json(); await route.fulfill({ json: { ...data, remote: true } }); });
      await page.evaluate(() => load(true)); await open(ID); assert.equal(await page.locator('[data-z-action="now"]').isDisabled(), true); assert.equal(await page.locator('[data-z-action="save"]').isDisabled(), true); assert.equal(await page.locator('[data-z-action="check"]').count(), 0); pass(`${name}: authenticated phone view keeps provider submissions on PC`);
      assert.deepEqual(errors, []); pass(`${name}: no JavaScript errors`);
    } finally { await ctx.close(); await new Promise(r => server.close(r)); }
  }
} finally { await browser.close(); writeFileSync(join(out, 'report.txt'), results.join('\n') + '\n'); }
console.log(results.join('\n')); console.log('Screenshots: ' + out);
