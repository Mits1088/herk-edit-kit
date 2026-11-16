// Imports one research batch into reels-data/research/. Run: node dashboard/research-import.mjs <batch.json> [--dry-run]
// The batch is checked in full before anything is written. Format: dashboard/README.md, "Research store".
import { readFileSync } from 'node:fs';
import { loadConfig } from './lib/config.mjs';
import { importBatch } from './lib/research.mjs';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('Usage: node dashboard/research-import.mjs <batch.json> [--dry-run]'); process.exit(2); }
let batch;
try { batch = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error(`Could not read ${file}: ${e.message}`); process.exit(1); }
try {
  const r = importBatch(loadConfig(), batch, { dryRun: args.includes('--dry-run') });
  if (r.alreadyImported) console.log(`Batch ${r.batchId} was already imported. Nothing changed.`);
  else console.log(`${r.dryRun ? 'Dry run, nothing written. Would import' : 'Imported'} batch ${r.batchId}: ${r.created} new posts, ${r.updated} updated, ${r.unchanged} unchanged, ${r.observationsAdded} new measurements.`);
  for (const f of r.failedRuns) console.log(`Source failed: ${f.lane}: ${f.error}. Earlier results from it are kept.`);
} catch (e) {
  console.error(e.message);
  for (const m of e.errors || []) console.error('  - ' + m);
  process.exit(1);
}
