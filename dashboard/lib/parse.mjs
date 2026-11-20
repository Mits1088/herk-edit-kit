// Parsers for the text files the reel workflow already writes. Read-only: nothing here touches disk.

// Plain-text exports use a heading between two lines of "=" signs.
export function sections(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [{ name: '_head', body: [] }];
  for (let i = 0; i < lines.length; i++) {
    if (/^={10,}\s*$/.test(lines[i]) && lines[i + 2] !== undefined && /^={10,}\s*$/.test(lines[i + 2]) && lines[i + 1].trim()) {
      out.push({ name: lines[i + 1].trim(), body: [] }); i += 2;
    } else out[out.length - 1].body.push(lines[i]);
  }
  return out.map(s => ({ name: s.name, body: s.body.join('\n').trim() }));
}

// Older batches are Markdown with "## " headings.
export function mdSections(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [{ name: '_head', body: [] }];
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) out.push({ name: m[1], body: [] }); else out[out.length - 1].body.push(line);
  }
  return out.map(s => ({ name: s.name, body: s.body.join('\n').trim() }));
}

const isMd = (text, file) => /\.md$/i.test(file || '') || (!/^={10,}\s*$/m.test(text) && /^##\s+/m.test(text));
export const anySections = (text, file) => (isMd(text, file) ? mdSections(text) : sections(text));

const words = s => String(s).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
const titleCase = s => words(s).toLowerCase().replace(/(^|[\s(/])([a-z])/g, (m, a, b) => a + b.toUpperCase());

export function titleFrom(text, fallback) {
  const first = String(text || '').replace(/\r/g, '').split('\n').find(l => l.trim()) || '';
  let m = first.match(/^REEL\s+\d+\s*:\s*(.+)$/i); if (m) return titleCase(m[1]);
  m = first.match(/^#+\s*(?:Reel:\s*)?(.+?)(?:\s+-\s+Version\s+[ABC].*)?$/i); if (m) return words(m[1]);
  return titleCase(fallback || 'Untitled');
}

export function reviewFrom(text) {
  const m = String(text || '').match(/^\**Status(?: at approval)?:?\**:?\s*(.+)$/im);
  if (!m) return 'Unknown';
  const v = m[1].replace(/\*/g, '').trim();
  if (/READY TO RECORD/i.test(v)) return 'READY TO RECORD';
  if (/REVIEW REQUIRED/i.test(v)) return 'REVIEW REQUIRED';
  return v.slice(0, 60);
}

export function keywordFrom(cta) {
  const m = String(cta || '').match(/\bComment\s+["'“]?([A-Z][A-Z0-9]{2,})\b/);
  return m ? m[1] : null;
}

// The approved file: one script, three captions and the call to action.
export function parseApproved(text, file) {
  const secs = anySections(text, file); const get = re => (secs.find(s => re.test(s.name)) || {}).body || '';
  const head = secs[0].body;
  let cta = get(/^CTA$/i);
  if (!cta) { const m = head.match(/^\**CTA:?\**:?\s*(.+)$/im); if (m) cta = m[1].trim(); }
  return {
    status: reviewFrom(head),
    script: get(/^SCRIPT$/i),
    instagram: get(/^(INSTAGRAM CAPTION|CAPTION)$/i),
    tiktok: get(/^(TIKTOK CAPTION|TIKTOK)$/i),
    youtube: get(/^YOUTUBE SHORTS$/i),
    cta,
    keyword: keywordFrom(cta),
  };
}

// The generated file: both versions, before one is chosen.
export function parseGenerated(text, file) {
  const secs = anySections(text, file); const find = re => (secs.find(s => re.test(s.name)) || {}).body || '';
  return {
    review: reviewFrom(secs[0].body),
    versionA: find(/^VERSION A\b/i), versionB: find(/^VERSION B\b/i),
    comparison: find(/^FINAL COMPARISON$/i),
    other: secs.filter(s => s.name !== '_head' && !/^VERSION [AB]\b|^FINAL COMPARISON$/i.test(s.name)).map(s => s.name),
  };
}

// A working draft in reels-data/outputs/<batch>/: Markdown with bold headings such as "**VERSION A — Faithful Rewrite**"
// and a "- Publication status:" line. It is the rewriter's output before the independent review exports anything.
export function parseDraft(text) {
  const t = String(text || '').replace(/\r/g, ''); const secs = [];
  for (const line of t.split('\n')) { const m = line.match(/^\*\*([A-Z][^*a-z]*[A-Z])(?:\s+[—-]\s+[^*]*)?\*\*\s*$/); if (m) secs.push({ name: m[1].trim(), body: [] }); else if (secs.length) secs[secs.length - 1].body.push(line); }
  const find = re => ((secs.find(s => re.test(s.name)) || {}).body || []).join('\n').trim();
  const st = (t.match(/^[-*\s]*Publication status:\**\s*(.+)$/im) || [])[1] || '';
  return { review: /READY TO RECORD/i.test(st) ? 'READY TO RECORD' : /REVIEW REQUIRED/i.test(st) ? 'REVIEW REQUIRED' : /PENDING REVIEW/i.test(st) ? 'PENDING REVIEW' : 'Unknown',
    versionA: find(/^VERSION A\b/), versionB: find(/^VERSION B\b/), comparison: find(/^FINAL COMPARISON$/), other: [] };
}

// YouTube Shorts section: Title, Description and Tags, copied separately.
export function parseYoutube(body) {
  const t = String(body || '').replace(/\*\*/g, '');
  const title = (t.match(/^Title:\s*(.+)$/im) || [])[1] || '';
  const tags = (t.match(/^Tags:\s*([\s\S]+?)(?:\n\s*\n|$)/im) || [])[1] || '';
  const d = t.match(/^Description:\s*\n?([\s\S]*?)(?=^\s*Tags:|^\s*Delivery on this platform|$(?![\s\S]))/im);
  return { title: title.trim(), description: (d ? d[1] : '').trim(), tags: tags.trim() };
}

// resources.md: "- KEYWORD: what | delivery | file | draft or live"
export function parseResources(text) {
  const out = {};
  for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
    const m = line.match(/^-\s+([A-Z][A-Z0-9]{2,}):\s*(.+)$/); if (!m) continue;
    const parts = m[2].split('|').map(s => s.trim()); if (parts.length < 4) continue;
    const status = parts[parts.length - 1].toLowerCase();
    if (status !== 'draft' && status !== 'live') continue; // skips the format example line
    out[m[1]] = { description: parts[0], delivery: parts[1], file: parts[2], status };
  }
  return out;
}
