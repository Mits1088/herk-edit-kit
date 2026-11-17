// SQLite storage for the research store. research.mjs owns the rules (validation, merging, growth); this file
// only turns its post and search objects into rows and back, losslessly.
// One file: reels-data/research/research.sqlite. Only the importer writes it; the dashboard opens it read-only.
// Plan: docs/plans/research-database/PLAN.md.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

export const SCHEMA_VERSION = 1;
export const dbFile = cfg => join(cfg.researchDir, 'research.sqlite');
const METRICS = ['views', 'plays', 'reach', 'likes', 'comments', 'shares', 'saves', 'followers'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS searches (
  batch_id TEXT PRIMARY KEY, query TEXT NOT NULL, window_days INTEGER, retrieved_at TEXT NOT NULL,
  imported_at TEXT NOT NULL, sha256 TEXT NOT NULL, post_count INTEGER NOT NULL, record_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs (
  batch_id TEXT NOT NULL REFERENCES searches(batch_id), seq INTEGER NOT NULL, provider TEXT NOT NULL,
  lane TEXT NOT NULL, status TEXT NOT NULL, error TEXT, note TEXT, counts_json TEXT, cost_json TEXT,
  PRIMARY KEY (batch_id, seq));
CREATE TABLE IF NOT EXISTS run_results (
  batch_id TEXT NOT NULL, seq INTEGER NOT NULL, position INTEGER NOT NULL, post_key TEXT NOT NULL,
  PRIMARY KEY (batch_id, seq, position));
CREATE TABLE IF NOT EXISTS posts (
  key TEXT PRIMARY KEY, platform TEXT NOT NULL, native_id TEXT NOT NULL, url TEXT, format TEXT NOT NULL,
  creator_handle TEXT, creator_name TEXT, title TEXT, caption TEXT, published_at TEXT, duration_seconds REAL,
  transcript_text TEXT, transcript_origin TEXT, transcript_captured_at TEXT, transcript_provider TEXT,
  first_retrieved_at TEXT NOT NULL, last_retrieved_at TEXT NOT NULL, has_excerpts INTEGER NOT NULL DEFAULT 0,
  UNIQUE (platform, native_id));
CREATE TABLE IF NOT EXISTS post_sources (
  post_key TEXT NOT NULL REFERENCES posts(key), provider TEXT NOT NULL, ord INTEGER NOT NULL,
  first_retrieved_at TEXT NOT NULL, last_retrieved_at TEXT NOT NULL, PRIMARY KEY (post_key, provider));
CREATE TABLE IF NOT EXISTS post_source_batches (
  post_key TEXT NOT NULL, provider TEXT NOT NULL, batch_id TEXT NOT NULL, ord INTEGER NOT NULL,
  PRIMARY KEY (post_key, provider, batch_id));
CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY, post_key TEXT NOT NULL REFERENCES posts(key), ord INTEGER NOT NULL,
  provider TEXT NOT NULL, measured_at TEXT, measured_basis TEXT, fingerprint TEXT NOT NULL,
  views INTEGER, plays INTEGER, reach INTEGER, likes INTEGER, comments INTEGER, shares INTEGER, saves INTEGER,
  followers INTEGER, discovery_score REAL, score_formula TEXT,
  outlier_metric TEXT, outlier_value REAL, outlier_percentile REAL, outlier_cohort_size INTEGER, outlier_json TEXT,
  first_retrieved_at TEXT NOT NULL, last_retrieved_at TEXT NOT NULL, UNIQUE (post_key, fingerprint));
CREATE TABLE IF NOT EXISTS observation_sightings (
  observation_id INTEGER NOT NULL REFERENCES observations(id), batch_id TEXT NOT NULL,
  PRIMARY KEY (observation_id, batch_id));
CREATE TABLE IF NOT EXISTS excerpts (
  post_key TEXT NOT NULL REFERENCES posts(key), seq INTEGER NOT NULL, provider TEXT NOT NULL, batch_id TEXT NOT NULL,
  kind TEXT NOT NULL, text TEXT NOT NULL, complete INTEGER, PRIMARY KEY (post_key, seq));
CREATE INDEX IF NOT EXISTS obs_post ON observations (post_key, ord);
CREATE INDEX IF NOT EXISTS posts_published ON posts (published_at);
`;

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
// Stable JSON with unknown (null) values left out, so the same facts always give the same fingerprint.
const canon = v => Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : isObj(v) ? `{${Object.keys(v).filter(k => v[k] != null).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',')}}`
  : JSON.stringify(v);
// One measurement's identity: source, measured time and every piece of evidence (all metrics, score, formula,
// every outlier field). Retrieval times are not part of it: a repeat sighting is the same measurement.
export const fingerprint = o => createHash('sha256').update(canon({ provider: o.provider, measuredAt: o.measuredAt ?? null, metrics: o.metrics, outlier: o.outlier, discoveryScore: o.discoveryScore, scoreFormula: o.scoreFormula })).digest('hex');

// Read-only when the file is missing returns null, so a dry run or a page view never creates the database.
export function openDb(cfg, { write = false } = {}) {
  const file = dbFile(cfg);
  if (!write && !existsSync(file)) return null;
  if (write) mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file, { readOnly: !write, timeout: 5000 });
  if (write) {
    // Default rollback journal, not WAL: read-only page views then leave no -wal/-shm files behind, and one
    // short import at a time is all this store does. Readers wait for a write through the busy timeout.
    db.exec('PRAGMA foreign_keys = ON');
    const hasMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
    const v = hasMeta ? db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() : null;
    if (!v) { db.exec(SCHEMA); db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION)); }
    else if (Number(v.value) > SCHEMA_VERSION) { db.close(); throw new Error(`research.sqlite has schema ${v.value}, newer than this code (${SCHEMA_VERSION}). Nothing was changed.`); }
  }
  return db;
}
export function withDb(cfg, opts, fn) { const db = openDb(cfg, opts); try { return fn(db); } finally { if (db) db.close(); } }
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw e; }
}

// ---- rows -> objects (the exact shapes the JSON store held) ----
const strip = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));
function rowToObservation(r) {
  const o = { provider: r.provider, measuredAt: r.measured_at ?? null, metrics: strip(Object.fromEntries(METRICS.map(k => [k, r[k]]))) };
  if (r.outlier_json != null) o.outlier = JSON.parse(r.outlier_json);
  if (r.discovery_score != null) o.discoveryScore = r.discovery_score;
  if (r.score_formula != null) o.scoreFormula = r.score_formula;
  if (r.measured_basis != null) o.measuredBasis = r.measured_basis;
  o.firstRetrievedAt = r.first_retrieved_at; o.lastRetrievedAt = r.last_retrieved_at;
  return o;
}
function assemble(db, r) {
  const post = { id: r.key, platform: r.platform, nativeId: r.native_id, url: r.url, format: r.format,
    creator: strip({ handle: r.creator_handle, name: r.creator_name }), title: r.title, caption: r.caption,
    publishedAt: r.published_at, durationSeconds: r.duration_seconds,
    transcript: r.transcript_text == null ? null : { text: r.transcript_text, origin: r.transcript_origin, capturedAt: r.transcript_captured_at ?? null, provider: r.transcript_provider },
    firstRetrievedAt: r.first_retrieved_at, lastRetrievedAt: r.last_retrieved_at, provenance: [], observations: [] };
  const batches = db.prepare('SELECT provider, batch_id FROM post_source_batches WHERE post_key = ? ORDER BY ord').all(r.key);
  post.provenance = db.prepare('SELECT * FROM post_sources WHERE post_key = ? ORDER BY ord').all(r.key).map(s => ({
    provider: s.provider, firstRetrievedAt: s.first_retrieved_at, lastRetrievedAt: s.last_retrieved_at,
    batches: batches.filter(b => b.provider === s.provider).map(b => b.batch_id) }));
  post.observations = db.prepare('SELECT * FROM observations WHERE post_key = ? ORDER BY ord').all(r.key).map(rowToObservation);
  if (r.has_excerpts) post.excerpts = db.prepare('SELECT * FROM excerpts WHERE post_key = ? ORDER BY seq').all(r.key)
    .map(e => ({ provider: e.provider, batchId: e.batch_id, kind: e.kind, text: e.text, ...(e.complete === 0 ? { complete: false } : {}) }));
  return post;
}
export function loadPost(db, key) { const r = db && db.prepare('SELECT * FROM posts WHERE key = ?').get(key); return r ? assemble(db, r) : null; }
export function loadAllPosts(db) { return db ? db.prepare('SELECT * FROM posts ORDER BY key').all().map(r => assemble(db, r)) : []; }
export function loadSearches(db) { return db ? db.prepare('SELECT record_json FROM searches ORDER BY rowid').all().map(r => JSON.parse(r.record_json)) : []; }
export function findSearch(db, batchId) { const r = db && db.prepare('SELECT record_json FROM searches WHERE batch_id = ?').get(batchId); return r ? JSON.parse(r.record_json) : null; }

// ---- objects -> rows ----
// sightedFps: fingerprints of the measurements this batch carried, so each sighting is linked to its batch.
export function savePost(db, post, batchId = null, sightedFps = []) {
  db.prepare(`INSERT INTO posts (key, platform, native_id, url, format, creator_handle, creator_name, title, caption, published_at,
      duration_seconds, transcript_text, transcript_origin, transcript_captured_at, transcript_provider, first_retrieved_at, last_retrieved_at, has_excerpts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET url = excluded.url, format = excluded.format, creator_handle = excluded.creator_handle,
      creator_name = excluded.creator_name, title = excluded.title, caption = excluded.caption, published_at = excluded.published_at,
      duration_seconds = excluded.duration_seconds, transcript_text = excluded.transcript_text, transcript_origin = excluded.transcript_origin,
      transcript_captured_at = excluded.transcript_captured_at, transcript_provider = excluded.transcript_provider,
      first_retrieved_at = excluded.first_retrieved_at, last_retrieved_at = excluded.last_retrieved_at, has_excerpts = excluded.has_excerpts`)
    .run(post.id, post.platform, post.nativeId, post.url ?? null, post.format, post.creator?.handle ?? null, post.creator?.name ?? null,
      post.title ?? null, post.caption ?? null, post.publishedAt ?? null, post.durationSeconds ?? null,
      post.transcript?.text ?? null, post.transcript?.origin ?? null, post.transcript?.capturedAt ?? null, post.transcript?.provider ?? null,
      post.firstRetrievedAt, post.lastRetrievedAt, post.excerpts ? 1 : 0);
  post.provenance.forEach((pv, i) => {
    db.prepare(`INSERT INTO post_sources (post_key, provider, ord, first_retrieved_at, last_retrieved_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (post_key, provider) DO UPDATE SET ord = excluded.ord, first_retrieved_at = excluded.first_retrieved_at, last_retrieved_at = excluded.last_retrieved_at`)
      .run(post.id, pv.provider, i, pv.firstRetrievedAt, pv.lastRetrievedAt);
    pv.batches.forEach((b, j) => db.prepare('INSERT OR IGNORE INTO post_source_batches (post_key, provider, batch_id, ord) VALUES (?, ?, ?, ?)').run(post.id, pv.provider, b, j));
  });
  (post.excerpts || []).forEach((e, i) => db.prepare('INSERT OR IGNORE INTO excerpts (post_key, seq, provider, batch_id, kind, text, complete) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(post.id, i, e.provider, e.batchId, e.kind, e.text, e.complete === false ? 0 : null));
  post.observations.forEach((o, i) => {
    const fp = fingerprint(o); const m = o.metrics || {}; const out = o.outlier || null;
    db.prepare(`INSERT INTO observations (post_key, ord, provider, measured_at, measured_basis, fingerprint, ${METRICS.join(', ')},
        discovery_score, score_formula, outlier_metric, outlier_value, outlier_percentile, outlier_cohort_size, outlier_json, first_retrieved_at, last_retrieved_at)
      VALUES (?, ?, ?, ?, ?, ?, ${METRICS.map(() => '?').join(', ')}, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (post_key, fingerprint) DO UPDATE SET ord = excluded.ord, first_retrieved_at = excluded.first_retrieved_at, last_retrieved_at = excluded.last_retrieved_at`)
      .run(post.id, i, o.provider, o.measuredAt ?? null, o.measuredBasis ?? null, fp, ...METRICS.map(k => m[k] ?? null),
        o.discoveryScore ?? null, o.scoreFormula ?? null, out?.metric ?? null, out?.value ?? null, out?.percentile ?? null, out?.cohortSize ?? null,
        out ? JSON.stringify(out) : null, o.firstRetrievedAt, o.lastRetrievedAt);
    if (batchId && sightedFps.includes(fp)) {
      const { id } = db.prepare('SELECT id FROM observations WHERE post_key = ? AND fingerprint = ?').get(post.id, fp);
      db.prepare('INSERT OR IGNORE INTO observation_sightings (observation_id, batch_id) VALUES (?, ?)').run(id, batchId);
    }
  });
}

// record: the object the JSON store appended to searches.jsonl, kept verbatim; runs and results are also split
// into rows so the page can query them.
export function saveSearch(db, record, postKey) {
  db.prepare('INSERT INTO searches (batch_id, query, window_days, retrieved_at, imported_at, sha256, post_count, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(record.batchId, record.search.query, record.search.windowDays ?? null, record.retrievedAt, record.importedAt, record.sha256, record.posts, JSON.stringify(record));
  (record.runs || []).forEach((r, seq) => {
    db.prepare('INSERT INTO runs (batch_id, seq, provider, lane, status, error, note, counts_json, cost_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(record.batchId, seq, r.provider, r.lane, r.status, r.error ?? null, r.note ?? null, r.counts ? JSON.stringify(r.counts) : null, r.cost ? JSON.stringify(r.cost) : null);
    (r.results || []).forEach((ref, position) => { const at = ref.indexOf(':');
      db.prepare('INSERT INTO run_results (batch_id, seq, position, post_key) VALUES (?, ?, ?, ?)').run(record.batchId, seq, position, postKey(ref.slice(0, at), ref.slice(at + 1))); });
  });
}
export const countSearches = cfg => withDb(cfg, {}, db => (db ? db.prepare('SELECT COUNT(*) AS n FROM searches').get().n : 0));
