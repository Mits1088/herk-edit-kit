import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const root = resolve(import.meta.dirname, '..');
const skill = join(root, '.claude/skills/create-reel');
const require = createRequire(import.meta.url);
const { getProfile, safeRect, loadProfiles, readComposition } = await import('../.claude/skills/create-reel/scripts/lib.mjs');
const { convertToVertical, compositionId } = await import('../.claude/skills/create-reel/scripts/new-reel.mjs');
function scratch() { return mkdtempSync(join(tmpdir(), 'reel-studio-test-')); }

test('create-reel skill has the required frontmatter and consumes $ARGUMENTS', () => {
  const text = readFileSync(join(skill, 'SKILL.md'), 'utf8');
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(front, 'frontmatter block');
  const fields = Object.fromEntries(front[1].split(/\r?\n/).map(l => l.match(/^([a-z-]+):\s*(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]));
  assert.equal(fields.name, 'create-reel');
  assert.match(fields.description, /^Create, edit, render and quality-check premium Instagram Reels using Herk Edit Kit, motionmaxxing and HyperFrames\. The default for any Reel/);
  assert.equal(fields['argument-hint'], '"[Describe your Reel]"');
  assert.ok(!('disable-model-invocation' in fields), 'Claude can load create-reel for a plain-language Reel request');
  const body = text.slice(front[0].length);
  assert.match(body, /\$ARGUMENTS/);
  assert.match(body, /If the brief above is empty, use the user's request from the conversation/);
});

test('Reel requests route to create-reel in both guides; short-form-edit stays for cutting-only work', () => {
  const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
  assert.equal(claude, readFileSync(join(root, 'AGENTS.md'), 'utf8'), 'CLAUDE.md and AGENTS.md stay synchronized');
  assert.match(claude, /\| Reels, Shorts, and short advertisements \(default\) \| `create-reel` \|/);
  assert.match(claude, /\| Cutting-only short-form work on talking-head footage \| `short-form-edit` \|/);
  assert.match(readFileSync(join(root, '.claude/skills/short-form-edit/SKILL.md'), 'utf8'), /^description: .*New Reels and Shorts start in create-reel/m);
  assert.equal(readFileSync(join(root, '.agents/skills/create-reel/SKILL.md'), 'utf8').includes('disable-model-invocation'), false, 'Codex copy is in sync');
});

test('ReelEases are numerically identical to motionmaxxing measured eases', () => {
  const eases = require(join(skill, 'runtime/reel-eases.js'));
  const motion = readFileSync(join(root, '.claude/skills/motionmaxxing/runtime/motion.js'), 'utf8');
  const block = motion.slice(motion.indexOf('const powerOut'), motion.indexOf('const E = e =>'));
  const upstream = vm.runInNewContext(`${block}; ({ EASE, EASE_FRAMES })`, { Math });
  // Objects from the vm context have that realm's prototypes; compare plain copies.
  assert.deepEqual(eases.names, [...Object.keys(upstream.EASE)]);
  assert.deepEqual(eases.frames, JSON.parse(JSON.stringify(upstream.EASE_FRAMES)));
  for (const name of eases.names) {
    assert.equal(eases[name](0), 0, `${name}(0)`);
    assert.equal(eases[name](1), 1, `${name}(1)`);
    for (let t = 0; t <= 1; t += 0.05) assert.equal(eases[name](t), upstream.EASE[name](t), `${name}(${t})`);
  }
  assert.equal(eases.dur('softLand'), 0.4);
  assert.equal(eases.dur('softLand', 60), 0.2);
});

test('profiles resolve and safe areas land on the documented pixels', () => {
  for (const name of Object.keys(loadProfiles().profiles)) {
    const p = getProfile(name);
    assert.equal(p.width, 1080); assert.equal(p.height, 1920);
    assert.ok(p.fps === 30 || p.fps === 60);
    assert.ok(p.duration.min <= p.duration.default && p.duration.default <= p.duration.max);
  }
  assert.equal(getProfile('organic-60').fps, 60);
  assert.deepEqual(safeRect(getProfile('organic')), { x0: 90, y0: 200, x1: 930, y1: 1600, w: 840, h: 1400 });
  assert.deepEqual(safeRect(getProfile('ad')), { x0: 65, y0: 269, x1: 1015, y1: 1248, w: 950, h: 979 });
  assert.equal(safeRect(getProfile('ad-disclaimer')).y1, 1152);
  assert.throws(() => getProfile('nope'), /Unknown profile/);
});

test('a generated starter converts to one consistent native vertical composition', () => {
  const dir = join(scratch(), 'my-reel');
  cpSync(join(root, 'examples/starter'), dir, { recursive: true });
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets/gsap.min.js'), '');
  const profile = getProfile('organic-60');
  const { id } = convertToVertical(dir, { slug: 'my-reel', profile, duration: 12, mode: 'brand', title: 'A <b>"test"</b>', brandDesign: '# Brand\n\nPalette.' });
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const c = readComposition(html);
  assert.equal(id, 'my-reel');
  assert.deepEqual([c.id, c.elementId, c.width, c.height, c.duration], [id, id, 1080, 1920, 12]);
  assert.deepEqual(c.timelineRegistrations, [id]);
  assert.equal(c.gsapScripts, 1);
  assert.deepEqual([meta.id, meta.width, meta.height, meta.fps], [id, 1080, 1920, 60]);
  assert.match(html, /data-fps="60"/);
  assert.match(html, /<title>A &lt;b&gt;&quot;test&quot;&lt;\/b&gt;<\/title>/);
  assert.doesNotMatch(html, /\{\{|1920px;height:1080px|motion\.js/);
  assert.match(readFileSync(join(dir, 'assets/reel-eases.js'), 'utf8'), /ReelEases/);
  const design = readFileSync(join(dir, 'DESIGN.md'), 'utf8');
  assert.match(design, /^# Brand/);
  assert.match(design, /x 90-930, y 200-1600/);
  const reel = JSON.parse(readFileSync(join(dir, 'reel.json'), 'utf8'));
  assert.deepEqual([reel.profile, reel.mode, reel.fps, reel.renders.length], ['organic-60', 'brand', 60, 0]);
  assert.deepEqual([reel.preflightRequired, reel.preflight], [true, null], 'new reels start behind the creative preflight (Gate B)');
});

test('composition ids stay valid CSS selectors', () => {
  assert.equal(compositionId('launch-film'), 'launch-film');
  assert.equal(compositionId('2026-launch'), 'reel-2026-launch');
});
