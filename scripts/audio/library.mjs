#!/usr/bin/env node
// House sound library: CC0 / public-domain sounds with verified licences, provenance, tags and measurements.
// Search it first; source from Openverse only when nothing fits.
//
//   node scripts/audio/library.mjs search <words...> [--role foley|accent|hero]
//   node scripts/audio/library.mjs openverse "<query>" [--n 8]     candidates -> audio-library/candidates/
//   node scripts/audio/library.mjs add <candidate-id> --id <name> --role <role> --tags a,b [--about "..."] [--trim start:end]
//   node scripts/audio/library.mjs list
//   node scripts/audio/library.mjs restore      rebuild missing library audio from file_url + trim (new machine / fresh clone)
//
// Licence rule (Mits, 2026-11-07): CC0 or Public Domain Mark only, checked on the ORIGINAL source page (not only
// Openverse's metadata); anything else, or a page that cannot be read, is refused. The index (library.json) is
// committed; the audio files stay local (*.wav / *.mp3 are gitignored), like all media in this kit.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB = join(ROOT, 'audio-library'), INDEX = join(LIB, 'library.json'), CAND = join(LIB, 'candidates');
const UA = { 'User-Agent': 'herk-edit-kit/1.0 (sound library)' };
const ROLES = ['foley', 'accent', 'hero'];

export const readIndex = () => (existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : { version: 1, sounds: [] });
const writeIndex = (x) => writeFileSync(INDEX, JSON.stringify(x, null, 1) + '\n');
const sha256 = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

// Licence check on the source page. CC0 or PDM link present, and no licence that needs attribution or restricts use.
export function licenceFromPage(html) {
  const cc0 = /creativecommons\.org\/publicdomain\/zero\/1\.0/i.test(html), pdm = /creativecommons\.org\/publicdomain\/mark\/1\.0/i.test(html);
  const other = html.match(/creativecommons\.org\/licenses\/(by|by-sa|by-nc|by-nd|by-nc-sa|by-nc-nd|sampling\+?)\/[\d.]+/i);
  if (other) return { ok: false, licence: other[0], reason: `source page shows ${other[0]}` };
  if (cc0) return { ok: true, licence: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' };
  if (pdm) return { ok: true, licence: 'PDM-1.0', url: 'https://creativecommons.org/publicdomain/mark/1.0/' };
  return { ok: false, reason: 'no CC0 or Public Domain Mark on the source page' };
}

export function search(index, words, role = null) {
  const q = words.map((w) => w.toLowerCase());
  return index.sounds.filter((s) => !role || s.role === role)
    .map((s) => ({ s, score: q.filter((w) => [s.id, s.about, ...(s.tags || [])].join(' ').toLowerCase().includes(w)).length }))
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.s);
}

function measure(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const num = (re) => { const m = [...r.matchAll(re)].at(-1); return m ? Number(m[1]) : null; };
  const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
  return { duration_s: Number(Number(p.stdout).toFixed(3)), integrated_lufs: num(/I:\s+(-?[\d.]+) LUFS/g), true_peak_dbfs: num(/Peak:\s+(-?[\d.]+) dBFS/g) };
}

async function openverse(query, n = 8) {
  const u = `https://api.openverse.org/v1/audio/?q=${encodeURIComponent(query)}&license=cc0,pdm&page_size=${Math.min(20, n * 2)}`;
  const res = await fetch(u, { headers: UA });
  if (!res.ok) throw new Error(`Openverse ${res.status}: ${await res.text()}`);
  const data = await res.json(); mkdirSync(CAND, { recursive: true });
  const cf = join(CAND, 'candidates.json'), known = existsSync(cf) ? JSON.parse(readFileSync(cf, 'utf8')) : {};
  const out = [];
  for (const r of data.results || []) {
    if (out.length >= n) break;
    if (!['cc0', 'pdm'].includes(r.license)) continue;
    const id = r.id.slice(0, 8), file = join(CAND, `${id}${extname(new URL(r.url).pathname) || '.mp3'}`);
    let lic;
    try { const page = await fetch(r.foreign_landing_url, { headers: UA, redirect: 'follow' }); lic = page.ok ? licenceFromPage(await page.text()) : { ok: false, reason: `source page ${page.status}` }; }
    catch (e) { lic = { ok: false, reason: `source page unreachable: ${e.message}` }; }
    const row = { id, openverse_id: r.id, title: r.title, creator: r.creator, source: r.source, source_url: r.foreign_landing_url, file_url: r.url,
      openverse_licence: r.license, verified: lic, verified_at: new Date().toISOString().slice(0, 10), query };
    if (lic.ok && !existsSync(file)) {
      const a = await fetch(r.url, { headers: UA }); if (!a.ok) { row.verified = { ok: false, reason: `download ${a.status}` }; }
      else writeFileSync(file, Buffer.from(await a.arrayBuffer()));
    }
    if (row.verified.ok) Object.assign(row, { file: file.slice(ROOT.length + 1).replaceAll('\\', '/'), ...measure(file) });
    known[id] = row; out.push(row);
  }
  writeFileSync(cf, JSON.stringify(known, null, 1) + '\n');
  return out;
}

