#!/usr/bin/env node
// approve-external.mjs - approve an outside finishing edit (for example a Canva speed-up exported in 4K) as the final.
//
// Usage:  node .claude/skills/create-reel/scripts/approve-external.mjs <project-folder> --file renders/<name>.mp4
//             --sha <first 12+ hex of its SHA-256> --approved-by "<name>" [--source Canva] [--note "..."]
//         node .claude/skills/create-reel/scripts/approve-external.mjs <project-folder> --restore
//
// An outside edit is approved only as a finish of an approved, QA-verified Reel Studio candidate. That candidate stays
// the technical base. The outside file gets light technical checks (decodes, H.264, vertical 9:16, audio, >= 3 s) and
// the person's approval of these exact bytes. Run it only after the person watched and listened to that file.
// The approved bytes are kept in renders/approved/external-<sha12>.mp4, then become the named final
// (renders/<slug>-final.mp4). A file already at that path is approved where it is. --restore puts the kept copy back
// when the final is missing. The dashboard refuses while a Zernio post is in flight or scheduled; this script
// does not read publishing records.
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs';
import { join, resolve, relative, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256File, recordPathFor, promote, finalPath, readJson, writeJson, isCandidateFile, makeCollector, decodeCheck, tailText } from './qa-core.mjs';
import { run } from './lib.mjs';

const RENDER = /^renders\/[A-Za-z0-9][A-Za-z0-9._ -]*\.mp4$/i;
const LIMITS = [['Facebook Reels', 60], ['Instagram Reels', 180], ['YouTube Shorts', 180]];

