#!/usr/bin/env node
// new-reel.mjs - create a native vertical Reel project with Herk's generator, then convert it to 9:16.
//
// Usage:  node .claude/skills/create-reel/scripts/new-reel.mjs <slug> [--profile organic|organic-60|ad|ad-disclaimer]
//                                                                  [--duration S] [--mode faceless|footage|brand] [--title "..."]
//
// Runs `scripts/new-video.mjs <slug>` (Herk's generator: copies the starter and the pinned GSAP), then replaces the
// landscape starter with a native vertical composition: meta.json, root id / data-composition-id / data-width /
// data-height / data-duration / data-fps, the timeline registration key, CSS sizes and staging all come from one ID
// and one profile. Writes reel.json (profile, mode, render log) and DESIGN.md (from brand/DESIGN.md when present).
// Never overwrites an existing project.
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { skillDir, kitRoot, getProfile, safeRect } from './lib.mjs';

export const MODES = ['faceless', 'footage', 'brand'];

// A CSS-safe composition ID derived from the slug (ids may not start with a digit in a #selector).
export const compositionId = slug => (/^[a-z]/.test(slug) ? slug : `reel-${slug}`);

export function fillTemplate(template, values) {
  const out = template.replace(/\{\{([A-Z]+)\}\}/g, (m, k) => {
    if (!(k in values)) throw new Error(`Template value missing: ${k}`);
    return String(values[k]);
  });
  return out;
}

// Convert a freshly generated project folder to native vertical. Pure file work, so tests can run it in a temp dir.
export function convertToVertical(dir, { slug, profile, duration, mode, title, brandDesign }) {
  const id = compositionId(slug);
  const template = readFileSync(join(skillDir, 'runtime/vertical-index.html'), 'utf8');
  const escape = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  writeFileSync(join(dir, 'index.html'), fillTemplate(template, {
    ID: id, TITLE: escape(title), WIDTH: profile.width, HEIGHT: profile.height, FPS: profile.fps, DURATION: duration,
  }));
  copyFileSync(join(skillDir, 'runtime/reel-eases.js'), join(dir, 'assets/reel-eases.js'));

  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  Object.assign(meta, { id, name: slug, width: profile.width, height: profile.height, fps: profile.fps });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

  const r = safeRect(profile);
  const reelSection = [
    '## Reel format',
    '',
    `- Canvas: ${profile.width}x${profile.height} native vertical, ${profile.fps} fps, ${duration} s (profile \`${profile.name}\`).`,
    `- Safe area for text, logos and key action: x ${r.x0}-${r.x1}, y ${r.y0}-${r.y1}. Review guide only; never drawn into the video.`,
    `- Production mode: ${mode}.`,
    `- Composition ID: \`${id}\` (meta.json, root div, data-composition-id and window.__timelines all use it).`,
    '- Eases: `ReelEases.*` from assets/reel-eases.js (motionmaxxing measured curves) on the one paused GSAP timeline.',
    '',
  ].join('\n');
  const design = brandDesign
    ? `${brandDesign.trimEnd()}\n\n${reelSection}`
    : `# ${title}\n\nNo brand file was found (brand/DESIGN.md). Record this reel's palette, type and motion here before building.\n\n${reelSection}`;
  writeFileSync(join(dir, 'DESIGN.md'), design);

  writeFileSync(join(dir, 'reel.json'), JSON.stringify({
    slug, compositionId: id, profile: profile.name, mode, duration,
    width: profile.width, height: profile.height, fps: profile.fps,
    renders: [],
  }, null, 2) + '\n');
  return { id };
}

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'help') { opts.help = true; continue; }
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`);
      opts[key] = value; i++;
    } else opts._.push(a);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const slug = opts._[0];
  if (!slug || opts.help) {
    console.log('Usage: node .claude/skills/create-reel/scripts/new-reel.mjs <slug> [--profile organic] [--duration 20] [--mode faceless|footage|brand] [--title "..."]');
    process.exit(slug || opts.help ? 0 : 1);
  }
  const profile = getProfile(opts.profile);
  const duration = opts.duration === undefined ? profile.duration.default : Number(opts.duration);
  if (!(duration > 0) || duration > 180) throw new Error(`--duration must be between 0 and 180 seconds, got ${opts.duration}`);
  if (duration < profile.duration.min || duration > profile.duration.max) {
    console.warn(`Note: ${duration} s is outside the ${profile.name} profile's usual ${profile.duration.min}-${profile.duration.max} s range. Continuing as requested.`);
  }
  const mode = opts.mode || 'faceless';
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}`);
  const title = opts.title || slug;

  // Herk's own generator validates the slug, refuses existing projects, and copies the pinned GSAP.
  const gen = spawnSync(process.execPath, [join(kitRoot, 'scripts/new-video.mjs'), slug], { stdio: 'inherit', windowsHide: true });
  if (gen.status !== 0) process.exit(gen.status || 1);

  const dir = join(kitRoot, 'video-projects', slug);
  const brandPath = join(kitRoot, 'brand/DESIGN.md');
  const brandDesign = existsSync(brandPath) ? readFileSync(brandPath, 'utf8') : null;
  const { id } = convertToVertical(dir, { slug, profile, duration, mode, title, brandDesign });
  console.log(`Converted to native vertical: ${profile.width}x${profile.height} @ ${profile.fps} fps, ${duration} s, composition "${id}", profile ${profile.name}, mode ${mode}.`);
  console.log(`Next: cd video-projects/${slug} && npx hyperframes lint`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