function render(src, dest, trim) {
  const args = ['-v', 'error', '-y'];
  if (trim) { // seek on the input so the trimmed file starts at 0; trimmed edges get short fades so they never click
    const [a, b] = trim.split(':').map(Number);
    args.push('-ss', String(a), '-t', String(b - a), '-i', src, '-af', `afade=t=in:d=0.015,afade=t=out:st=${Math.max(0, b - a - 0.25).toFixed(3)}:d=0.25`);
  } else args.push('-i', src);
  args.push('-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', dest);
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr);
}

// Rebuild library audio that is missing locally (it is gitignored): download the original from file_url, check it
// against original_sha256, re-apply the same trim and compare with sha256. Existing files are only checked.
async function restore() {
  const out = [];
  for (const s of readIndex().sounds) {
    const dest = join(LIB, s.file);
    if (existsSync(dest)) { out.push(`${s.id}	${sha256(dest) === s.sha256 ? 'present, sha256 ok' : 'present, sha256 DIFFERS'}`); continue; }
    const res = await fetch(s.file_url, { headers: UA });
    if (!res.ok) { out.push(`${s.id}	FAILED: download ${res.status} (get it by hand from ${s.source_url})`); continue; }
    const buf = Buffer.from(await res.arrayBuffer()), got = createHash('sha256').update(buf).digest('hex');
    if (got !== s.original_sha256) { out.push(`${s.id}	FAILED: original changed at the source (sha256 ${got.slice(0, 12)}); re-verify its licence and re-add`); continue; }
    mkdirSync(CAND, { recursive: true }); mkdirSync(dirname(dest), { recursive: true });
    const src = join(CAND, `restore-${s.id}${extname(new URL(s.file_url).pathname) || '.mp3'}`); writeFileSync(src, buf);
    render(src, dest, s.trim);
    out.push(`${s.id}	restored, ${sha256(dest) === s.sha256 ? 'sha256 identical' : 'original verified; trimmed file differs bit-wise (different ffmpeg build), levels re-measured: ' + JSON.stringify(measure(dest))}`);
  }
  return out;
}

function add(candId, { id, role, tags = '', about = '', trim = null }) {
  if (!ROLES.includes(role)) throw new Error(`--role must be one of ${ROLES.join(', ')}`);
  if (!/^[a-z0-9-]+$/.test(id || '')) throw new Error('--id must be lowercase-kebab');
  const c = JSON.parse(readFileSync(join(CAND, 'candidates.json'), 'utf8'))[candId];
  if (!c) throw new Error(`no candidate ${candId} (run openverse first)`);
  if (!c.verified?.ok) throw new Error(`refused: ${c.verified?.reason || 'licence not verified'}`);
  const index = readIndex(); if (index.sounds.some((s) => s.id === id)) throw new Error(`id ${id} already in the library`);
  const dir = join(LIB, 'sounds', role); mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${id}.wav`), src = join(ROOT, c.file);
  render(src, dest, trim);
  if (!(measure(dest).integrated_lufs > -60)) throw new Error(`refused: ${dest} is silent after trimming (check --trim against the source)`);
  const entry = { id, role, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), about, file: `sounds/${role}/${id}.wav`, sha256: sha256(dest), ...measure(dest),
    licence: c.verified.licence, licence_url: c.verified.url, title: c.title, creator: c.creator, source: c.source, source_url: c.source_url,
    file_url: c.file_url, original_sha256: sha256(src), trim, verified_at: c.verified_at, verified_how: 'licence link read on the source page by scripts/audio/library.mjs',
    approved_in: null };
  index.sounds.push(entry); writeIndex(index);
  return entry;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2), flag = (k) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest.splice(i, 2)[1] : null; };
  try {
    if (cmd === 'search') { const role = flag('role'); for (const s of search(readIndex(), rest, role)) console.log(`${s.id}\t${s.role}\t${s.duration_s}s\t${s.licence}\t${s.tags.join(',')}\t${s.about}`); }
    else if (cmd === 'list') for (const s of readIndex().sounds) console.log(`${s.id}\t${s.role}\t${s.duration_s}s\t${s.licence}\t${s.source_url}`);
    else if (cmd === 'openverse') { const n = Number(flag('n') || 8); for (const r of await openverse(rest.join(' '), n)) console.log(`${r.id}\t${r.verified.ok ? 'CC0 ok' : 'REFUSED: ' + r.verified.reason}\t${r.duration_s ?? ''}s\t${r.title}\t${r.source_url}`); }
    else if (cmd === 'add') { const e = add(rest[0], { id: flag('id'), role: flag('role'), tags: flag('tags') || '', about: flag('about') || '', trim: flag('trim') }); console.log(`added ${e.id} (${e.role}, ${e.duration_s}s, ${e.licence})`); }
    else if (cmd === 'restore') for (const line of await restore()) console.log(line);
    else { console.log('usage: library.mjs search|list|openverse|add|restore (see the header)'); process.exit(cmd ? 1 : 0); }
  } catch (e) { console.error(e.message); process.exit(1); }
}
