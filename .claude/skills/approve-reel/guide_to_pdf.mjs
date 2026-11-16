// Build a branded, downloadable PDF guide from a resource Markdown file.
// Usage:
//   node guide_to_pdf.mjs <keyword> [<keyword> ...] [--preview]
//   node guide_to_pdf.mjs --all [--preview]
// Reads   reels-data/resource-sources/<keyword>.md        (the guide)
//         reels-data/resource-sources/<keyword>.pdf.json  (cover details, see SKILL.md)
//         brand/assets/profile.png                        (optional photo; text-only cover without it)
// Writes  instagram_scripts_output/resources/<Name> - <Topic>.pdf
//         instagram_scripts_output/resources/previews/<Name> - cover.png  (with --preview)
// Then checks the PDF: page count, embedded fonts, photo, every link it should carry, cover overflow.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC_DIR = path.join(ROOT, 'reels-data/resource-sources');
const OUT_DIR = path.join(ROOT, 'instagram_scripts_output/resources');
const PREVIEW_DIR = path.join(OUT_DIR, 'previews');
const PHOTO = path.join(ROOT, 'brand/assets/profile.png');
const FONTS = path.join(ROOT, 'brand/assets/fonts');
const CREATOR = 'Mits';
const PLATFORMS = 'Instagram &middot; TikTok &middot; YouTube Shorts';

const { chromium } = createRequire(path.join(ROOT, 'package.json'))('playwright');

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const b64 = (p) => fs.readFileSync(p).toString('base64');
const safeName = (s) => s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
const shortUrl = (u) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(esc(c)) - 1}\u0000`);
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  // Long URLs wrap at / - _ . ? = rather than mid-word (<wbr> adds no characters to the copied text).
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)"]*[^\s<)".,;:!?])/g, (_, pre, u) => `${pre}<a href="${u}">${u.replace(/([/\-_.?=])(?=[^/])/g, '$1<wbr>')}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}

