// Command Centre stage 5: a batch whose drafts are written but not yet reviewed or exported. Throwaway folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
const { loadConfig } = await import('../dashboard/lib/config.mjs');
const { buildState, itemDetail } = await import('../dashboard/lib/state.mjs');
const { parseDraft } = await import('../dashboard/lib/parse.mjs');

const NOW = new Date('2026-11-16T22:00:00');
const draft = status => `### REEL 1 — Claude Code builds n8n automations\n\n**Source:** research-instagram-1.md\n\n**VERSION A — Faithful Rewrite**\n\nDescribe an automation.\n\nSecond paragraph of A.\n\n**VERSION B — Stronger Alternative**\n\nType one sentence.\n\n**INSTAGRAM CAPTION**\n\nA caption.\n\n**FINAL COMPARISON**\n\n- Recommended version: B.\n${status ? `- Publication status: ${status}\n` : ''}- Duration change: None\n`;
const source = '## Reel: sample.creator — A source reel\n\nSource: https://www.instagram.com/p/x/\nDuration: 39s\nNote from Mits: Open on the result.\n\nSpoken words.\n';
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'drafts-'));
  for (const [p, t] of Object.entries(files)) { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), t); }
  return loadConfig({ root });
}
const by = (s, id) => s.items.find(i => i.id === id);

test('the draft parser reads both versions and the publication status', () => {
  const d = parseDraft(draft('PENDING REVIEW'));
  assert.deepEqual([d.review, d.versionA, d.versionB], ['PENDING REVIEW', 'Describe an automation.\n\nSecond paragraph of A.', 'Type one sentence.']);
  assert.equal(parseDraft(draft('READY TO RECORD')).review, 'READY TO RECORD');
  assert.equal(parseDraft(draft('')).review, 'Unknown');
});

test('pending drafts read "Drafts awaiting review", stay active and keep their source', () => {
  const cfg = fixture({
    'reels-data/inputs/batch-2026-11-16-001/research-instagram-1.md': source,
    'reels-data/outputs/batch-2026-11-16-001/reel-01-claude-code-n8n.md': draft('PENDING REVIEW'),
    'reels-data/outputs/batch-2026-11-16-001/records/reel-01.md': 'record',
    'Instagram_transcript/processed/batch-2026-11-16-001/research-instagram-1.md': source, // the archived original
  });
  const s = buildState(cfg, NOW); const it = by(s, '2026-11-16-001-01');
  assert.deepEqual([it.stage, it.note, it.review, it.active, it.dormant], ['rewrite', 'Drafts awaiting review', 'PENDING REVIEW', true, false]);
  assert.deepEqual(it.needs.map(n => [n.group, n.label, n.tab]), [['Production', 'Drafts awaiting review', 'scripts']]);
  assert.deepEqual(it.unknowns, []); // no "status unknown", no "abandoned"
  assert.deepEqual(it.files, { source: 'reels-data/inputs/batch-2026-11-16-001/research-instagram-1.md', draft: 'reels-data/outputs/batch-2026-11-16-001/reel-01-claude-code-n8n.md' });
  assert.equal(s.items.length, 1); // the archived copy in processed/ is not a second item
  const d = itemDetail(cfg, s, it.id);
  assert.deepEqual([d.generated.draft, d.generated.review, d.generated.versionB, d.generated.file], [true, 'PENDING REVIEW', 'Type one sentence.', it.files.draft]);
  assert.ok(d.source.text.includes('Note from Mits'));
  // a draft is not an approvable script: the choose-a-version step has not been reached
  assert.ok(!it.needs.some(n => /Choose Version/.test(n.label)));
});

test('old or reviewed-but-unexported drafts go quiet without any claim of abandonment', () => {
  const cfg = fixture({
    'reels-data/inputs/batch-2026-10-20-001/a.md': source, 'reels-data/outputs/batch-2026-10-20-001/reel-01-a.md': draft('PENDING REVIEW'), // four weeks old
    'reels-data/inputs/batch-2026-11-15-001/b.md': source, 'reels-data/outputs/batch-2026-11-15-001/reel-01-b.md': draft('READY TO RECORD'),
    'reels-data/inputs/batch-2026-11-15-002/c.md': source, 'reels-data/outputs/batch-2026-11-15-002/reel-01-c.md': draft(''),
    'reels-data/inputs/batch-2026-11-15-003/d.md': source, 'reels-data/outputs/batch-2026-11-15-003/notes.md': 'working file, no draft',
    'reels-data/inputs/batch-2026-11-16-002/e.md': source, // inputs only, just batched
  });
  const s = buildState(cfg, NOW); const all = s.items.flatMap(i => [i.note, ...i.unknowns]).join(' | ');
  assert.ok(!/abandon/i.test(all), all);
  const old = by(s, '2026-10-20-001-01');
  assert.deepEqual([old.note, old.dormant, old.active, old.needs.length], ['Drafts awaiting review', true, false, 0]);
  assert.deepEqual(old.unknowns, ['No final scripts were exported for these drafts; the files cannot show why']);
  const rev = by(s, '2026-11-15-001-01');
  assert.deepEqual([rev.note, rev.needs.length], ['Drafts reviewed (READY TO RECORD); the final scripts are not exported yet', 0]);
  assert.equal(by(s, '2026-11-15-002-01').note, 'Drafts written; their review status is not recorded');
  assert.equal(by(s, '2026-11-15-003-01').note, 'Working files exist, but no draft was found for this reel');
  const fresh = by(s, '2026-11-16-002-01');
  assert.deepEqual([fresh.active, fresh.files.draft, /no scripts are exported yet/.test(fresh.note)], [true, undefined, true]);
});

test('once the review exports the scripts, the item moves on to choosing a version', () => {
  const bar = '='.repeat(40); const sec = (n, b) => `${bar}\n${n}\n${bar}\n\n${b}\n\n`;
  const cfg = fixture({
    'reels-data/inputs/batch-2026-11-16-001/research-instagram-1.md': source,
    'reels-data/outputs/batch-2026-11-16-001/reel-01-claude-code-n8n.md': draft('READY TO RECORD'),
    'instagram_scripts_output/batch-2026-11-16-001/01-claude-code-n8n.txt': `REEL 1: Claude Code N8n\nStatus: READY TO RECORD\n\n${sec('VERSION A', 'A text')}${sec('VERSION B', 'B text')}`,
  });
  const s = buildState(cfg, NOW); const it = by(s, '2026-11-16-001-01');
  assert.deepEqual([it.stage, it.review, it.needs[0].label, it.files.draft], ['choose', 'READY TO RECORD', 'Choose Version A or B', undefined]);
  assert.equal(it.files.source, 'reels-data/inputs/batch-2026-11-16-001/research-instagram-1.md'); // same item, same source
  assert.equal(itemDetail(cfg, s, it.id).generated.draft, undefined);
});
