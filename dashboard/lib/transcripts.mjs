// YouTube transcripts fetched when an idea is saved. One video at a time, with a short gap between them, so a run
// of saves does not get refused by YouTube. The helper is research-signals' yt-subtitles.py, run with last30free's
// Python; it reads YouTube's own captions (no audio, no Whisper).
// This module only runs the helper. What a result does to ideas.json is decided by the caller (lib/ideas.mjs),
// which re-reads the file when a fetch finishes, so edits made while it ran are kept.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
export const FAILED = "Couldn't fetch subtitles";

// One run of the helper for one video id. Resolves { ok: true, text } or { ok: false, error }; never rejects.
export function runSubtitles(cfg, videoId, { timeoutMs = cfg.subtitleTimeoutMs ?? 90000 } = {}) {
  return new Promise(resolve => {
    if (!YOUTUBE_ID.test(String(videoId))) return resolve({ ok: false, error: `${FAILED}: "${videoId}" is not a YouTube video id.` });
    const dir = mkdtempSync(join(tmpdir(), 'subs-')), out = join(dir, 'subs.json');
    // timer is declared before the spawn attempt: a spawn that throws calls finish() before any timer exists.
    const [cmd, ...pre] = cfg.subtitlesCommand; let p, timer = null, timedOut = false, log = '';
    const finish = r => { if (timer) clearTimeout(timer); try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp file only */ } resolve(r); };
    try { p = spawn(cmd, [...pre, out, videoId], { cwd: cfg.last30freeDir, windowsHide: true }); }
    catch (e) { return finish({ ok: false, error: `${FAILED}: the subtitle helper did not start (${e.message}).` }); }
    // A stalled video must not hold up every save behind it: stop the helper and everything it started.
    timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }); else p.kill('SIGKILL');
    }, timeoutMs);
    const keep = c => { log = (log + c).slice(-2000); };
    p.stdout.on('data', keep); p.stderr.on('data', keep);
    p.on('error', e => finish({ ok: false, error: `${FAILED}: the subtitle helper did not start (${e.message}).` }));
    p.on('close', code => {
      if (timedOut) return finish({ ok: false, error: `${FAILED}: it took longer than ${Math.round(timeoutMs / 1000)} seconds, so it was stopped.` });
      let j = null; try { j = JSON.parse(readFileSync(out, 'utf8')); } catch { /* no output file */ }
      const text = j && j.transcripts && typeof j.transcripts[videoId] === 'string' ? j.transcripts[videoId].trim() : '';
      if (text) return finish({ ok: true, text });
      // A 429 is reported by the helper itself (rateLimited), or named in its log by an older helper.
      if (j && ((j.rateLimited && j.rateLimited[videoId]) || /HTTP Error 429|Too Many Requests/i.test(log))) return finish({ ok: false, rateLimited: true, error: `${FAILED}: YouTube refused the request (too many requests).` });
      if (j && j.failed && typeof j.failed[videoId] === 'string' && /no English subtitles/.test(j.failed[videoId])) return finish({ ok: false, error: `${FAILED}: the video has no English subtitles or automatic captions.` });
      if (j) return finish({ ok: false, error: `${FAILED}. The video may have no captions, or YouTube refused the request.` });
      finish({ ok: false, error: `${FAILED}: the helper stopped (code ${code}) without a result.${log.trim() ? ' ' + log.trim().split('\n').pop().slice(0, 200) : ''}` });
    });
  });
}

// The queue. enqueue() is repeat-safe per idea: an idea already waiting or running is not added again.
// onResult(ideaId, result) is called once per idea, with its final result; it is the caller's job to write it.
// When YouTube answers 429, the whole queue backs off: the same video goes back to the front and is tried again
// after each wait in backoffMs (5, 15 and 30 minutes). Only after the last refusal is the failure reported.
export const BACKOFF_MS = [5 * 60000, 15 * 60000, 30 * 60000];
export function createFetcher(cfg, onResult) {
  const runner = cfg.subtitleRunner || runSubtitles, gapMs = cfg.subtitleGapMs ?? 15000, backoff = cfg.subtitleBackoffMs || BACKOFF_MS;
  // notBefore: the earliest a fetch may start, gapMs after the last one finished. It holds across idle periods, so a
  // save arriving just after the queue emptied still waits out the gap.
  const waiting = [], busy = new Set(); let running = null, timer = null, notBefore = 0, idleWaiters = [];
  const settle = () => { if (!running && !waiting.length) { const w = idleWaiters; idleWaiters = []; w.forEach(f => f()); } };
  function next() {
    if (running || timer) return;
    if (!waiting.length) return settle();
    const wait = notBefore - Date.now();
    if (wait > 0) { timer = setTimeout(() => { timer = null; next(); }, wait); return; }
    const job = running = waiting.shift();
    let started; try { started = Promise.resolve(runner(cfg, job.videoId)); } catch (e) { started = Promise.reject(e); }
    started.catch(e => ({ ok: false, error: `${FAILED}: ${e.message}` })).then(r => {
      running = null;
      if (r && r.rateLimited && (job.attempt || 0) < backoff.length && busy.has(job.ideaId)) {
        const wait = backoff[job.attempt || 0]; job.attempt = (job.attempt || 0) + 1; job.retryAt = Date.now() + wait;
        waiting.unshift(job); notBefore = job.retryAt; return next(); // still busy: Save and Retry stay repeat-safe
      }
      if (r && r.rateLimited) r = { ...r, error: `${FAILED}: YouTube kept refusing (too many requests), ${backoff.length + 1} tries over about ${Math.round(backoff.reduce((a, b) => a + b, 0) / 60000)} minutes. Try again later, or paste the transcript.` };
      try { onResult(job.ideaId, r); } catch { /* an unreadable ideas file is left alone */ }
      busy.delete(job.ideaId); notBefore = Math.max(notBefore, Date.now() + gapMs); next();
    });
  }
  return {
    enqueue(ideaId, videoId) { if (busy.has(ideaId)) return false; busy.add(ideaId); waiting.push({ ideaId, videoId }); next(); return true; },
    has: ideaId => busy.has(ideaId),
    // When a video is waiting out YouTube's rate limit: the time of its next try, else null.
    retryAt: ideaId => { const j = waiting.find(x => x.ideaId === ideaId); return j && j.retryAt ? new Date(j.retryAt).toISOString() : null; },
    // When the whole queue is paused for the rate limit: the time it starts again, else null.
    pausedUntil: () => (notBefore > Date.now() && waiting.some(x => x.retryAt) ? new Date(notBefore).toISOString() : null),
    // A removed idea leaves the queue. One already running finishes, and its result is then dropped by the caller.
    drop(ideaId) {
      const i = waiting.findIndex(x => x.ideaId === ideaId); if (i < 0) return;
      waiting.splice(i, 1); busy.delete(ideaId);
      if (!waiting.length && timer) { clearTimeout(timer); timer = null; settle(); }
    },
    idle: () => new Promise(r => { idleWaiters.push(r); settle(); }),
  };
}