function codeLabel(lang, body) {
  const l = (lang || '').toLowerCase();
  if (['bash', 'sh', 'shell', 'zsh', 'terminal'].includes(l)) return 'Terminal';
  if (['powershell', 'ps1', 'pwsh'].includes(l)) return 'PowerShell';
  if (['json', 'yaml', 'yml', 'toml'].includes(l)) return l.toUpperCase();
  if (/^\//.test(body.trim())) return 'Claude Code prompt';
  if (/^---\n/.test(body)) return 'File';
  return 'Copy and paste';
}

// Block-level Markdown: headings, paragraphs, fences (also inside list items), pipe tables, nested lists.
function blocks(lines) {
  const out = [];
  let i = 0;
  const isList = (l) => /^\s*([-*]|\d+\.)\s+/.test(l);
  const isFence = (l) => /^\s*```/.test(l);
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (isFence(l)) {
      const pad = l.match(/^\s*/)[0].length;
      const lang = l.trim().slice(3).trim();
      const body = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) body.push(lines[i++].slice(pad));
      i++;
      const text = body.join('\n').replace(/\s+$/, '');
      out.push(`<pre class="code"><span class="lang">${codeLabel(lang, text)}</span><code>${esc(text)}</code></pre>`);
      continue;
    }
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)$/))) {
      const lvl = Math.max(2, m[1].length);
      out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
      i++;
      continue;
    }
    if (/^\s*\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(/^[\s|:-]+$/.test(rows[1] || '') ? 2 : 1).map(cells);
      const numeric = body.every((r) => /^\d+$/.test(r[0] || ''));
      out.push(`<table class="${numeric ? 'numbered' : ''}"><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^>\s?/.test(l)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${blocks(buf)}</blockquote>`);
      continue;
    }
    if (isList(l)) {
      const baseIndent = l.match(/^\s*/)[0].length;
      const ordered = /^\s*\d+\./.test(l);
      const start = ordered ? parseInt(l.trim(), 10) : 1;
      const items = [];
      while (i < lines.length) {
        const cur = lines[i];
        const mm = cur.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (mm && mm[1].length === baseIndent && /\d/.test(mm[2]) === ordered) {
          const contentIndent = mm[1].length + mm[2].length + 1;
          const body = [mm[3]];
          i++;
          while (i < lines.length) {
            const nx = lines[i];
            if (!nx.trim()) {
              // a blank line continues the item only if the next non-blank line is indented under it
              let j = i;
              while (j < lines.length && !lines[j].trim()) j++;
              if (j < lines.length && lines[j].match(/^\s*/)[0].length >= Math.min(contentIndent, baseIndent + 2)) { body.push(''); i++; continue; }
              break;
            }
            const ind = nx.match(/^\s*/)[0].length;
            if (ind >= Math.min(contentIndent, baseIndent + 2)) { body.push(nx.slice(Math.min(ind, contentIndent))); i++; continue; }
            if (isList(nx) || isFence(nx) || /^(#|\||>)/.test(nx.trim())) break;
            body.push(nx.trim()); i++; // lazy continuation
          }
          items.push(body);
          continue;
        }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      const html = items.map((b) => {
        const first = [];
        let k = 0;
        while (k < b.length && b[k].trim() && !isFence(b[k]) && !isList(b[k])) first.push(b[k++]);
        return `<li><p>${inline(first.join(' '))}</p>${blocks(b.slice(k))}</li>`;
      }).join('');
      out.push(`<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''}>${html}</${tag}>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !isFence(lines[i]) && !isList(lines[i]) && !/^(#{1,4}\s|\s*\||>)/.test(lines[i])) buf.push(lines[i++].trim());
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return keepHeadings(out).join('\n');
}

// Chromium does not always honour break-after:avoid, so wrap each heading (or run of headings) with the
// block that follows it. Long blocks are left free to split, so a big list never jumps a whole page.
function keepHeadings(items) {
  const res = [];
  let pending = [];
  for (const item of items) {
    // Real headings, and a line that is only bold text (a heading written as **3. Try it**).
    if (/^<h[2-4]>/.test(item) || /^<p><strong>[^<]*<\/strong>:?<\/p>$/.test(item)) { pending.push(item); continue; }
    if (pending.length) {
      const head = pending.join('');
      if (item.length < 1600) res.push(`<div class="keep">${head}${item}</div>`);
      else if (/^<(ol|ul)/.test(item)) res.push(`<div class="keep">${head}${firstPart(item)}</div>${restPart(item)}`);
      else res.push(head + item);
      pending = [];
    } else res.push(item);
  }
  return res.concat(pending);
}
// For a long list, keep the heading with its first item only.
const firstPart = (html) => { const m = html.match(/^<(ol|ul)([^>]*)>(<li>[\s\S]*?<\/li>)(?=<li>|<\/\1>)/); return m ? `<${m[1]}${m[2]}>${m[3]}</${m[1]}>` : html; };
const restPart = (html) => {
  const m = html.match(/^<(ol|ul)([^>]*)>(<li>[\s\S]*?<\/li>)(?=<li>|<\/\1>)/);
  if (!m) return '';
  const rest = html.slice(m[0].length);
  if (/^<\/(ol|ul)>$/.test(rest)) return '';
  const start = m[1] === 'ol' ? ` start="${(parseInt((m[2].match(/start="(\d+)"/) || [0, 1])[1], 10)) + 1}"` : '';
  return `<${m[1]} class="cont"${start}>${rest}`;
};

function parseGuide(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const h = lines.findIndex((l) => /^#\s+/.test(l));
  const title = h >= 0 ? lines[h].replace(/^#\s+/, '').trim() : '';
  const rest = h >= 0 ? lines.slice(h + 1) : lines;
  const firstFence = md.match(/```[^\n]*\n([\s\S]*?)```/);
  const firstCode = firstFence ? firstFence[1].split('\n').map((x) => x.trim()).filter(Boolean)[0] : null;
  return { title, html: blocks(rest), firstCode };
}

function findBrowserExecutable() {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), 'AppData/Local/ms-playwright'), path.join(os.homedir(), '.cache/ms-playwright'), path.join(os.homedir(), 'Library/Caches/ms-playwright')].filter(Boolean);
  const exes = ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    const dirs = fs.readdirSync(r).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => +b.split('-')[1] - +a.split('-')[1]);
    for (const d of dirs) for (const e of exes) if (fs.existsSync(path.join(r, d, e))) return path.join(r, d, e);
  }
  return null;
}
async function launch() {
  try { return await chromium.launch({ headless: true }); } catch (err) {
    const exe = findBrowserExecutable();
    if (!exe) throw new Error(`No Chromium found. Run: npx playwright install chromium\n${err.message}`);
    return chromium.launch({ headless: true, executablePath: exe });
  }
}

