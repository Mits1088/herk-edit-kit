#!/usr/bin/env node
// render-reel.mjs - render a Reel with HyperFrames to a new versioned file; never overwrites an earlier render.
//
// Usage:  node .claude/skills/create-reel/scripts/render-reel.mjs <project-folder> --draft|--final [--workers N]
//
// Output: <project>/renders/<slug>-draft-v001.mp4, -v002, ... (drafts and finals are numbered separately).
// Quality comes from the project's profile (reel.json -> profiles.json). Renders with --strict so lint errors stop it.
// Each render is appended to reel.json "renders". HyperFrames telemetry is disabled for the child process.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { getProfile, hyperframes } from './lib.mjs';

const args = process.argv.slice(2);
const kind = args.includes('--final') ? 'final' : args.includes('--draft') ? 'draft' : null;
if (!args[0] || args[0].startsWith('--') || !kind) {
  console.log('Usage: node .claude/skills/create-reel/scripts/render-reel.mjs <project-folder> --draft|--final [--workers N]');
  process.exit(args.includes('--help') ? 0 : 2);
}
const dir = resolve(args[0]);
const reelPath = join(dir, 'reel.json');
if (!existsSync(reelPath)) { console.error(`No reel.json in ${dir}. Create Reel projects with new-reel.mjs.`); process.exit(2); }
const reel = JSON.parse(readFileSync(reelPath, 'utf8'));
const profile = getProfile(reel.profile);
const wi = args.indexOf('--workers');
const workers = wi >= 0 ? args[wi + 1] : 'auto';

const rendersDir = join(dir, 'renders');
mkdirSync(rendersDir, { recursive: true });
const pattern = new RegExp(`^${reel.slug}-${kind}-v(\\d{3})\\.mp4$`);
const taken = readdirSync(rendersDir).map(f => (f.match(pattern) || [])[1]).filter(Boolean).map(Number);
const version = String((taken.length ? Math.max(...taken) : 0) + 1).padStart(3, '0');
const file = `${reel.slug}-${kind}-v${version}.mp4`;
if (existsSync(join(rendersDir, file))) { console.error(`Refusing to overwrite ${file}`); process.exit(1); }

const quality = kind === 'final' ? profile.finalQuality : profile.draftQuality;
console.log(`Rendering ${file} (${quality}, ${profile.width}x${profile.height} @ ${profile.fps} fps, workers ${workers})`);
const r = hyperframes(['render', '--quality', quality, '--fps', String(profile.fps), '--workers', String(workers), '--strict', '--quiet', '--output', `renders/${file}`], { cwd: dir, stdio: 'inherit' });
if (r.status !== 0 || !existsSync(join(rendersDir, file))) { console.error(`Render failed (exit ${r.status}).`); process.exit(1); }

reel.renders = reel.renders || [];
reel.renders.push({ file: `renders/${file}`, kind, version: Number(version), quality, fps: profile.fps, renderedAt: new Date().toISOString() });
writeFileSync(reelPath, JSON.stringify(reel, null, 2) + '\n');
console.log(`Rendered ${basename(dir)}/renders/${file}`);
console.log(`Next: node .claude/skills/create-reel/scripts/qa-reel.mjs ${args[0]} --render renders/${file}`);
