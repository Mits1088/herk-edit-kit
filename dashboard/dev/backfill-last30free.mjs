// One-off: import saved last30free runs (outputs/<run>/run_payload.json) into the research store, one batch per run.
// Run: node dashboard/dev/backfill-last30free.mjs [<outputs dir>] [--dry-run]
//   default outputs dir: $LAST30FREE_DIR/outputs (D:/Mits AI OS/Research-Assitant - Copy/last30free/outputs)
// Only TikTok, Instagram and YouTube are imported (Reddit, HN and X have no lane). Folders whose name starts with "_"
// (set aside by hand) are skipped. Repeat-safe: a run already imported is reported and left alone.
// Times: older runs have no per-post collection time, so their measurements are stamped with the run's own time and
// marked measuredBasis "backfill-run-time": shown, never used for growth. Runs with collected_at keep it ("collection").
import { readFileSync, readdirSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../lib/config.mjs';
import { importBatch, validateBatch } from '../lib/research.mjs';
import { buildBatch } from '../../.claude/skills/research-signals/build-batch.mjs';

const args = process.argv.slice(2); const dryRun = args.includes('--dry-run');
const outputs = args.find(a => !a.startsWith('--')) || join(process.env.LAST30FREE_DIR || 'D:/Mits AI OS/Research-Assitant - Copy/last30free', 'outputs');
const cfg = loadConfig();
const floorZ = v => new Date(v).toISOString().replace(/\.\d{3}Z$/, 'Z');
let imported = 0, skipped = 0, failed = 0;

for (const run of readdirSync(outputs).filter(n => !n.startsWith('_') && existsSync(join(outputs, n, 'run_payload.json'))).sort()) {
  const dir = join(outputs, run); const payloadFile = join(dir, 'run_payload.json');
  const payload = JSON.parse(readFileSync(payloadFile, 'utf8'));
  const manifest = existsSync(join(dir, 'manifest.json')) ? JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) : {};
  const results = payload.results || {};
  const shorts = !!(payload.runtime || {}).youtube_shorts;
  // draft key -> last30free source name; only sources that were asked for
  const keys = [['tiktok', 'tiktok'], ['instagram', 'instagram'], [shorts ? 'youtubeShorts' : 'youtube', 'youtube']].filter(([, src]) => results[src] && results[src].status !== 'not_requested');
  if (!keys.length) { console.log(`skip   ${run}: no TikTok, Instagram or YouTube results`); skipped++; continue; }
  const at = floorZ(manifest.generated_at_utc || run.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z.*/, '$1-$2-$3T$4:$5:$6Z'));
  const draft = { batchId: `l30-${run}`, query: manifest.raw_query || (payload.intent || {}).raw_query || run, windowDays: (payload.runtime || {}).days ?? null, retrievedAt: at,
    signalRoom: { lanes: [] }, last30free: Object.fromEntries(keys.map(([k]) => [k, { file: payloadFile }])) };
  let batch;
  try {
    batch = buildBatch(draft, { readJson: f => JSON.parse(readFileSync(f, 'utf8')), mtime: () => new Date(at) });
  } catch (e) { console.log(`FAIL   ${run}: ${e.message}`); failed++; continue; }
  for (const p of batch.posts) if (p.observation && p.observation.measuredBasis === 'file-mtime') p.observation.measuredBasis = 'backfill-run-time';
  for (const r of batch.runs) r.note = `Backfilled from saved last30free run ${run}. ` + (r.note || '').replace(/^fallback because requested; /, '');
  const problems = validateBatch(batch);
  if (problems.length) { console.log(`FAIL   ${run}: ${problems.length} problems, e.g. ${problems.slice(0, 2).join(' | ')}`); failed++; continue; }
  try {
    const r = importBatch(cfg, batch, { dryRun });
    if (r.alreadyImported) { console.log(`same   ${run}: already imported`); skipped++; continue; }
    const lanes = batch.runs.map(x => `${x.lane}=${x.status === 'ok' ? x.results.length + (x.fetchedOnly ? '+' + x.fetchedOnly.length : '') : 'error'}`).join(' ');
    console.log(`${dryRun ? 'would ' : 'import'} ${run} "${draft.query}": ${r.created} new, ${r.updated} updated, ${r.observationsAdded} measurements | ${lanes}`);
    if (!dryRun) {
      // Keep the source file like build-batch does, so the post page can show the original record.
      const keep = join(cfg.researchDir, 'sources', batch.batchId); mkdirSync(keep, { recursive: true });
      for (const [k] of keys) copyFileSync(payloadFile, join(keep, k + '.json'));
    }
    imported++;
  } catch (e) { console.log(`FAIL   ${run}: ${e.message}${e.errors ? ' ' + e.errors.slice(0, 2).join(' | ') : ''}`); failed++; }
}
console.log(`\n${dryRun ? 'Dry run, nothing written. ' : ''}${imported} ${dryRun ? 'would be imported' : 'imported'}, ${skipped} skipped, ${failed} failed.`);
process.exit(failed ? 1 : 0);
