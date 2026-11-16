// Add Claude-related resource PDFs to the existing Gumroad product (the Claude Skills Pack).
// Usage:
//   node gumroad_upload.mjs <keyword> [<keyword> ...] [--dry-run]
//   node gumroad_upload.mjs --all [--dry-run]
// Reads   reels-data/gumroad.json                         (product ID, content page)
//         reels-data/resource-sources/<keyword>.pdf.json  (gives the PDF's filename)
// Writes  reels-data/gumroad-backups/<time>-before.json / -after.json, and appends to reels-data/gumroad-uploads.md
//
// Safety: only appends files with `gumroad products update --file`. Never deletes, replaces or renames a file, and never
// touches the product's name, price, description, covers, publication or checkout fields. A PDF whose name is already on
// the product is skipped (same size) or flagged for a manual check (different size), never uploaded twice.
// After the upload it re-reads the product and fails loudly if any earlier file or product setting changed.
//
// Approval gate: a PDF is uploaded only if reels-data/content/pdf-approvals.json holds an approval for its keyword whose
// sha256 matches the file on disk. Mits records that approval in the content dashboard after looking at the PDF. A PDF
// with no approval, or rebuilt since its approval, is held (exit code 4). Never write that file by hand or from an agent.
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC_DIR = path.join(ROOT, 'reels-data/resource-sources');
const OUT_DIR = path.join(ROOT, 'instagram_scripts_output/resources');
const CONFIG = path.join(ROOT, 'reels-data/gumroad.json');
const BACKUPS = path.join(ROOT, 'reels-data/gumroad-backups');
const LOG = path.join(ROOT, 'reels-data/gumroad-uploads.md');
const APPROVALS = path.join(ROOT, 'reels-data/content/pdf-approvals.json');
const KEPT = ['name', 'description', 'price', 'currency', 'customizable_price', 'suggested_price', 'custom_permalink', 'published',
  'thumbnail_url', 'main_cover_id', 'custom_fields', 'custom_summary', 'custom_receipt', 'taxonomy_id', 'tags', 'max_purchase_count', 'variants'];

const fail = (msg, code = 1) => { console.error(`STOP  ${msg}`); process.exit(code); };
const safeName = (s) => s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();

