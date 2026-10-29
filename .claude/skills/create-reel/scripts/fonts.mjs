#!/usr/bin/env node
// fonts.mjs - local fonts for a Reel: resolve a style's font manifest, install it into a project, (re)sync it.
//
// Usage:  node .claude/skills/create-reel/scripts/fonts.mjs <project-folder> --style <brand|vox-explainer|kallaway|none>
//         node .claude/skills/create-reel/scripts/fonts.mjs --list
//
// A style's fonts are declared in its manifest: brand/fonts.json, or "fonts.files" in style-library/<style>/style.json.
// Each entry is { family, file, weight ("400" or a variable range "100 900"), style, license }, paths relative to the
// manifest's folder. Installing copies every file into <project>/assets/fonts/, writes assets/fonts/fonts.css (the one
// stylesheet the composition links) and records style + fonts in reel.json, which QA checks against. A missing file is
// an error, never a quiet fallback to system fonts. Re-running with another --style swaps the fonts; the composition's
// font-family names are the author's to update.
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { kitRoot } from './lib.mjs';

export const NO_STYLE = 'none';
export const FONT_CSS = 'assets/fonts/fonts.css';

// Every style with a font manifest: { id, root, manifest }.
export function listStyles(root = kitRoot) {
  const out = [];
  const brand = join(root, 'brand/fonts.json');
  if (existsSync(brand)) out.push({ id: 'brand', root: join(root, 'brand'), manifest: JSON.parse(readFileSync(brand, 'utf8')) });
  const lib = join(root, 'style-library');
  if (existsSync(lib)) for (const d of readdirSync(lib, { withFileTypes: true })) {
    const p = join(lib, d.name, 'style.json');
    if (!d.isDirectory() || d.name.startsWith('_') || !existsSync(p)) continue;
    const s = JSON.parse(readFileSync(p, 'utf8'));
    if (s.fonts?.files?.length) out.push({ id: s.id, root: join(lib, d.name), manifest: s.fonts });
  }
  return out;
}

// Resolve a style by id (or folder name). Checks that every font and licence file exists; returns the problems too.
export function resolveStyle(name, root = kitRoot) {
  const styles = listStyles(root);
  const s = styles.find(x => x.id === name || basename(x.root) === name);
  if (!s) throw new Error(`Unknown style "${name}". Styles with local fonts: ${styles.map(x => x.id).join(', ') || 'none'}, or "${NO_STYLE}".`);
  const files = s.manifest.files.map(f => ({ ...f, path: join(s.root, f.file), licensePath: f.license ? join(s.root, f.license) : null }));
  const missing = files.filter(f => !existsSync(f.path)).map(f => f.path);
  const unlicensed = [...new Set(files.filter(f => !f.licensePath || !existsSync(f.licensePath)).map(f => f.family))];
  return { id: s.id, root: s.root, manifest: s.manifest, files, missing, unlicensed, primary: s.manifest.display || s.manifest.body || files[0]?.family };
}

const quote = family => `"${family.replace(/["\\]/g, '')}"`;

// @font-face rules for a list of { family, weight, style, url }. font-display: block, so a frame never shows a fallback.
export function fontFaceCss(faces, header = '') {
  return (header ? `/* ${header} */\n` : '') + faces.map(f => [
    '@font-face {',
    `  font-family: ${quote(f.family)};`,
    `  src: url("${f.url}") format("woff2");`,
    `  font-weight: ${f.weight};`,
    `  font-style: ${f.style || 'normal'};`,
    '  font-display: block;',
    '}',
  ].join('\n')).join('\n') + '\n';
}

// The stylesheet a style ships next to its own font files (style-library/<style>/fonts/fonts.css, imported by tokens.css).
export function styleFontCss(style) {
  return fontFaceCss(style.files.map(f => ({ ...f, url: basename(f.file) })),
    `Generated from this style's manifest by create-reel/scripts/fonts.mjs. ${style.manifest.source || ''}`.trim());
}