// ---------------------------------------------------------------- page
function buildHtml(meta, guide, totalPages) {
  const photo = fs.existsSync(PHOTO) ? `data:image/png;base64,${b64(PHOTO)}` : null;
  const reel = meta.reel || {};
  const [line1, line2] = meta.nameLines || (() => { const w = meta.name.split(' '); return w.length > 1 ? [w.slice(0, -1).join(' '), w.at(-1)] : [meta.name, '']; })();
  const footerLeft = `${meta.name} \\00B7  ${meta.label.replace(/^Skill /, '')}`.replace(/"/g, '\\"');
  const visual = meta.visual || (guide.firstCode ? { type: 'command' } : { type: 'quote' });
  let visualHtml = '';
  if (visual.type === 'dots') {
    const yes = new Set(visual.yes || []);
    visualHtml = `<div class="dots">${Array.from({ length: 100 }, (_, k) => `<i class="${yes.has(k) ? 'y' : ''}"></i>`).join('')}</div><p class="vcap">${esc(visual.caption || '')}</p>`;
  } else if (visual.type === 'command') {
    const cmd = visual.text || guide.firstCode || '';
    visualHtml = `<div class="term"><div class="bar"><i></i><i></i><i></i><span>${esc(visual.heading || 'First step')}</span></div><code>${esc(cmd)}</code></div><p class="vcap">${esc(visual.caption || 'The full commands, in order, are inside.')}</p>`;
  } else if (visual.type === 'quote' && (visual.text || reel.hook)) {
    visualHtml = `<blockquote class="hook"><span>&ldquo;</span>${esc(visual.text || reel.hook)}</blockquote><p class="vcap">${esc(visual.caption || 'From the video')}</p>`;
  }
  const fontCss = `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${b64(path.join(FONTS, 'InterVariable.woff2'))}) format('woff2');font-weight:100 900}
@font-face{font-family:'JetBrains Mono';src:url(data:font/woff2;base64,${b64(path.join(FONTS, 'JetBrainsMono-Regular.woff2'))}) format('woff2');font-weight:400}`;
  const ofTotal = totalPages ? ` " of ${totalPages}"` : '';

  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${esc(meta.name)} - ${esc(meta.topic)}</title>
<meta name="author" content="${CREATOR}"><meta name="description" content="${esc(reel.title || meta.subtitle)}">
<style>${fontCss}
:root{--ink:#16171a;--body:#26282d;--muted:#5d6068;--line:#e4e0d6;--paper:#fbf9f4;--cream:#f4efe2;--accent:#ebc934;--accent-text:#9c7d0a;--code-bg:#1b1d21;--code-ink:#f2efe9}
*{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:Inter,sans-serif;color:var(--body);-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:A4;margin:20mm 20mm 22mm;
  @bottom-left{content:"${footerLeft}";font:400 7.5pt Inter,sans-serif;color:#7a7d85;vertical-align:top;padding-top:6mm}
  @bottom-right{content:"Page " counter(page)${ofTotal};font:400 7.5pt Inter,sans-serif;color:#7a7d85;vertical-align:top;padding-top:6mm}}
@page cover{margin:0;counter-increment:page 0;@bottom-left{content:none}@bottom-right{content:none}}

/* cover */
.cover{page:cover;width:210mm;height:297mm;background:var(--paper);display:flex;flex-direction:column;overflow:hidden;break-after:page;position:relative}
.band{background:var(--cream);padding:22mm 20mm 12mm;border-bottom:1.4mm solid var(--accent);min-height:138mm;display:flex;flex-direction:column}
.top{display:flex;justify-content:space-between;align-items:center;gap:6mm}
.label{font-size:9.5pt;font-weight:650;letter-spacing:.04em;text-transform:uppercase;padding:2.2mm 4mm;border:1px solid var(--ink);border-radius:20mm;color:var(--ink);white-space:nowrap}
.tag{font:400 9pt 'JetBrains Mono',monospace;color:var(--muted);text-align:right}
.cover h1{font-size:var(--h1,62pt);font-weight:850;letter-spacing:-.035em;line-height:.96;margin-top:auto;padding-top:14mm;color:var(--ink)}
.cover h1 span{display:block;white-space:nowrap}
.cover h1 .a{color:var(--accent-text)}
.sub{font-size:14pt;line-height:1.45;color:#33353a;max-width:156mm;margin-top:7mm;font-weight:430}
.mid{display:flex;gap:12mm;padding:16mm 20mm 0;flex:1;min-height:0}
.inside{flex:1}
.inside h3{font-size:9pt;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:650;margin-bottom:3.5mm}
.inside li{list-style:none;font-size:11.5pt;line-height:1.35;padding:2.6mm 0;border-top:1px solid var(--line);display:flex;gap:3mm;color:var(--ink)}
.inside li b{font:400 9pt 'JetBrains Mono',monospace;color:var(--accent-text);padding-top:.6mm;min-width:6mm}
.vis{width:66mm;flex:none}
.dots{display:grid;grid-template-columns:repeat(10,4.2mm);gap:2.1mm}
.dots i{width:4.2mm;height:4.2mm;border-radius:50%;background:#dcd7ca}
.dots i.y{background:var(--accent)}
.vcap{font-size:8.5pt;color:var(--muted);line-height:1.4;margin-top:4mm}
.term{background:var(--code-bg);border-radius:2.5mm;overflow:hidden;box-shadow:0 2mm 6mm rgba(22,23,26,.12)}
.term .bar{display:flex;align-items:center;gap:1.4mm;padding:2.4mm 3mm;background:#2a2d33}
.term .bar i{width:2.2mm;height:2.2mm;border-radius:50%;background:#555a63}
.term .bar i:first-child{background:var(--accent)}
.term .bar span{margin-left:2mm;font-size:7pt;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#a9adb5}
.term code{display:block;padding:4mm 4mm 5mm;font:400 9pt/1.55 'JetBrains Mono',monospace;color:var(--code-ink);overflow-wrap:anywhere;white-space:pre-wrap}
.term code::before{content:"> ";color:var(--accent)}
.hook{font-size:13pt;line-height:1.4;font-weight:600;color:var(--ink);border-left:1.2mm solid var(--accent);padding:1mm 0 1mm 5mm;position:relative}
.hook span{position:absolute;left:4mm;top:-9mm;font-size:40pt;color:var(--accent);font-weight:800}
.foot{margin:0 20mm 18mm;display:flex;align-items:center;gap:6mm;padding-top:7mm;border-top:1px solid var(--line)}
.photo{width:24mm;height:24mm;border-radius:50%;flex:none;box-shadow:0 0 0 1.2mm var(--paper),0 0 0 1.6mm var(--accent)}
.photo img{width:100%;height:100%;border-radius:50%;display:block}
.who{flex:1;min-width:0}
.from{font-size:8.5pt;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:650}
.rt{font-size:12.5pt;font-weight:700;margin-top:1.4mm;line-height:1.3;color:var(--ink)}
.who a{font-size:9pt;color:var(--accent-text);text-decoration:none;display:inline-block;margin-top:1.4mm}
.free{font-size:8.5pt;color:var(--muted);text-align:right;line-height:1.5;white-space:nowrap}

/* guide */
.guide{font-size:10.5pt;line-height:1.6}
.intro{border-left:1.4mm solid var(--accent);background:var(--cream);padding:5mm 6mm;border-radius:0 2mm 2mm 0;margin-bottom:8mm;break-inside:avoid}
.intro .k{font-size:8.5pt;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:650}
.intro .t{font-size:17pt;font-weight:800;letter-spacing:-.015em;line-height:1.25;margin:1.5mm 0 2mm;color:var(--ink)}
.intro p{font-size:9.5pt;color:#44464c;margin:0}
.intro a{color:var(--accent-text);font-weight:600;text-decoration:none;word-break:normal;white-space:nowrap}
.guide h2{font-size:17pt;font-weight:800;letter-spacing:-.015em;color:var(--ink);margin:9mm 0 3mm;padding-top:4mm;border-top:1px solid var(--line);break-after:avoid}
.intro + h2,.intro + .keep > h2:first-child{margin-top:0}
.keep{break-inside:avoid}
.keep > ol:last-child,.keep > ul:last-child{margin-bottom:0}
.guide ol.cont,.guide ul.cont{margin-top:1.8mm}
.guide h3,.guide h4{font-size:12pt;font-weight:750;color:var(--ink);margin:6mm 0 2mm;break-after:avoid}
.guide p{margin:0 0 3mm}
.guide p:has(+ pre.code), .guide p:has(+ ol), .guide p:has(+ ul), .guide p:has(+ table){break-after:avoid}
.guide ul,.guide ol{margin:0 0 3.5mm 5.5mm}
.guide li{margin:0 0 1.8mm;padding-left:1mm}
.guide li > p{margin:0 0 1.5mm}
.guide li > p:has(+ pre.code){break-after:avoid}
.guide li > pre.code{margin-top:2mm}
.guide li::marker{color:var(--accent-text);font-weight:700}
.guide strong{color:var(--ink);font-weight:700}
.guide em{font-style:italic}
.guide a{color:var(--accent-text);text-decoration:underline;text-underline-offset:2px;overflow-wrap:break-word}
.guide code{font-family:'JetBrains Mono',monospace;font-size:8.8pt;background:#f3f1ea;border:1px solid #e7e3d8;border-radius:1mm;padding:.2mm 1.1mm;overflow-wrap:anywhere}
.guide blockquote{border-left:1mm solid var(--line);padding-left:4mm;color:var(--muted);margin:0 0 3mm}
pre.code{background:var(--code-bg);color:var(--code-ink);border-radius:2mm;padding:3.4mm 4.5mm 3.8mm;margin:0 0 4mm;break-inside:avoid;white-space:pre-wrap}
pre.code .lang{display:block;font:600 7pt Inter,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin-bottom:1.6mm}
pre.code code{background:none;border:0;padding:0;color:inherit;font-size:9pt;white-space:pre-wrap;line-height:1.55;overflow-wrap:anywhere}
table{width:100%;border-collapse:collapse;margin:1mm 0 5mm;font-size:9pt;line-height:1.45}
thead{display:table-header-group}
th{text-align:left;font-size:7.8pt;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:650;border-bottom:1.5px solid var(--ink);padding:2mm 2.5mm}
td{border-bottom:1px solid var(--line);padding:2.4mm 2.5mm;vertical-align:top}
tr{break-inside:avoid}
table.numbered td:first-child{font-weight:800;color:var(--accent-text);width:9mm;text-align:center}
td code{font-size:8.2pt;overflow-wrap:normal;white-space:nowrap}
.end{margin-top:10mm;padding-top:4mm;border-top:1px solid var(--line);font-size:8.5pt;color:var(--muted)}
</style></head><body>
<section class="cover">
  <div class="band">
    <div class="top"><span class="label">${esc(meta.label)}</span>${meta.tag ? `<span class="tag">${esc(meta.tag)}</span>` : ''}</div>
    <h1><span>${esc(line1)}</span>${line2 ? `<span class="a">${esc(line2)}</span>` : ''}</h1>
    <p class="sub">${esc(meta.subtitle)}</p>
  </div>
  <div class="mid">
    <div class="inside"><h3>Inside this guide</h3><ul>${(meta.inside || []).map((x, k) => `<li><b>${String(k + 1).padStart(2, '0')}</b>${esc(x)}</li>`).join('')}</ul></div>
    ${visualHtml ? `<div class="vis">${visualHtml}</div>` : ''}
  </div>
  <div class="foot">${photo ? `<div class="photo"><img src="${photo}" alt="${CREATOR}"></div>` : ''}
    <div class="who"><div class="from">${reel.title ? 'From the video' : 'Free guide'}</div><div class="rt">${esc(reel.title || meta.subtitle)}</div>${reel.url ? `<a href="${esc(reel.url)}">Watch the video &rarr; ${esc(shortUrl(reel.url))}</a>` : ''}</div>
    <div class="free">Free guide by ${CREATOR}<br>${PLATFORMS}</div>
  </div>
</section>
<main class="guide">
  <div class="intro"><div class="k">${esc(meta.label)}</div><div class="t">${esc(guide.title || meta.name)}</div>
    ${reel.title ? `<p>Related video: <strong>${esc(reel.title)}</strong>${reel.url ? `<br>Watch it: <a href="${esc(reel.url)}">${esc(shortUrl(reel.url))}</a>` : ''}</p>` : ''}</div>
  ${guide.html}
  ${meta.endNote ? `<p class="end">${esc(meta.endNote)}</p>` : ''}
</main>
</body></html>`;
}

// ---------------------------------------------------------------- build + check
const countPages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;

async function fitCover(page) {
  // Shrink the cover heading until both lines fit, then report anything that still overflows the A4 cover.
  return page.evaluate(() => {
    const cover = document.querySelector('.cover');
    const h1 = cover.querySelector('h1');
    const band = cover.querySelector('.band');
    const maxW = band.clientWidth - 2 * 75.6; // 20 mm side padding at 96 dpi
    let size = 62;
    const tooWide = () => [...h1.children].some((s) => s.scrollWidth > maxW + 1);
    while (size > 34 && (tooWide() || band.scrollHeight > 600)) { size -= 2; h1.style.setProperty('--h1', `${size}pt`); }
    const problems = [];
    const box = cover.getBoundingClientRect();
    for (const el of cover.querySelectorAll('.band, .mid, .foot, .inside li, .vis, h1 span, .sub')) {
      const r = el.getBoundingClientRect();
      if (r.right > box.right + 1 || r.bottom > box.bottom + 1) problems.push(`${el.className || el.tagName} overflows the cover`);
    }
    if (tooWide()) problems.push('cover heading is too long even at the smallest size; set nameLines');
    const mid = cover.querySelector('.mid');
    if (mid.scrollHeight > mid.clientHeight + 1) problems.push('cover middle section is too tall; shorten the inside list or the visual');
    return { size, problems };
  });
}

async function build(keyword, browser, preview) {
  const metaPath = path.join(SRC_DIR, `${keyword}.pdf.json`);
  const mdPath = path.join(SRC_DIR, `${keyword}.md`);
  if (!fs.existsSync(mdPath)) throw new Error(`Missing guide: ${mdPath}`);
  if (!fs.existsSync(metaPath)) throw new Error(`Missing cover details: ${metaPath}`);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  for (const k of ['name', 'topic', 'label', 'subtitle', 'inside']) if (!meta[k]) throw new Error(`${metaPath}: "${k}" is required`);
  const guide = parseGuide(fs.readFileSync(mdPath, 'utf8'));
  const fileName = safeName(`${meta.name} - ${meta.topic}`) + '.pdf';
  const outPath = path.join(OUT_DIR, fileName);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
  const render = async (total) => {
    await page.setContent(buildHtml(meta, guide, total), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const fit = await fitCover(page);
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, tagged: true, outline: true });
    return { pdf, fit };
  };
  const first = await render(null);
  const bodyPages = countPages(first.pdf) - 1;
  const { pdf, fit } = await render(bodyPages > 0 ? bodyPages : null);
  fs.writeFileSync(outPath, pdf);

  let previewPath = null;
  if (preview) {
    fs.mkdirSync(PREVIEW_DIR, { recursive: true });
    previewPath = path.join(PREVIEW_DIR, safeName(`${meta.name} - cover`) + '.png');
    await page.emulateMedia({ media: 'print' });
    await page.locator('.cover').screenshot({ path: previewPath });
  }
  await page.close();

  // Checks on the written file.
  const text = pdf.toString('latin1');
  const problems = [...fit.problems];
  const pages = countPages(pdf);
  if (pages < 2) problems.push(`only ${pages} page(s)`);
  if (countPages(pdf) - 1 !== bodyPages) problems.push('page count changed between passes; footer totals may be wrong');
  if (!/\/FontFile2|\/FontFile3|\/FontFile\b/.test(text)) problems.push('no embedded fonts found');
  if (fs.existsSync(PHOTO) && !/\/Subtype\s*\/Image/.test(text)) problems.push('profile photo missing from the PDF');
  // Every URL in the prose must become a clickable link; URLs inside code are commands, not links.
  const prose = fs.readFileSync(mdPath, 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const wanted = new Set(prose.match(/https?:\/\/[^\s<)"`]*[^\s<)"`.,;:!?]/g) || []);
  if (meta.reel?.url) wanted.add(meta.reel.url);
  const missing = [...wanted].filter((u) => !text.includes(`/URI (${u})`) && !text.includes(`/URI (${u}/)`));
  if (missing.length) problems.push(`links not clickable: ${missing.join(', ')}`);
  return { keyword, outPath, previewPath, pages, bodyPages, headingSize: fit.size, links: wanted.size, problems };
}

const args = process.argv.slice(2);
const preview = args.includes('--preview');
let keywords = args.filter((a) => !a.startsWith('--')).map((k) => k.toLowerCase());
if (args.includes('--all')) keywords = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.pdf.json')).map((f) => f.replace(/\.pdf\.json$/, '')).sort();
if (!keywords.length) { console.error('Usage: node guide_to_pdf.mjs <keyword ...> | --all [--preview]'); process.exit(2); }

const browser = await launch();
let failed = 0;
try {
  for (const k of keywords) {
    try {
      const r = await build(k, browser, preview);
      const status = r.problems.length ? 'CHECK' : 'OK';
      if (r.problems.length) failed++;
      console.log(`${status}  ${k}: ${path.relative(ROOT, r.outPath)}  (${r.pages} pages: cover + ${r.bodyPages}, ${r.links} links, heading ${r.headingSize}pt)`);
      if (r.previewPath) console.log(`      cover preview: ${path.relative(ROOT, r.previewPath)}`);
      for (const p of r.problems) console.log(`      - ${p}`);
    } catch (err) { failed++; console.log(`FAIL  ${k}: ${err.message}`); }
  }
} finally { await browser.close(); }
if (!fs.existsSync(PHOTO)) console.log(`Note: no photo at ${path.relative(ROOT, PHOTO)}, so covers are text-only.`);
process.exit(failed ? 1 : 0);
