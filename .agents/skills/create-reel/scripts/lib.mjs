// Shared helpers for the Reel Studio scripts: profiles, paths, Chrome, child processes.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const kitRoot = resolve(skillDir, '../../..');
export const motionmaxxingDir = join(kitRoot, '.claude/skills/motionmaxxing');

export function loadProfiles() {
  return JSON.parse(readFileSync(join(skillDir, 'profiles.json'), 'utf8'));
}

// Resolve a profile by name, following "extends" (shallow merge; nested objects replace wholesale).
export function getProfile(name) {
  const all = loadProfiles();
  const key = name || all.default;
  const seen = new Set();
  const chain = [];
  for (let k = key; k; k = all.profiles[k].extends) {
    if (!all.profiles[k]) throw new Error(`Unknown profile "${k}". Known: ${Object.keys(all.profiles).join(', ')}`);
    if (seen.has(k)) throw new Error(`Profile cycle at "${k}"`);
    seen.add(k); chain.unshift(all.profiles[k]);
  }
  const merged = Object.assign({}, ...chain);
  delete merged.extends;
  return { name: key, ...merged };
}

// Safe area in pixels: the rectangle that should hold text, logos and key action.
export function safeRect(profile) {
  const { width: W, height: H, safeArea: s } = profile;
  const x0 = Math.round(s.left * W), y0 = Math.round(s.top * H);
  const x1 = Math.round(W - s.right * W), y1 = Math.round(H - s.bottom * H);
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

// Chrome for headless checks. CHROME_PATH wins; then common install locations.
export function chromePath() {
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    local && join(local, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find(p => existsSync(p)) || null;
}

// Environment for child tools: Chrome for motionmaxxing, no HyperFrames telemetry.
export function toolEnv() {
  const env = { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1' };
  const chrome = chromePath();
  if (chrome && !env.CHROME_PATH) env.CHROME_PATH = chrome;
  return env;
}

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, env: toolEnv(), maxBuffer: 64 * 1024 * 1024, ...opts });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}

// The kit's pinned HyperFrames CLI, run with this Node directly (no npx, no shell).
export function hyperframes(args, opts = {}) {
  return run(process.execPath, [join(kitRoot, 'node_modules/hyperframes/bin/hyperframes.mjs'), ...args], opts);
}

export function python() {
  for (const p of ['python3', 'python']) if (spawnSync(p, ['--version'], { windowsHide: true }).status === 0) return p;
  return null;
}

// Root composition attributes and timeline registration read from index.html source.
export function readComposition(html) {
  const root = html.match(/<div\b[^>]*\bdata-composition-id\s*=\s*["']([^"']+)["'][^>]*>/i);
  if (!root) return null;
  const attr = n => (root[0].match(new RegExp(`\\b${n}\\s*=\\s*["']([^"']*)["']`, 'i')) || [])[1];
  const idAttr = (root[0].match(/\bid\s*=\s*["']([^"']+)["']/i) || [])[1];
  const regs = [...html.matchAll(/__timelines\s*\[\s*["']([^"']+)["']\s*\]\s*=/g)].map(m => m[1]);
  const gsapScripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*gsap[^"']*["']/gi)].length;
  return {
    id: root[1], elementId: idAttr,
    width: Number(attr('data-width')), height: Number(attr('data-height')),
    duration: Number(attr('data-duration')), start: Number(attr('data-start')),
    timelineRegistrations: regs, gsapScripts,
  };
}