const probeFile = (file, runner) => {
  const r = runner('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]);
  try { return JSON.parse(r.stdout); } catch { return null; }
};
const seconds = p => { const n = Number(p?.format?.duration); return Number.isFinite(n) ? n : null; };

// The approved Reel Studio candidate this edit finishes. An earlier outside edit passes its own base along.
export function baseOf(dir, reel) {
  const latest = (reel.approvals || []).filter(a => a.status === 'approved').at(-1);
  if (!latest) throw new Error('No approved Reel Studio candidate yet. Approve a QA-passed candidate first; an outside edit finishes an approved video.');
  const base = latest.kind === 'external-edit' ? latest.basedOn : { candidate: latest.candidate, sha256: latest.sha256 };
  if (!base?.candidate || !/^[a-f0-9]{64}$/.test(base.sha256 || '')) throw new Error('The latest approval does not name its base candidate.');
  const recordPath = recordPathFor(dir, join(dir, base.candidate));
  const record = existsSync(recordPath) ? readJson(recordPath) : null;
  if (!record || record.sha256 !== base.sha256 || !record.technicallyVerified) throw new Error(`The base candidate ${base.candidate} has no matching, passed QA record.`);
  return { latest, base: { candidate: base.candidate, sha256: base.sha256 } };
}

// Light technical checks. Blocking: unreadable, not decodable, not H.264, not vertical 9:16, no audio, under 3 s.
export function checkExternal(file, { runner = run, baseSeconds = null } = {}) {
  const { results, add } = makeCollector();
  const probe = probeFile(file, runner);
  const v = probe?.streams?.find(s => s.codec_type === 'video'), a = (probe?.streams || []).filter(s => s.codec_type === 'audio');
  const dur = seconds(probe);
  add('Outside edit', 'ffprobe reads the file', probe && v ? 'PASS' : 'FAIL', v ? `${v.codec_name} ${v.width}x${v.height}` : 'no video stream', { required: true });
  if (v) {
    add('Outside edit', 'video codec h264', v.codec_name === 'h264' ? 'PASS' : 'FAIL', v.codec_name, { required: true });
    const vertical = v.height > v.width && Math.abs(v.width / v.height - 9 / 16) < 0.01;
    add('Outside edit', 'vertical 9:16', vertical ? 'PASS' : 'FAIL', `${v.width}x${v.height}`, { required: true });
  }
  add('Outside edit', 'audio stream present', a.length ? 'PASS' : 'FAIL', a.map(s => s.codec_name).join(', ') || 'none', { required: true });
  if (a.length) add('Outside edit', 'audio codec aac', a.every(s => s.codec_name === 'aac') ? 'PASS' : 'WARNING', a.map(s => s.codec_name).join(', '));
  add('Outside edit', 'at least 3 seconds', dur >= 3 ? 'PASS' : 'FAIL', dur == null ? 'unknown' : `${dur.toFixed(1)} s`, { required: true });
  if (probe && v) { const [area, check, status, detail, opts] = decodeCheck(runner('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { timeout: 600000 })); add(area, check, status, detail, opts); }
  if (dur != null && baseSeconds != null) add('Outside edit', 'duration against the approved video', 'WARNING', `${dur.toFixed(1)} s, approved video ${baseSeconds.toFixed(1)} s (${dur - baseSeconds >= 0 ? '+' : ''}${(dur - baseSeconds).toFixed(1)} s)`, { kind: 'info' });
  for (const [name, max] of LIMITS) if (dur != null && dur > max) add('Outside edit', `${name} length (${max} s)`, 'WARNING', `${dur.toFixed(1)} s is over the ${max} s limit for ${name}`);
  if (a.length) {
    const l = runner('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'ebur128', '-f', 'null', '-'], { timeout: 300000 });
    const s = String(l.stderr || ''), m = s.slice(s.lastIndexOf('Summary:')).match(/I:\s*(-?[\d.]+)\s*LUFS/);
    const lufs = m ? Number(m[1]) : null;
    add('Outside edit', 'loudness near -14 LUFS', lufs == null ? 'NOT TESTED' : Math.abs(lufs + 14) <= 3 ? 'PASS' : 'WARNING', lufs == null ? tailText(s) || 'not measured' : `${lufs.toFixed(1)} LUFS`);
  }
  const blocking = results.filter(r => r.status === 'FAIL' || (r.required && !['PASS', 'WARNING', 'NOT APPLICABLE'].includes(r.status)));
  return { results, blocking, passed: !blocking.length, seconds: dur, width: v?.width || null, height: v?.height || null };
}

async function keepCopy(dir, file, sha, copy) {
  const rel = `renders/approved/external-${sha.slice(0, 12)}.mp4`, kept = join(dir, rel);
  if (existsSync(kept) && await sha256File(kept) === sha) return rel;
  mkdirSync(join(dir, 'renders', 'approved'), { recursive: true });
  const tmp = kept + `.tmp-${process.pid}`;
  try { copy(file, tmp); if (await sha256File(tmp) !== sha) throw new Error('the kept copy does not match the approved hash'); copyFileSync(tmp, kept); }
  finally { try { unlinkSync(tmp); } catch {} }
  if (await sha256File(kept) !== sha) throw new Error('the kept copy does not match the approved hash');
  return rel;
}

const report = (rel, sha, approval, check) => [`# Outside edit approval: ${basename(rel)}`, '',
  `- File: \`${rel}\``, `- SHA-256: \`${sha}\``, `- Source: ${approval.source}`, `- Approved by ${approval.approvedBy} at ${approval.approvedAt}`,
  `- Finishes: \`${approval.basedOn.candidate}\` (\`${approval.basedOn.sha256.slice(0, 12)}\`)`, `- Final: \`${approval.promotedTo}\``, '',
  '| Check | Status | Detail |', '| --- | --- | --- |', ...check.results.map(r => `| ${r.check} | ${r.status} | ${String(r.detail).replace(/\|/g, '/')} |`), ''].join('\n');

export async function approveExternal(dir, { file, sha, approvedBy, source = 'Outside edit', note = '', runner = run, copy = copyFileSync, now = new Date() } = {}) {
  dir = resolve(dir);
  const reelPath = join(dir, 'reel.json');
  if (!existsSync(reelPath)) throw new Error(`No reel.json in ${dir}.`);
  const reel = readJson(reelPath);
  if (!file) throw new Error('--file is required: name the exact outside edit that was reviewed.');
  const full = resolve(dir, file); const rel = relative(dir, full).replaceAll('\\', '/');
  if (!RENDER.test(rel)) throw new Error(`${rel} must be an MP4 directly inside renders/.`);
  if (isCandidateFile(full, reel.slug) || (reel.renders || []).some(r => r.file === rel)) throw new Error(`${rel} is a Reel Studio render. Approve candidates with approve-reel.mjs.`);
  if (!existsSync(full)) throw new Error(`File not found: ${rel}`);
  if (!String(approvedBy || '').trim()) throw new Error('--approved-by is required: an outside edit always needs a person to approve it.');
  if (!/^[a-f0-9]{12,64}$/i.test(sha || '')) throw new Error('--sha needs at least the first 12 hex characters of the file you reviewed.');
  const { latest, base } = baseOf(dir, reel);
  const hash = await sha256File(full);
  if (!hash.startsWith(sha.toLowerCase())) throw new Error(`${rel} changed since you reviewed it (now ${hash.slice(0, 12)}, reviewed ${sha.slice(0, 12)}). Watch it again first.`);
  if (hash === latest.sha256) throw new Error(`${rel} is already the approved final.`);
  const baseFile = join(dir, base.candidate);
  const check = checkExternal(full, { runner, baseSeconds: existsSync(baseFile) ? seconds(probeFile(baseFile, runner)) : null });
  if (!check.passed) throw new Error(`${rel} failed the outside-edit checks: ${check.blocking.map(r => `${r.check} (${r.detail})`).join('; ')}.`);

  const kept = await keepCopy(dir, full, hash, copy);
  const finalRel = relative(dir, finalPath(dir)).replaceAll('\\', '/');
  let archived = null;
  if (rel !== finalRel) archived = (await promote(dir, join(dir, kept), hash, { copy, now })).archived;
  else if (await sha256File(full) !== hash) throw new Error(`${rel} changed during approval. Nothing was approved.`);
  const approval = { kind: 'external-edit', status: 'approved', file: rel, candidate: null, sha256: hash, basedOn: base,
    source: String(source || 'Outside edit').trim().slice(0, 60), approvedBy: String(approvedBy).trim(), approvedAt: now.toISOString(), note,
    promotedTo: finalRel, keptCopy: kept, seconds: check.seconds, width: check.width, height: check.height,
    checks: check.results.map(r => ({ check: r.check, status: r.status, detail: r.detail })) };
  if (archived) approval.previousFinalArchivedAs = archived.replaceAll('\\', '/');
  reel.finalFile = finalRel;
  (reel.approvals ||= []).push(approval);
  writeJson(reelPath, reel);
  writeFileSync(join(dir, kept.replace(/\.mp4$/, '.md')), report(rel, hash, approval, check));
  return { file: rel, sha256: hash, final: finalRel, kept, archived: approval.previousFinalArchivedAs || null, warnings: check.results.filter(r => r.status === 'WARNING').map(r => r.detail), approval };
}

// Puts the kept copy of the latest outside-edit approval back at the final path when the final is missing or changed.
export async function restoreExternal(dir, { copy = copyFileSync } = {}) {
  dir = resolve(dir);
  const reel = readJson(join(dir, 'reel.json'));
  const latest = (reel.approvals || []).filter(a => a.status === 'approved').at(-1);
  if (latest?.kind !== 'external-edit') throw new Error('The latest approval is not an outside edit.');
  const kept = join(dir, latest.keptCopy || '');
  if (!latest.keptCopy || !existsSync(kept) || await sha256File(kept) !== latest.sha256) throw new Error(`The kept copy ${latest.keptCopy} is missing or changed. Nothing was restored.`);
  const final = join(dir, latest.promotedTo);
  if (existsSync(final) && await sha256File(final) === latest.sha256) throw new Error(`${latest.promotedTo} already holds the approved outside edit.`);
  const r = await promote(dir, kept, latest.sha256, { copy });
  return { final: latest.promotedTo, sha256: latest.sha256, archived: r.archived };
}

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '--restore') { o[a.slice(2)] = true; continue; }
    if (a.startsWith('--')) { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`); o[a.slice(2).replace(/-(\w)/g, (m, c) => c.toUpperCase())] = v; i++; }
    else o._.push(a);
  }
  return o;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const o = parseArgs(process.argv.slice(2));
    if (!o._[0] || o.help) {
      console.log('Usage: node .claude/skills/create-reel/scripts/approve-external.mjs <project-folder> --file renders/<file>.mp4 --sha <12+ hex> --approved-by "<name>" [--source Canva] [--note "..."]\n       node .claude/skills/create-reel/scripts/approve-external.mjs <project-folder> --restore');
      process.exit(o.help ? 0 : 2);
    }
    if (o.restore) { const r = await restoreExternal(o._[0]); console.log(`Restored the approved outside edit (${r.sha256.slice(0, 12)}) -> ${r.final}${r.archived ? `; previous file kept as ${r.archived}` : ''}.`); }
    else {
      const r = await approveExternal(o._[0], o);
      console.log(`Approved outside edit ${r.file} (${r.sha256.slice(0, 12)}) -> ${r.final}; kept copy ${r.kept}${r.archived ? `; previous final kept as ${r.archived}` : ''}.`);
      for (const w of r.warnings) console.log(`Warning: ${w}`);
    }
  } catch (e) { console.error(`Not approved: ${e.message}`); process.exit(1); }
}