function gumroadExe() {
  const local = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'gumroad', 'gumroad.exe');
  if (fs.existsSync(local)) return local;
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['gumroad'], { encoding: 'utf8' });
  if (probe.status === 0) return probe.stdout.split(/\r?\n/)[0].trim();
  fail('Gumroad CLI not found. Install it from https://github.com/antiwork/gumroad-cli, then run: gumroad auth login');
}
const EXE = gumroadExe();
function gr(args, { json = false } = {}) {
  const r = spawnSync(EXE, [...args, '--no-color', '--non-interactive'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`gumroad ${args.slice(0, 3).join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
  return json ? JSON.parse(r.stdout) : r.stdout;
}

// Claude-related: explicit "gumroad": true/false in the .pdf.json wins; otherwise "Claude" in the cover details or the guide title.
function isClaudeRelated(meta, md) {
  if (typeof meta.gumroad === 'boolean') return meta.gumroad;
  const title = (md.match(/^#\s+(.+)$/m) || [])[1] || '';
  return /claude/i.test([meta.name, meta.topic, meta.subtitle, meta.reel?.title, title].join(' '));
}

function snapshot(cfg) {
  const product = gr(['products', 'view', cfg.productId, '--json'], { json: true }).product;
  const content = gr(['products', 'content', 'get', cfg.productId], { json: true });
  return { product, content };
}

// ------------------------------------------------------------------ main
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
let keywords = args.filter((a) => !a.startsWith('--')).map((k) => k.toLowerCase());
if (args.includes('--all')) keywords = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.pdf.json')).map((f) => f.replace(/\.pdf\.json$/, '')).sort();
if (!keywords.length) fail('Usage: node gumroad_upload.mjs <keyword ...> | --all [--dry-run]', 2);
if (!fs.existsSync(CONFIG)) fail(`Missing ${path.relative(ROOT, CONFIG)}`);
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));

// 1. Local inventory: Claude-related, built, readable, approved PDFs only.
let approvals = {};
try { approvals = JSON.parse(fs.readFileSync(APPROVALS, 'utf8')); } catch { /* no approvals recorded yet */ }
const held = [];
const wanted = [];
for (const k of keywords) {
  const metaPath = path.join(SRC_DIR, `${k}.pdf.json`);
  if (!fs.existsSync(metaPath)) { console.log(`SKIP  ${k}: no ${k}.pdf.json, so no PDF to upload`); continue; }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const mdPath = path.join(SRC_DIR, `${k}.md`);
  const md = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '';
  if (!isClaudeRelated(meta, md)) { console.log(`SKIP  ${k}: not Claude-related (set "gumroad": true in ${k}.pdf.json to include it)`); continue; }
  const base = safeName(`${meta.name} - ${meta.topic}`);
  const file = path.join(OUT_DIR, `${base}.pdf`);
  if (!fs.existsSync(file)) { console.log(`FAIL  ${k}: PDF not built yet (${path.relative(ROOT, file)}); run guide_to_pdf.mjs first`); continue; }
  const buf = fs.readFileSync(file);
  if (buf.length < 1024 || buf.subarray(0, 5).toString() !== '%PDF-') { console.log(`FAIL  ${k}: ${base}.pdf is empty or not a PDF`); continue; }
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const ok = approvals[k.toUpperCase()];
  if (!ok || ok.sha256 !== sha256) { held.push(k); console.log(`HOLD  ${k}: ${ok ? 'the PDF changed after it was approved' : 'this PDF has not been approved'}. Mits approves it in the content dashboard; nothing uploaded.`); continue; }
  // A dot in the display name makes Gumroad guess the file type from it (CLAUDE.md -> "md ..."), so end it with .pdf.
  const displayName = base.includes('.') ? `${base}.pdf` : base;
  wanted.push({ keyword: k, file, base, displayName, size: buf.length });
}
if (!wanted.length) { console.log('Nothing to upload.'); process.exit(held.length ? 4 : 0); }

// 2. Connection and product checks.
const status = spawnSync(EXE, ['auth', 'status', '--no-color'], { encoding: 'utf8' });
if (!/Logged in as/i.test(status.stdout + status.stderr)) fail('Not logged in to Gumroad. Mits must run `gumroad auth login` and approve it in the browser.', 3);
const before = snapshot(cfg);
if (!before.product || before.product.id !== cfg.productId) fail(`Product ${cfg.productId} not found`);
if (!before.product.name.startsWith(cfg.productNameStartsWith)) fail(`Product name "${before.product.name}" does not start with "${cfg.productNameStartsWith}"`);
const pages = gr(['products', 'content', 'list', cfg.productId, '--json'], { json: true });
if (!pages.some((p) => p.id === cfg.pageId)) fail(`Content page ${cfg.pageId} no longer exists; update pageId in reels-data/gumroad.json`);

// 3. Compare with what is already on the product.
const existing = before.product.files || [];
const norm = (s) => s.toLowerCase().replace(/\.pdf$/, '').trim();
const toUpload = [];
const report = { uploaded: [], skipped: [], flagged: [], failed: [] };
for (const w of wanted) {
  const match = existing.find((f) => norm(f.name) === norm(w.base));
  if (!match) { toUpload.push(w); continue; }
  if (match.size === w.size) { report.skipped.push(w.base); console.log(`SKIP  ${w.keyword}: already on Gumroad, same size`); }
  else { report.flagged.push(`${w.base} (Gumroad ${match.size ?? 'unknown'} bytes, local ${w.size}; a newer local version is not uploaded automatically)`); console.log(`CHECK ${w.keyword}: a file with this name is on Gumroad with a different size; not replaced`); }
}
if (!toUpload.length) { console.log(`\nNothing new to upload. Skipped ${report.skipped.length}, flagged ${report.flagged.length}.`); process.exit(report.flagged.length ? 1 : held.length ? 4 : 0); }

const upArgs = ['products', 'update', cfg.productId, '--page', cfg.pageId];
for (const w of toUpload) upArgs.push('--file', w.file, '--file-name', w.displayName);

// 4. Dry run always, then the real upload unless --dry-run.
const preview = gr([...upArgs, '--dry-run']);
const preserved = (preview.match(/^Preserve existing file:/gm) || []).length;
if (/^Remove existing file:/m.test(preview)) fail(`The CLI plans to remove an existing file; nothing uploaded:\n${preview}`);
if (preserved !== existing.length) fail(`Dry run preserves ${preserved} of ${existing.length} existing files; nothing uploaded`);
console.log(`Dry run OK: keeps all ${existing.length} existing files, adds ${toUpload.length}: ${toUpload.map((w) => w.displayName).join('; ')}`);
if (dryRun) process.exit(0);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.mkdirSync(BACKUPS, { recursive: true });
fs.writeFileSync(path.join(BACKUPS, `${stamp}-before.json`), JSON.stringify(before, null, 2));
try { gr([...upArgs, '--yes']); } catch (err) {
  console.log(`FAIL  upload command: ${err.message}`);
  console.log('Re-run this script to see what arrived; anything already uploaded is skipped, so nothing is duplicated.');
  process.exit(1);
}

// 5. Verify.
const after = snapshot(cfg);
fs.writeFileSync(path.join(BACKUPS, `${stamp}-after.json`), JSON.stringify(after, null, 2));
const afterFiles = after.product.files || [];
const lost = existing.filter((f) => !afterFiles.some((a) => a.id === f.id));
const changed = KEPT.filter((k) => JSON.stringify(before.product[k]) !== JSON.stringify(after.product[k]));
for (const w of toUpload) {
  const got = afterFiles.find((f) => norm(f.name) === norm(w.base));
  if (!got) report.failed.push(`${w.base} (not on the product after upload)`);
  else if (got.size == null) report.flagged.push(`${w.base} (uploaded, Gumroad still processing; check its size later)`);
  else if (got.size !== w.size) report.failed.push(`${w.base} (Gumroad has ${got.size} bytes, local ${w.size})`);
  else report.uploaded.push(w.displayName);
}
const embeds = JSON.stringify(after.content);
for (const f of afterFiles) if (!embeds.includes(f.id)) report.flagged.push(`${f.name} (attached but not shown on a content page)`);

console.log(`\nGumroad: ${after.product.name}\n${cfg.url}`);
console.log(`Uploaded ${report.uploaded.length}, skipped ${report.skipped.length}, to check ${report.flagged.length}, failed ${report.failed.length}`);
for (const n of report.uploaded) console.log(`  + ${n}`);
for (const n of report.flagged) console.log(`  ? ${n}`);
for (const n of report.failed) console.log(`  x ${n}`);
if (lost.length) console.log(`  !! Files that were on the product before and are now missing: ${lost.map((f) => f.name).join(', ')}. Backup: reels-data/gumroad-backups/${stamp}-before.json`);
if (changed.length) console.log(`  !! Product settings changed: ${changed.join(', ')}. Backup: reels-data/gumroad-backups/${stamp}-before.json`);

const line = `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC | uploaded: ${report.uploaded.join('; ') || 'none'} | skipped ${report.skipped.length} | check: ${report.flagged.join('; ') || 'none'} | failed: ${report.failed.join('; ') || 'none'}${lost.length ? ` | MISSING AFTER: ${lost.map((f) => f.name).join('; ')}` : ''}\n`;
if (!fs.existsSync(LOG)) fs.writeFileSync(LOG, '# Gumroad uploads\n\nOne line per run of gumroad_upload.mjs (Claude Skills Pack).\n\n');
fs.appendFileSync(LOG, line);
process.exit(report.failed.length || lost.length || changed.length ? 1 : held.length ? 4 : 0);
