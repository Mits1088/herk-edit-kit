// One-off: copy the JSON research store (posts/*.json, searches.jsonl) into research.sqlite exactly as stored,
// then read every post and search back and compare it with its file. Nothing is re-derived.
// Run: node dashboard/dev/migrate-json-to-sqlite.mjs [--archive]
//   without --archive: migrate and verify; the JSON files stay where they are.
//   --archive: after a clean verification, move posts/ and searches.jsonl to archive/<date>-before-sqlite/.
// ideas.json, sources/, inbox/ and logs/ are never touched. Refuses to run on a database that already holds data.
import { readFileSync, readdirSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { loadConfig } from '../lib/config.mjs';
import { postKey } from '../lib/research.mjs';
import { openDb, transaction, savePost, saveSearch, loadAllPosts, loadSearches, dbFile } from '../lib/research-db.mjs';

const cfg = loadConfig(); const dir = cfg.researchDir;
const postsDir = join(dir, 'posts'), searchesFile = join(dir, 'searches.jsonl');
const fail = m => { console.error(m); process.exit(1); };
if (!existsSync(postsDir) && !existsSync(searchesFile)) fail(`No JSON store under ${dir}. Nothing to migrate.`);

const posts = existsSync(postsDir) ? readdirSync(postsDir).filter(n => n.endsWith('.json')).map(n => JSON.parse(readFileSync(join(postsDir, n), 'utf8'))) : [];
const searches = existsSync(searchesFile) ? readFileSync(searchesFile, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : [];

const db = openDb(cfg, { write: true });
try {
  if (db.prepare('SELECT COUNT(*) AS n FROM searches').get().n || db.prepare('SELECT COUNT(*) AS n FROM posts').get().n) fail(`${dbFile(cfg)} already holds data. Nothing was changed.`);
  transaction(db, () => {
    for (const s of searches) saveSearch(db, s, postKey);
    for (const p of posts) {
      savePost(db, p);
      // The JSON store did not record which batch saw which measurement. Link one only on exact evidence: the
      // batch's own runs from that source returned this post, and the batch's retrieval time is the measurement's
      // first or last retrieval time (and no other such batch shares that time). A batch in between proves
      // nothing (it may have returned a different measurement), so it is left unlinked.
      for (const o of p.observations) {
        const { id } = db.prepare('SELECT id FROM observations WHERE post_key = ? AND ord = ?').get(p.id, p.observations.indexOf(o));
        const ref = `${p.platform}:${p.nativeId}`;
        const returned = searches.filter(s => (s.runs || []).some(r => r.provider === o.provider && [...(r.results || []), ...(r.fetchedOnly || [])].includes(ref)));
        for (const at of new Set([o.firstRetrievedAt, o.lastRetrievedAt])) {
          const hits = returned.filter(s => s.retrievedAt === at);
          if (hits.length === 1) db.prepare('INSERT OR IGNORE INTO observation_sightings (observation_id, batch_id) VALUES (?, ?)').run(id, hits[0].batchId);
        }
      }
    }
  });

  // Verify: every post and search read back equals its JSON source.
  const back = new Map(loadAllPosts(db).map(p => [p.id, p])); const problems = [];
  if (back.size !== posts.length) problems.push(`posts: ${posts.length} files, ${back.size} in the database`);
  for (const p of posts) if (!isDeepStrictEqual(back.get(p.id), p)) problems.push(`post ${p.id} differs after migration`);
  const obsFiles = posts.reduce((n, p) => n + p.observations.length, 0), obsDb = db.prepare('SELECT COUNT(*) AS n FROM observations').get().n;
  if (obsFiles !== obsDb) problems.push(`observations: ${obsFiles} in files, ${obsDb} in the database`);
  if (!isDeepStrictEqual(loadSearches(db), searches)) problems.push('searches differ after migration');
  if (problems.length) { db.close(); console.error('Verification FAILED. The JSON files were not moved. Delete research.sqlite before retrying.'); for (const m of problems) console.error('  - ' + m); process.exit(1); }
  console.log(`Migrated and verified: ${posts.length} posts, ${obsDb} measurements, ${searches.length} searches -> ${dbFile(cfg)}`);
} finally { if (db.isOpen) db.close(); }

if (process.argv.includes('--archive')) {
  const to = join(dir, 'archive', new Date().toISOString().slice(0, 10) + '-before-sqlite'); mkdirSync(to, { recursive: true });
  if (existsSync(postsDir)) renameSync(postsDir, join(to, 'posts'));
  if (existsSync(searchesFile)) renameSync(searchesFile, join(to, 'searches.jsonl'));
  console.log(`JSON store moved to ${to}. ideas.json, sources/ and inbox/ were left in place.`);
} else console.log('JSON files left in place. Re-run with --archive to move them aside (only after deleting research.sqlite, since it refuses to re-migrate).');
