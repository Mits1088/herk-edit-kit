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
    const [cmd, ...pre] = cfg.subtitlesCommand; let p, timedOut = false, log = '';
    const finish = r => { clearTimeout(timer); try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp file only */ } resolve(r); };
    try { p = spawn(cmd, [...pre, out, videoId], { cwd: cfg.last30freeDir, windowsHide: true }); }
    catch (e) { return finish({ ok: false, error: `${FAILED}: the subtitle helper did not start (${e.message}).` }); }
    // A stalled video must not hold up every save behind it: stop the helper and everything it started.
    const timer = setTimeout(() => {
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
      // The helper says the same thing when a video has no captions and when YouTube refuses, so this does too,
      // unless the log underneath names YouTube's rate limit.
      if (j && /HTTP Error 429|Too Many Requests/i.test(log)) return finish({ ok: false, error: `${FAILED}: YouTube refused the request (too many requests). Wait a few minutes, then Retry.` });
      if (j) return finish({ ok: false, error: `${FAILED}. The video may have no captions, or YouTube refused the request.` });
      finish({ ok: false, error: `${FAILED}: the helper stopped (code ${code}) without a result.${log.trim() ? ' ' + log.trim().split('\n').pop().slice(0, 200) : ''}` });
    });
  });
}

// The queue. enqueue() is repeat-safe per idea: an idea already waiting or running is not added again.
// onResult(ideaId, result) is called once per fetch; it is the caller's job to write it.
export function createFetcher(cfg, onResult) {
  const runner = cfg.subtitleRunner || runSubtitles, gapMs = cfg.subtitleGapMs ?? 3000;
  const waiting = [], busy = new Set(); let running = null, cooling = false, idleWaiters = [];
  const settle = () => { if (!running && !waiting.length) { const w = idleWaiters; idleWaiters = []; w.forEach(f => f()); } };
  async function next() {
    if (running || !waiting.length) return settle();
    running = waiting.shift();
    let r; try { r = await runner(cfg, running.videoId); } catch (e) { r = { ok: false, error: `${FAILED}: ${e.message}` }; }
    try { onResult(running.ideaId, r); } catch { /* an unreadable ideas file is left alone */ }
    busy.delete(running.ideaId); running = null;
    if (waiting.length) { cooling = true; setTimeout(() => { cooling = false; next(); }, gapMs); } else settle();
  }
  return {
    enqueue(ideaId, videoId) { if (busy.has(ideaId)) return false; busy.add(ideaId); waiting.push({ ideaId, videoId }); if (!running && !cooling) next(); return true; },
    has: ideaId => busy.has(ideaId),
    // A removed idea leaves the queue. One already running finishes, and its result is then dropped by the caller.
    drop(ideaId) { const i = waiting.findIndex(x => x.ideaId === ideaId); if (i >= 0) { waiting.splice(i, 1); busy.delete(ideaId); } },
    idle: () => new Promise(r => { idleWaiters.push(r); settle(); }),
  };
}
