// samples.mjs - targeted QA sample frames around the moments that change: authored events, plan events, scene cuts,
// caption groups, clip boundaries and timeline tweens. Pure functions; qa-reel.mjs collects the events.
//
// Evenly spaced samples miss short transitions, and +-2 frames around a boundary miss a 150-300 ms move, so a short
// span (<= SHORT s) is sampled before, at its start, during, at its end and after. A point, or a long span's ends, is
// sampled before, at, and once it has had time to settle. Frames are deduplicated by index and capped; when the cap
// bites, higher-priority events win and lower ones are thinned evenly across the film, never just truncated.

export const PRIORITY = { authored: 0, plan: 0, scene: 1, caption: 2, clip: 2, tween: 3 };
export const SHORT = 1.0;
const SETTLE = 0.2;

// events: [{ t, end?, reason, source }]. Returns [{ frame, t, phase, reason, priority }] sorted by frame.
export function planSamples(events, { fps, duration, cap = 36 }) {
  const last = Math.max(0, Math.round(duration * fps) - 1);
  const byFrame = new Map();
  const put = (time, phase, ev) => {
    if (!Number.isFinite(time)) return;
    const frame = Math.min(last, Math.max(0, Math.round(time * fps)));
    const priority = PRIORITY[ev.source] ?? 3;
    const reason = `${ev.reason} (${phase})`;
    const prev = byFrame.get(frame);
    if (!prev) byFrame.set(frame, { frame, t: +(frame / fps).toFixed(3), phase, reason, priority });
    else {
      if (priority < prev.priority) Object.assign(prev, { phase, priority, reason: `${reason}; ${prev.reason}` });
      else if (!prev.reason.includes(reason)) prev.reason += `; ${reason}`;
    }
  };
  const f = 1 / fps;
  const point = (t, ev) => { put(t - f, 'before', ev); put(t, 'at', ev); put(t + SETTLE, 'after', ev); };
  for (const ev of events) {
    const t = Number(ev.t), end = ev.end === undefined || ev.end === null ? null : Number(ev.end);
    if (!Number.isFinite(t) || t < 0 || t > duration) continue;
    if (end !== null && end > t && end - t <= SHORT) {
      put(t - f, 'before', ev); put(t, 'at', ev); put((t + end) / 2, 'during', ev); put(end, 'end', ev); put(end + f, 'after', ev);
    } else {
      point(t, ev);
      if (end !== null && end > t && end < duration) { put(end - f, 'before end', ev); put(end, 'end', ev); put(end + f, 'after', ev); }
    }
  }
  const all = [...byFrame.values()];
  if (all.length <= cap) return all.sort((a, b) => a.frame - b.frame);
  const picked = [];
  for (const p of [...new Set(all.map(s => s.priority))].sort((a, b) => a - b)) {
    const group = all.filter(s => s.priority === p).sort((a, b) => a.frame - b.frame);
    const room = cap - picked.length;
    if (room <= 0) break;
    if (group.length <= room) picked.push(...group);
    else for (let i = 0; i < room; i++) picked.push(group[Math.round(i * (group.length - 1) / Math.max(1, room - 1))]);
  }
  return [...new Set(picked)].sort((a, b) => a.frame - b.frame);
}

// Events from a short-form plan.json: authored visual events, scene cuts, caption groups.
export function planEvents(plan) {
  const out = [];
  for (const e of plan?.events || []) out.push({ t: e.time, reason: `plan event ${e.type || ''} ${e.visual || ''}`.trim(), source: 'plan' });
  for (const s of plan?.scenes || []) out.push({ t: s.start, end: s.end, reason: `scene ${s.id}`, source: 'scene' });
  for (const [i, c] of (plan?.captions || []).entries()) {
    const words = (c.words || []).map(w => w.text).join(' ').slice(0, 24);
    out.push({ t: c.start, end: c.end, reason: `caption ${i + 1}${words ? ` "${words}"` : ''}`, source: 'caption' });
  }
  return out;
}

// Browser side, passed to page.evaluate: clip windows, the timeline's tweens (nested timelines resolved to the root
// clock) and authored window.__events ([{ t | time | start, end? | duration?, label? }]). Returns plain event objects.
export function collectPageEvents(id) {
  const out = [];
  const name = el => el && el.nodeType === 1 ? (el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}${el.classList[0] ? `.${el.classList[0]}` : ''}`) : null;
  for (const el of document.querySelectorAll(`[data-composition-id="${id}"] [data-start][data-duration]`)) {
    const s = +el.getAttribute('data-start'), d = +el.getAttribute('data-duration');
    if (Number.isFinite(s) && Number.isFinite(d)) out.push({ t: s, end: s + d, reason: `clip ${name(el)}`, source: /cap/i.test(el.id + ' ' + el.className) ? 'caption' : 'clip' });
  }
  const walk = (tl, offset) => {
    for (const c of tl.getChildren(false, true, true)) {
      const start = offset + c.startTime();
      if (typeof c.getChildren === 'function') { walk(c, start); continue; }
      const targets = (c.targets ? c.targets() : []).filter(x => x && x.nodeType === 1);
      if (!targets.length) continue; // anchors and plain-object tweens draw nothing
      out.push({ t: start, end: start + c.totalDuration(), reason: `tween ${name(targets[0])}${targets.length > 1 ? ` +${targets.length - 1}` : ''}`, source: 'tween' });
    }
  };
  const tl = window.__timelines && window.__timelines[id];
  if (tl && typeof tl.getChildren === 'function') walk(tl, 0);
  for (const e of Array.isArray(window.__events) ? window.__events : []) {
    const t = e.t ?? e.time ?? e.start;
    const end = e.end ?? (e.duration !== undefined ? t + e.duration : undefined);
    out.push({ t, end, reason: `event ${e.label || e.name || e.type || ''}`.trim(), source: 'authored' });
  }
  return out;
}
