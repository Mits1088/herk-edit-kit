// Per-cue audio QA (create-reel qa-core cueChecks) against the house profile, on synthetic stems.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cueChecks, loadAudioProfile, pauseAround, lufsOf } from '../.claude/skills/create-reel/scripts/qa-core.mjs';
import { kitRoot } from '../.claude/skills/create-reel/scripts/lib.mjs';

const SR = 16000, D = 6;
const P = loadAudioProfile(kitRoot);
// words every 0.5 s with a 1 s pause from 2.55 to 3.6 s
const words = [0.2, 0.7, 1.2, 1.7, 2.2, 3.6, 4.1, 4.6, 5.1].map((s, i) => ({ text: `w${i}`, start: s, end: s + 0.35 }));
const voice = new Float32Array(D * SR);
for (const w of words) for (let i = Math.floor(w.start * SR); i < w.end * SR; i++) voice[i] = 0.2 * Math.sin(2 * Math.PI * 1500 * i / SR);
const toneAt = (amp, f = 1500, len = 0.3) => Float32Array.from({ length: Math.floor(len * SR) }, (_, i) => amp * Math.sin(2 * Math.PI * f * i / SR));
const dbAmp = (dB) => 0.2 * 10 ** (dB / 20); // a 1.5 kHz tone this far from the voice's speaking level

function build(list) { // list of { name, role, start, sig, event? } -> cueChecks inputs
  const total = list.reduce((n, c) => n + c.sig.length, 0), applied = new Float32Array(total), sfx = new Float32Array(voice.length);
  let off = 0; const cues = [];
  for (const c of list) {
    applied.set(c.sig, off); const a = Math.floor(c.start * SR); for (let i = 0; i < c.sig.length && a + i < sfx.length; i++) sfx[a + i] += c.sig[i];
    cues.push({ name: c.name, role: c.role, event: c.event || null, at: c.at ?? c.start, start: c.start, end: c.start + c.sig.length / SR, offset: off, length: c.sig.length });
    off += c.sig.length;
  }
  return { cues: { sr: SR, cues }, applied, sfx };
}
const run = (list, extra = {}) => { const b = build(list); return cueChecks({ cues: b.cues, applied: b.applied, voice, sfx: b.sfx, sr: SR, words, profile: P, ...b, ...extra }); };
const row = (rows, re) => rows.find((r) => re.test(r[1]));

test('a hero in a protected pause at its target passes; the same hero over a word fails', () => {
  const ok = run([{ name: 'cheer', role: 'hero', start: 2.7, sig: toneAt(dbAmp(-3), 1500, 0.5) }]);
  assert.equal(row(ok, /overpowering/)[2], 'PASS', row(ok, /overpowering/)[3]);
  assert.equal(row(ok, /hero sounds present/)[2], 'PASS', row(ok, /hero sounds present/)[3]);
  const over = run([{ name: 'cheer', role: 'hero', start: 4.1, sig: toneAt(dbAmp(-3), 1500, 0.3) }]);
  assert.equal(row(over, /overpowering/)[2], 'FAIL'); assert.match(row(over, /overpowering/)[3], /cheer \(hero\)/);
});

test('loud foley fails; quiet foley passes', () => {
  assert.equal(row(run([{ name: 'tick', role: 'foley', start: 1.25, sig: toneAt(dbAmp(-10), 1500, 0.1) }]), /overpowering/)[2], 'FAIL');
  assert.equal(row(run([{ name: 'tick', role: 'foley', start: 1.25, sig: toneAt(dbAmp(-24), 1500, 0.1) }]), /overpowering/)[2], 'PASS');
});

test('a hero that is too quiet fails, and says when it has no pause', () => {
  const r = row(run([{ name: 'cheer', role: 'hero', start: 2.7, sig: toneAt(dbAmp(-20), 1500, 0.5) }]), /hero sounds present/);
  assert.equal(r[2], 'FAIL'); assert.match(r[3], /too quiet/);
  const noPause = row(run([{ name: 'cheer', role: 'hero', start: 1.25, sig: toneAt(dbAmp(-20), 1500, 0.3) }]), /hero sounds present/);
  assert.match(noPause[3], /protect one in the cut/);
});

test('a planned hero event with no hero cue fails as missing', () => {
  const r = row(run([], { events: [{ time: 2.7, type: 'last-standing', sfx: { role: 'hero', why: 'payoff' } }] }), /hero sounds present/);
  assert.equal(r[2], 'FAIL'); assert.match(r[3], /no hero cue: last-standing/);
});

test('a cue 150 ms late warns; on time passes', () => {
  const ev = [{ time: 2.7, type: 'gate-slam' }];
  const late = row(run([{ name: 'slam', role: 'accent', start: 2.85, at: 2.85, event: 'gate-slam', sig: toneAt(dbAmp(-14), 1500, 0.2) }], { events: ev }), /land on their planned/);
  assert.equal(late[2], 'WARNING'); assert.match(late[3], /\+150 ms/);
  assert.equal(row(run([{ name: 'slam', role: 'accent', start: 2.7, at: 2.7, event: 'gate-slam', sig: toneAt(dbAmp(-14), 1500, 0.2) }], { events: ev }), /land on their planned/)[2], 'PASS');
});

test('music in the speech band at the voice level warns as masking', () => {
  const bed = Float32Array.from(voice, (_, i) => 0.15 * Math.sin(2 * Math.PI * 2000 * i / SR));
  const r = row(run([], { bed }), /leave the words clear/);
  assert.equal(r[2], 'WARNING'); assert.match(r[3], /"w0"/);
  const low = Float32Array.from(voice, (_, i) => 0.002 * Math.sin(2 * Math.PI * 2000 * i / SR));
  assert.equal(row(run([], { bed: low }), /leave the words clear/)[2], 'PASS');
});

test('encoded MP4 audio: a level drop and an offset warn; identical passes; limiter load is reported', () => {
  const list = [{ name: 'cheer', role: 'hero', start: 2.7, sig: toneAt(dbAmp(-3), 1500, 0.5) }], b = build(list);
  const mix = Float32Array.from(voice, (v, i) => v + b.sfx[i]);
  const same = run(list, { mix, encoded: mix });
  assert.equal(row(same, /encoded MP4/)[2], 'PASS', row(same, /encoded MP4/)[3]);
  const quieter = run(list, { mix, encoded: Float32Array.from(mix, (v) => v * 0.6) });
  assert.equal(row(quieter, /encoded MP4/)[2], 'WARNING');
  const shifted = new Float32Array(mix.length); shifted.set(mix.subarray(0, mix.length - 1600), 1600); // 100 ms late
  assert.match(row(run(list, { mix, encoded: shifted }), /encoded MP4/)[3], /offset 100 ms/);
  const lim = row(run(list, { report: { limiter: { max_reduction_db: 6, share_touched: 0.2 } } }), /limiter/);
  assert.equal(lim[2], 'WARNING');
});

test('helpers: pause length and loudness', () => {
  assert.ok(Math.abs(pauseAround(words, 3.0) - 1.05) < 1e-9);
  assert.equal(pauseAround(words, 0.3), 0);
  const tone = Float32Array.from({ length: SR * 2 }, (_, i) => 0.1 * Math.sin(2 * Math.PI * 1000 * i / SR));
  assert.ok(Math.abs(lufsOf(tone, SR) - -23.7) < 0.5, lufsOf(tone, SR)); // 0.1 amp sine at 1 kHz, mono: about -23.7 LUFS
});
