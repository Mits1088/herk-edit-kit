// frames.mjs - pixel checks that need a live page (Playwright): overlay leaks and the footage-only reference frame.
//
// overlayLeakAt: HyperFrames hides a clip outside its data-start/data-duration window with `visibility: hidden`. Some
// layers still paint under a hidden ancestor (Caveman v4: an SVG feTurbulence grain with mix-blend-mode tinted every
// full-face shot). At one time, the page is shot with out-of-window clips set to `visibility: hidden` (as the runtime
// does) and again with them removed (`display: none`). A real difference is a leak: something paints while hidden.
//
// footageReference: the same frame with every element removed except the <video> elements and their ancestors, the
// video seeked to the matching media time. Filters on the video itself are kept, so an intended grade stays in the
// reference. It also returns the boxes of everything that intentionally paints over the footage at that time (text,
// images, SVG, filled or bordered boxes), so a comparison can leave those areas out.
//
// pixelDiff / bandCompare run in the page (canvas), so no image library is needed.

const sleepFrames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

// Diff two PNG buffers. Pixels whose largest channel difference exceeds `level` count; the box bounds them.
export async function pixelDiff(page, a, b, { level = 8 } = {}) {
  return page.evaluate(async ([pa, pb, lvl]) => {
    const load = async (b64) => { const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob()); const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); return g.getImageData(0, 0, bmp.width, bmp.height); };
    const A = await load(pa), B = await load(pb);
    if (A.width !== B.width || A.height !== B.height) return { error: `size ${A.width}x${A.height} vs ${B.width}x${B.height}` };
    let n = 0, max = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 0; i < A.data.length; i += 4) {
      const m = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
      if (m > max) max = m;
      if (m > lvl) { n++; const p = i / 4, x = p % A.width, y = (p - x) / A.width; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    }
    return { count: n, max, box: n ? [x0, y0, x1, y1] : null };
  }, [a.toString('base64'), b.toString('base64'), level]);
}

// Hide out-of-window clips the way the runtime does (mode 'hidden') or remove them (mode 'none'); 'restore' undoes it.
async function setClips(page, compId, t, mode) {
  return page.evaluate(([id, time, m]) => {
    const root = document.querySelector(`[data-composition-id="${id}"]`);
    const clips = [...root.querySelectorAll('[data-start][data-duration]')];
    const out = [];
    for (const el of clips) {
      const s = +el.getAttribute('data-start'), d = +el.getAttribute('data-duration');
      if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') continue;
      const inWindow = time >= s && time < s + d;
      if (m === 'restore') { if (el.dataset.qaPrev !== undefined) { el.style.cssText = el.dataset.qaPrev; delete el.dataset.qaPrev; } continue; }
      if (el.dataset.qaPrev === undefined) el.dataset.qaPrev = el.style.cssText;
      if (inWindow) continue;
      if (m === 'hidden') el.style.visibility = 'hidden';
      if (m === 'none') el.style.display = 'none';
      out.push(el.id || el.className || el.tagName.toLowerCase());
    }
    return out;
  }, [compId, t, mode]);
}

export async function overlayLeakAt(page, compId, t, { level = 8, minPixels = 400 } = {}) {
  await page.evaluate(([id, time]) => { const tl = window.__timelines[id]; tl.pause(); tl.seek(time, false); }, [compId, t]);
  const hiddenClips = await setClips(page, compId, t, 'hidden');
  await sleepFrames(page);
  const shown = await page.screenshot({ type: 'png' });
  await setClips(page, compId, t, 'none');
  await sleepFrames(page);
  const removed = await page.screenshot({ type: 'png' });
  await setClips(page, compId, t, 'restore');
  const d = await pixelDiff(page, shown, removed, { level });
  return { t, ...d, leak: !d.error && d.count >= minPixels, hiddenClips };
}