// Install a style's fonts into a project. Returns the reel.json "fonts" entries. Throws when any font file is missing.
export function installFonts(dir, name, root = kitRoot) {
  const fontDir = join(dir, 'assets/fonts');
  const reelPath = join(dir, 'reel.json');
  const reel = existsSync(reelPath) ? JSON.parse(readFileSync(reelPath, 'utf8')) : null;
  let style = null;
  if (name !== NO_STYLE) {
    style = resolveStyle(name, root);
    if (style.missing.length) throw new Error(`Style "${style.id}" is missing font files:\n  ${style.missing.join('\n  ')}\nAdd them or pick another --style; nothing was changed.`);
  }
  // Remove the fonts a previous install put here (only files it recorded), then copy the new set.
  for (const f of reel?.fonts || []) {
    const p = join(dir, f.file);
    if (dirname(resolve(p)) === resolve(fontDir) && existsSync(p)) unlinkSync(p);
    if (f.license && existsSync(join(dir, f.license))) unlinkSync(join(dir, f.license));
  }
  const fonts = [];
  if (style) {
    mkdirSync(fontDir, { recursive: true });
    for (const f of style.files) {
      copyFileSync(f.path, join(fontDir, basename(f.file)));
      const lic = f.licensePath && existsSync(f.licensePath) ? `assets/fonts/${basename(f.license)}` : null;
      if (lic) copyFileSync(f.licensePath, join(dir, lic));
      fonts.push({ family: f.family, weight: String(f.weight), style: f.style || 'normal', file: `assets/fonts/${basename(f.file)}`, license: lic });
    }
    writeFileSync(join(dir, FONT_CSS), fontFaceCss(fonts.map(f => ({ ...f, url: basename(f.file) })), `Style "${style.id}", installed by create-reel/scripts/fonts.mjs. Re-run it to change style.`));
  } else if (existsSync(join(dir, FONT_CSS))) {
    writeFileSync(join(dir, FONT_CSS), '/* No style fonts: the composition uses system fonts. */\n');
  }
  if (reel) {
    Object.assign(reel, { style: style ? style.id : NO_STYLE, fonts });
    writeFileSync(reelPath, JSON.stringify(reel, null, 2) + '\n');
  }
  return { style: style ? style.id : NO_STYLE, primary: style?.primary || null, fonts, unlicensed: style?.unlicensed || [] };
}

// Does a face cover a weight and style? weight is "400" or a variable range "100 900".
export function faceCovers(face, weight, style = 'normal') {
  const [lo, hi = lo] = String(face.weight).split(/\s+/).map(Number);
  const s = style === 'oblique' ? 'italic' : style;
  return (face.style || 'normal') === s && weight >= lo && weight <= hi;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const s of listStyles()) {
      const r = resolveStyle(s.id);
      console.log(`${s.id.padEnd(16)} ${[...new Set(r.files.map(f => f.family))].join(', ')}${r.missing.length ? `  (missing ${r.missing.length} file(s))` : ''}`);
    }
    process.exit(0);
  }
  const si = args.indexOf('--style');
  if (!args[0] || args[0].startsWith('--') || si < 0 || !args[si + 1]) {
    console.log('Usage: node .claude/skills/create-reel/scripts/fonts.mjs <project-folder> --style <name>   |   --list');
    process.exit(2);
  }
  const dir = resolve(args[0]);
  if (!existsSync(join(dir, 'reel.json'))) { console.error(`No reel.json in ${dir}.`); process.exit(2); }
  try {
    const r = installFonts(dir, args[si + 1]);
    console.log(r.style === NO_STYLE ? 'Style fonts removed; the composition uses system fonts.' : `Installed ${r.fonts.length} font file(s) for style "${r.style}" into assets/fonts/.`);
    for (const f of r.unlicensed) console.log(`Note: no licence file shipped for ${f}; add one next to the font in its source folder.`);
    const html = existsSync(join(dir, 'index.html')) ? readFileSync(join(dir, 'index.html'), 'utf8') : '';
    if (!html.includes(FONT_CSS)) console.log(`index.html does not link ${FONT_CSS}; add <link rel="stylesheet" href="${FONT_CSS}">.`);
    if (r.primary) console.log(`Update font-family names in the composition to this style's families (primary: "${r.primary}").`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
