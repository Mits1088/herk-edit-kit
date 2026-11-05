// Convert a resource guide from Markdown to Word.
// Usage: node guide_to_docx.js <guide.md> <guide.docx>
// Refuses to replace an existing file, so a guide edited in Word is never lost.

const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, ExternalHyperlink, Table, TableRow, TableCell, WidthType, HeadingLevel,
  AlignmentType, LevelFormat, BorderStyle, ShadingType, Footer, PageNumber,
} = require('docx');

const INK = '1F2933';
const ACCENT = '1F4E79';
const CODE_BG = 'F1F3F5';
const CODE_FONT = 'Consolas';
const CONTENT_WIDTH = 9638; // A4 with 0.75 in margins
const NUM_REF = 'steps';

function inline(text, base = {}) {
  const out = [];
  const re = /(\*\*.+?\*\*|`[^`]+`|https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m;
  const plain = (t, o = {}) => { if (t) out.push(new TextRun({ text: t, ...base, ...o })); };
  while ((m = re.exec(text))) {
    plain(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      inline(tok.slice(2, -2), { ...base, bold: true }).forEach((r) => out.push(r));
    } else if (tok.startsWith('`')) {
      plain(tok.slice(1, -1), { font: CODE_FONT, shading: { type: ShadingType.CLEAR, fill: CODE_BG, color: 'auto' } });
    } else {
      out.push(new ExternalHyperlink({
        link: tok,
        children: [new TextRun({ text: tok, ...base, style: 'Hyperlink' })],
      }));
    }
    last = m.index + tok.length;
  }
  plain(text.slice(last));
  return out;
}

function codeBlock(lines, indent) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'D0D5DA', space: 6 };
  return lines.map((line, i) => new Paragraph({
    keepLines: true,
    keepNext: i < lines.length - 1,
    indent: { left: indent },
    spacing: { before: i === 0 ? 80 : 0, after: i === lines.length - 1 ? 140 : 0, line: 264 },
    shading: { type: ShadingType.CLEAR, fill: CODE_BG, color: 'auto' },
    border: { left: border, right: border, top: i === 0 ? border : undefined, bottom: i === lines.length - 1 ? border : undefined },
    children: [new TextRun({ text: line || ' ', font: CODE_FONT, size: 19 })],
  }));
}

function table(rows) {
  const cols = rows[0].length;
  const widths = cols === 3 ? [2500, 3700, 3438] : Array(cols).fill(Math.floor(CONTENT_WIDTH / cols));
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'C8CED4' };
  const borders = { top: border, bottom: border, left: border, right: border };
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((cells, r) => new TableRow({
      tableHeader: r === 0,
      cantSplit: true,
      children: cells.map((c, i) => new TableCell({
        borders,
        width: { size: widths[i], type: WidthType.DXA },
        margins: { top: 70, bottom: 70, left: 100, right: 100 },
        shading: r === 0 ? { type: ShadingType.CLEAR, fill: ACCENT, color: 'auto' } : undefined,
        children: [new Paragraph({
          spacing: { after: 0 },
          children: inline(c, r === 0 ? { bold: true, color: 'FFFFFF', size: 19 } : { size: 19 }),
        })],
      })),
    })),
  });
}

function convert(md, nextInstance) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [];
  let title = '';
  let instance = nextInstance();
  let i = 0;
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  // Keeps a step on the same page as the code box that follows it.
  const beforeCode = (at) => {
    let j = at + 1;
    while (j < lines.length && !lines[j].trim()) j += 1;
    return j < lines.length && lines[j].trim().startsWith('```');
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    const fence = line.match(/^(\s*)```/);
    if (fence) {
      const pad = fence[1].length;
      const body = [];
      i += 1;
      while (!lines[i].trim().startsWith('```')) { body.push(lines[i].slice(pad)); i += 1; }
      i += 1;
      out.push(...codeBlock(body, pad ? 460 : 0));
      continue;
    }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        if (!/^\|[\s:|-]+\|$/.test(lines[i])) rows.push(cells(lines[i]));
        i += 1;
      }
      out.push(table(rows));
      out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
      continue;
    }
    const h = line.match(/^(#{1,3}) (.+)$/);
    if (h) {
      const level = h[1].length;
      if (level === 1) title = h[2];
      instance = nextInstance();
      out.push(new Paragraph({
        heading: [HeadingLevel.TITLE, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2][level - 1],
        keepNext: true,
        children: [new TextRun(h[2])],
      }));
      i += 1;
      continue;
    }
    const num = line.match(/^(\d+)\. (.+)$/);
    if (num) {
      out.push(new Paragraph({
        style: 'ListParagraph',
        keepNext: beforeCode(i),
        numbering: { reference: NUM_REF, level: 0, instance },
        children: inline(num[2]),
      }));
      i += 1;
      continue;
    }
    const bullet = line.match(/^- (.+)$/);
    if (bullet) {
      out.push(new Paragraph({
        style: 'ListParagraph',
        numbering: { reference: 'bullets', level: 0 },
        children: inline(bullet[1]),
      }));
      i += 1;
      continue;
    }
    // A whole-line bold label starts a new step, so numbering restarts beneath it.
    if (/^\*\*[^*]+\*\*$/.test(line.trim())) {
      instance = nextInstance();
      out.push(new Paragraph({
        keepNext: true,
        spacing: { before: 220, after: 80 },
        children: inline(line.trim(), { color: ACCENT, size: 24 }),
      }));
      i += 1;
      continue;
    }
    const indented = line.match(/^ {3}(.+)$/);
    const text = indented ? indented[1] : line;
    out.push(new Paragraph({ keepNext: beforeCode(i), indent: indented ? { left: 460 } : undefined, children: inline(text) }));
    i += 1;
  }
  return { title, children: out };
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node guide_to_docx.js <guide.md> <guide.docx>');
  if (fs.existsSync(output)) throw new Error(`${output} already exists`);
  {
    let n = 0;
    const { title, children } = convert(fs.readFileSync(input, 'utf8'), () => { n += 1; return n; });
    const doc = new Document({
      title,
      creator: 'Mits',
      styles: {
        default: { document: { run: { font: 'Calibri', size: 22, color: INK }, paragraph: { spacing: { after: 120, line: 288 } } } },
        paragraphStyles: [
          { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { font: 'Calibri', size: 44, bold: true, color: ACCENT }, paragraph: { spacing: { after: 240 } } },
          { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { font: 'Calibri', size: 30, bold: true, color: ACCENT }, paragraph: { spacing: { before: 340, after: 120 }, outlineLevel: 0 } },
          { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { font: 'Calibri', size: 25, bold: true, color: INK }, paragraph: { spacing: { before: 260, after: 90 }, outlineLevel: 1 } },
          { id: 'ListParagraph', name: 'List Paragraph', basedOn: 'Normal', quickFormat: true,
            paragraph: { spacing: { after: 90 } } },
        ],
        characterStyles: [
          { id: 'Hyperlink', name: 'Hyperlink', basedOn: 'DefaultParagraphFont', run: { color: '0563C1', underline: {} } },
        ],
      },
      numbering: {
        config: [
          { reference: NUM_REF, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 460, hanging: 340 } } } }] },
          { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 460, hanging: 280 } } } }] },
        ],
      },
      sections: [{
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1080, bottom: 1080, left: 1134, right: 1134 } } },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
          children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 17, color: '6B7680' })] })] }) },
        children,
      }],
    });
    fs.writeFileSync(output, await Packer.toBuffer(doc));
    console.log('wrote', output);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