// Footage-only reference frame plus the boxes of intentional overlays at time t.
export async function footageReference(page, compId, t) {
  await page.evaluate(([id, time]) => { const tl = window.__timelines[id]; tl.pause(); tl.seek(time, false); }, [compId, t]);
  const info = await page.evaluate(async ([id, time]) => {
    const root = document.querySelector(`[data-composition-id="${id}"]`);
    const videos = [...root.querySelectorAll('video')];
    if (!videos.length) return { videos: 0, masks: [] };
    const live = (el) => { for (let e = el; e && e.getAttribute; e = e.parentElement) {
      const s = e.getAttribute('data-start'), d = e.getAttribute('data-duration');
      if (s !== null && d !== null && (time < +s || time >= +s + +d)) return false; } return true; };
    const shown = (el) => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; o *= +s.opacity; } return o > 0.05; };
    // Intentional overlays: live, shown elements that paint something of their own.
    const keep = new Set(); for (const v of videos) for (let e = v; e; e = e.parentElement) keep.add(e);
    const masks = [];
    for (const el of root.querySelectorAll('*')) {
      if (keep.has(el) || !live(el) || !shown(el)) continue;
      const s = getComputedStyle(el);
      const paints = /^(IMG|SVG|CANVAS|svg)$/.test(el.tagName) || [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
        || (s.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor)) || s.backgroundImage !== 'none'
        || parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderLeftWidth) > 0 || s.boxShadow !== 'none';
      if (!paints) continue;
      const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
      masks.push([Math.floor(r.left), Math.floor(r.top), Math.ceil(r.right), Math.ceil(r.bottom)]);
    }
    // Seek each video to its media time: (t - clip start) + data-media-start.
    await Promise.all(videos.map((v) => new Promise((done) => {
      const start = +(v.getAttribute('data-start') || 0), media = +(v.getAttribute('data-media-start') || 0);
      const target = Math.max(0, time - start + media);
      v.pause();
      if (Math.abs(v.currentTime - target) < 0.001 && v.readyState >= 2) return done();
      const finish = () => { v.removeEventListener('seeked', finish); done(); };
      v.addEventListener('seeked', finish); v.currentTime = target; setTimeout(finish, 5000);
    })));
    // Remove everything else for the reference shot.
    for (const el of root.querySelectorAll('*')) {
      if (keep.has(el) || el.tagName === 'VIDEO') continue;
      if ([...keep].some((k) => el.contains(k))) continue;
      el.dataset.qaRefPrev = el.style.cssText; el.style.display = 'none';
    }
    return { videos: videos.length, masks };
  }, [compId, t]);
  await sleepFrames(page);
  const png = info.videos ? await page.screenshot({ type: 'png' }) : null;
  await page.evaluate((id) => {
    for (const el of document.querySelectorAll(`[data-composition-id="${id}"] [data-qa-ref-prev]`)) { el.style.cssText = el.dataset.qaRefPrev; delete el.dataset.qaRefPrev; }
  }, compId);
  return { t, png, masks: info.masks, videos: info.videos };
}

// Mean colour per horizontal band (top, middle, bottom) of two frames, ignoring masked boxes. Returns per band the
// luma difference, the largest channel difference and the share of the band that was compared.
export async function bandCompare(page, encoded, reference, masks, { bands = 3 } = {}) {
  return page.evaluate(async ([pe, pr, mk, nb]) => {
    const load = async (b64) => { const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob()); const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); return g.getImageData(0, 0, bmp.width, bmp.height); };
    const E = await load(pe), R = await load(pr);
    if (E.width !== R.width || E.height !== R.height) return { error: `size ${E.width}x${E.height} vs ${R.width}x${R.height}` };
    const W = E.width, H = E.height, masked = new Uint8Array(W * H);
    for (const [x0, y0, x1, y1] of mk) for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) masked.fill(1, y * W + Math.max(0, x0), y * W + Math.min(W, x1));
    const out = [];
    for (let b = 0; b < nb; b++) {
      const ya = Math.floor(b * H / nb), yb = Math.floor((b + 1) * H / nb);
      const se = [0, 0, 0], sr = [0, 0, 0]; let n = 0;
      for (let y = ya; y < yb; y++) for (let x = 0; x < W; x++) {
        const p = y * W + x; if (masked[p]) continue; const i = p * 4; n++;
        se[0] += E.data[i]; se[1] += E.data[i + 1]; se[2] += E.data[i + 2]; sr[0] += R.data[i]; sr[1] += R.data[i + 1]; sr[2] += R.data[i + 2];
      }
      const total = (yb - ya) * W;
      if (!n) { out.push({ band: b, coverage: 0 }); continue; }
      const me = se.map((v) => v / n), mr = sr.map((v) => v / n);
      const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      out.push({ band: b, coverage: +(n / total).toFixed(3), dLuma: +(luma(me) - luma(mr)).toFixed(1), dMax: +Math.max(...me.map((v, k) => Math.abs(v - mr[k]))).toFixed(1) });
    }
    return { bands: out };
  }, [encoded.toString('base64'), reference.toString('base64'), masks, bands]);
}
