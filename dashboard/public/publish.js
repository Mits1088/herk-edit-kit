/* Publishing composer. Network writes happen only on an explicit Publish, Schedule or Retry click. */
window.Publishing = (() => {
  const order = ['instagram', 'facebook', 'tiktok', 'youtube'];
  const names = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube Shorts' };
  const short = { instagram: 'ig', facebook: 'fb', tiktok: 'tt', youtube: 'yt' };
  const states = { prepared: ['run', 'Submission saved'], uploading: ['run', 'Uploading video'], submitting: ['run', 'Submitting'], retrying: ['run', 'Retrying'], processing: ['run', 'Processing'], scheduled: ['wait', 'Scheduled in Zernio'], published: ['ok', 'Published'], failed: ['bad', 'Failed'], unknown: ['you', 'Confirmation needed'], verify: ['you', 'Manual review required'], inbox: ['you', 'Manual action required'], cancelled: ['wait', 'Cancelled'] };
  const drafts = new Map(); let connected = null, checkingAccounts = false, accountError = '', pending = false;
  const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const link = u => { try { return new URL(u).protocol === 'https:' ? E(u) : ''; } catch { return ''; } };
  const caption = f => [f.text.trim(), f.tags.trim().split(/[\s,]+/).filter(Boolean).map(t => t.startsWith('#') ? t : '#' + t).join(' ')].filter(Boolean).join('\n\n');
  const textParts = t => { const m = String(t || '').trim().match(/(?:^|\n)\s*((?:#[\p{L}\p{N}_]+\s*)+)$/u); return { text: m ? t.slice(0, m.index).trim() : String(t || '').trim(), tags: m ? m[1].trim() : '' }; };
  function model(it, detail) {
    if (drafts.has(it.id)) {
      const m = drafts.get(it.id);
      if (detail?.video && detail.video.sha !== m.sha) { m.sha = detail.video.sha; m.selected = []; m.fields.tiktok.consentPreview = false; m.fields.tiktok.consentExpress = false; }
      return m;
    }
    if (!detail) return null;
    const a = detail.approved || {}, y = a.youtubeParts || {}, saved = it.zernio?.draft?.fields || {};
    // House defaults: TikTok Direct Post, public, no commercial content, comments on, Duet/Stitch off; YouTube public.
    // Saved draft values win; empty saved selections fall back to the default. The server still validates each
    // value against the live connection, and the two TikTok confirmations always start unticked.
    const or = (v, d) => (v === '' || v == null ? d : v);
    const st = saved.tiktok || {}, sy = saved.youtube || {};
    const fields = {
      instagram: { ...textParts(a.instagram), ...saved.instagram },
      facebook: { ...textParts(a.facebook || a.instagram), ...saved.facebook },
      tiktok: { ...textParts(a.tiktok), commercial: 'none', comment: true, duet: false, stitch: false, ...st, mode: or(st.mode, 'direct'), privacy: or(st.privacy, 'PUBLIC_TO_EVERYONE'), consentPreview: false, consentExpress: false },
      youtube: { ...textParts(y.description || a.youtube), title: y.title || it.title, keywords: y.tags || '', ...sy, visibility: or(sy.visibility, 'public') },
    };
    const m = { fields, selected: [], when: '', sha: detail.video?.sha || null }; drafts.set(it.id, m); return m;
  }
  async function accounts(fresh = false) {
    if (checkingAccounts) return;
    checkingAccounts = true;
    try { const r = await fetch('/api/zernio/accounts' + (fresh ? '?fresh=1' : '')); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Could not check connected accounts'); connected = j; accountError = ''; }
    catch (e) { accountError = e.message; }
    finally { checkingAccounts = false; if (cur && tab === 'publish') render(); }
  }
  const input = (p, k, title, value, extra = '') => `<label class="form" for="z-${p}-${k}"><span class="sub">${title}</span><input class="inp" id="z-${p}-${k}" data-z-platform="${p}" data-z-field="${k}" value="${E(value)}" ${extra}></label>`;
  const select = (p, k, title, value, opts) => `<label class="form" for="z-${p}-${k}"><span class="sub">${title}</span><select id="z-${p}-${k}" data-z-platform="${p}" data-z-field="${k}">${opts.map(([v, t]) => `<option value="${E(v)}" ${v === value ? 'selected' : ''}>${E(t)}</option>`).join('')}</select></label>`;
  const tick = (p, k, title, value, disabled = false) => `<label class="z-tick"><input type="checkbox" data-z-platform="${p}" data-z-field="${k}" ${value ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span>${E(title)}</span></label>`;
  function platformCard(it, p, m, blocked) {
    const d = connected?.destinations[p], f = m.fields[p], prior = it.zernio?.latest?.[p];
    const posted = it.platforms[short[p]]?.state === 'published';
    const held = prior && prior.state !== 'cancelled';
    const unavailable = blocked || !d?.ready || posted || held;
    let extras = '';
    if (p === 'youtube') extras = input(p, 'title', 'YouTube title', f.title, 'maxlength="100"') + input(p, 'keywords', 'Keyword tags (comma separated)', f.keywords) + select(p, 'visibility', 'Visibility', f.visibility, [['', 'Choose visibility'], ['public', 'Public'], ['unlisted', 'Unlisted'], ['private', 'Private']]) + '<p class="sub">This video is not made for children. YouTube determines Shorts from the video format.</p>';
    if (p === 'tiktok') {
      const t = d?.tiktok || {}, n = d?.notes || [];
      extras = select(p, 'mode', 'Delivery', f.mode, [['', 'Choose delivery'], ...(n.includes('Direct Post is available') ? [['direct', 'Direct Post']] : []), ...(n.includes('Creator Inbox handoff is available') ? [['inbox', 'Creator Inbox (finish in TikTok)']] : [])])
        + select(p, 'privacy', 'Who can see this post', f.privacy, [['', 'Choose privacy'], ...(t.privacyLevels || []).map(x => [x.value, x.label])])
        + select(p, 'commercial', 'Commercial disclosure', f.commercial, (t.commercial || [{ value: 'none', label: 'No commercial content' }]).map(x => [x.value, x.label]))
        + [['comment', 'allow_comment', 'Allow comments'], ['duet', 'allow_duet', 'Allow Duet'], ['stitch', 'allow_stitch', 'Allow Stitch']].map(([k, key, title]) => tick(p, k, title, f[k], t.interactions?.[key]?.enabled !== true)).join('')
        + tick(p, 'consentPreview', 'I reviewed this exact video and the TikTok text and settings.', f.consentPreview)
        + tick(p, 'consentExpress', 'I consent to sending this video to the selected TikTok account.', f.consentExpress)
        + '<p class="sub">Direct Post publishes through TikTok. Creator Inbox sends a handoff: finish the caption, privacy and Post tap in the TikTok app. A handoff is not a public post.</p>';
    }
    return `<article class="panel z-destination"><div class="row" style="justify-content:space-between"><label class="z-tick"><input type="checkbox" data-z-select="${p}" ${m.selected.includes(p) && !unavailable ? 'checked' : ''} ${unavailable ? 'disabled' : ''}><strong>${names[p]}</strong></label><span class="pill ${posted ? 'ok' : d?.ready ? 'ok' : 'wait'}">${posted ? 'Already published' : d?.ready ? 'Connected' : 'Unavailable'}</span></div>
      <div><p>${E(d?.handle ? '@' + d.handle : d?.displayName || 'No connected account')}</p><p class="mono">Login ${p === 'youtube' || p === 'tiktok' ? 'A' : 'B'}${d?.accountId ? ' · ' + E(d.accountId) : ''}</p></div>
      ${d ? `<p class="sub">${E([d.health ? 'Connection: ' + d.health : '', ...(d.notes || []), ...(d.issues || [])].filter(Boolean).join('. '))}</p>` : '<p class="sub">Checking connection…</p>'}
      ${held ? `<p class="info">${E(states[prior.state]?.[1] || prior.state)}. See the saved submission below.</p>` : ''}
      <fieldset ${blocked ? 'disabled' : ''}><legend class="sub">${p === 'facebook' ? 'Facebook text' : p === 'youtube' ? 'Description and settings' : 'Caption and settings'}</legend>
      <label class="form" for="z-${p}-text"><span class="sub">${p === 'youtube' ? 'Description' : 'Caption'}</span><textarea class="inp" id="z-${p}-text" data-z-platform="${p}" data-z-field="text" rows="5">${E(f.text)}</textarea></label>
      ${input(p, 'tags', 'Hashtags (included in the published text)', f.tags)}${extras}</fieldset>
      <details><summary>Exact caption preview</summary><div class="cap" id="z-preview-${p}">${E(caption(f))}</div></details></article>`;
  }
  function history(it, remote) {
    const z = it.zernio; if (!z?.posts.length) return '';
    return `<section class="panel"><div class="sec-head"><h3>Saved submissions</h3>${remote ? '' : '<button class="btn small" data-z-action="check">Check status</button>'}</div><p class="sub">Each destination has its own result. Scheduled posts are held by Zernio; this PC can be off after acceptance.</p>
      ${z.posts.map(p => { const s = states[p.state] || ['wait', p.state]; const u = link(p.url); return `<article class="z-record"><div class="row"><strong>${names[p.platform]} · ${E(p.handle ? '@' + p.handle : p.accountId)}</strong><span class="pill ${s[0]}">${s[1]}</span></div>
        <p class="sub">${p.mode === 'schedule' ? E(p.scheduledFor?.replace('T', ' ')) + ' Europe/London' : 'Publish immediately'}${p.postId ? ' · Zernio post ' + E(p.postId) : ''}</p>
        ${p.error ? `<p class="block">${E(p.error)}</p>` : ''}${p.state === 'inbox' ? '<p class="info">Open TikTok on your phone and finish the post. Nothing is recorded as publicly published until a public link is confirmed.</p>' : ''}
        <div class="row">${u ? `<a class="btn small" href="${u}" target="_blank" rel="noopener">Open published post</a>` : ''}${!remote && !pending && !z.busy && ['failed', 'unknown', 'prepared', 'uploading', 'submitting'].includes(p.state) ? `<button class="btn small" data-z-retry="${E(p.id)}">${p.postId ? 'Retry publish now' : p.mode === 'schedule' ? 'Retry schedule' : 'Retry publish'}: ${names[p.platform]}</button>` : ''}</div>
        <details><summary>Submitted video, text and settings</summary><dl class="kv"><dt>Video SHA-256</dt><dd class="mono">${E(p.videoSha)}</dd>${p.title ? `<dt>Title</dt><dd>${E(p.title)}</dd>` : ''}${p.keywords ? `<dt>Keyword tags</dt><dd>${E(p.keywords.join(', '))}</dd>` : ''}${p.visibility ? `<dt>Visibility</dt><dd>${E(p.visibility)}</dd>` : ''}${p.tiktok ? `<dt>TikTok settings</dt><dd>${E(JSON.stringify(p.tiktok))}</dd>` : ''}</dl><div class="cap">${E(p.text)}</div><p class="sub">Retry preserves this video and text, for this destination only. Retry publish now publishes immediately; a failed future schedule must be adjusted in Zernio or retried after it is due.</p></details></article>`; }).join('')}</section>`;
  }
  function renderComposer(it, detail, remote) {
    if (!connected && !checkingAccounts && !accountError) queueMicrotask(() => accounts());
    const m = model(it, detail), g = it.zernio?.gate || { ok: false, reasons: ['Loading approval status…'] }, v = detail?.video;
    const blocked = remote || !g.ok || !v?.matchesApproval || pending || it.zernio?.busy;
    return `<section id="z-publisher" class="group"><div class="sec-head"><h2>Publish approved video</h2><button class="btn small" data-z-action="accounts" ${checkingAccounts ? 'disabled' : ''}>Check accounts</button></div>
      ${accountError ? `<p class="block">${E(accountError)}</p>` : ''}${connected ? `<p class="sub">Connections checked ${E(new Date(connected.checkedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' }))} Europe/London</p>` : ''}
      ${!g.ok ? `<div class="block">${g.reasons.map(E).join('<br>')}</div>` : ''}${v && !v.matchesApproval ? '<div class="block">The final video differs from the approved file. Approve the current video first.</div>' : ''}
      ${remote ? '<p class="info">Publishing through Zernio stays on the PC. You can review and download here.</p>' : ''}
      ${v ? `<div class="panel media"><video controls playsinline preload="metadata" aria-label="Approved final video" src="/file?p=${encodeURIComponent(v.file)}&v=${E(v.sha)}"></video><div class="group"><h3>Approved final video</h3><p class="mono">${E(v.file)}</p><dl class="kv"><dt>Approved</dt><dd>${E(v.approvedAt || 'Not recorded')}</dd><dt>Size</dt><dd>${(v.size / 1048576).toFixed(1)} MB</dd><dt>SHA-256</dt><dd class="mono">${E(v.sha)}</dd></dl><p class="sub">Subtitles remain part of the approved render.</p><a class="btn small" href="/file?p=${encodeURIComponent(v.file)}&dl=1">Download approved video</a></div></div>` : '<p class="sub">An approved final video is required before submitting.</p>'}
      ${m ? `<div class="z-grid">${order.map(p => platformCard(it, p, m, blocked)).join('')}</div><div class="panel"><h3>Submit selected destinations</h3><p class="sub">Review each caption above, then select its destination. Facebook has its own text. Only selected destinations are sent.</p>
      <label class="form" for="z-when"><span>Posting time · Europe/London</span><input class="inp" type="datetime-local" id="z-when" value="${E(m.when)}" ${remote ? 'disabled' : ''}><span class="sub">Required for Schedule selected. Choose 10 minutes to six months ahead. Clock-change times that are skipped or occur twice are refused.</span></label>
      <div class="row"><button class="btn" data-z-action="save" ${remote || pending ? 'disabled' : ''}>Save text</button><button class="btn primary" data-z-action="now" ${blocked || !m.selected.length ? 'disabled' : ''}>Publish selected</button><button class="btn" data-z-action="schedule" ${blocked || !m.selected.length ? 'disabled' : ''}>Schedule selected</button></div><p class="sub" id="z-selection">${m.selected.length ? m.selected.map(p => names[p]).join(', ') : 'No destinations selected.'}</p>
      <p class="sub">${it.zernio?.busy || pending ? 'Submission in progress. Results appear below.' : 'Saving text and checking status send no media. Publish selected and Schedule selected start a real upload.'}</p></div>` : '<p class="sub">Loading platform text…</p>'}${history(it, remote)}</section>`;
  }
  function onInput(e) {
    if (!cur || tab !== 'publish') return;
    const m = drafts.get(cur.id); if (!m) return;
    const d = e.target.dataset;
    if (d.zField) { m.fields[d.zPlatform][d.zField] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; const p = document.getElementById('z-preview-' + d.zPlatform); if (p) p.textContent = caption(m.fields[d.zPlatform]); }
    if (e.target.id === 'z-when') m.when = e.target.value;
    if (d.zSelect) { m.selected = [...document.querySelectorAll('[data-z-select]:checked:not(:disabled)')].map(x => x.dataset.zSelect); document.querySelectorAll('[data-z-action="now"],[data-z-action="schedule"]').forEach(b => b.disabled = !m.selected.length); document.getElementById('z-selection').textContent = m.selected.length ? m.selected.map(p => names[p]).join(', ') : 'No destinations selected.'; }
  }
  document.addEventListener('input', onInput);
  document.addEventListener('change', onInput);
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-z-action],[data-z-retry]'); if (!b || !cur || pending) return;
    const action = b.dataset.zAction; if (action === 'accounts') { accounts(true); return; }
    const id = cur.id, m = drafts.get(id); if (!m) return;
    if (S.remote) return;
    const a = { id, type: action === 'save' ? 'zernio-draft' : action === 'check' ? 'zernio-check' : b.dataset.zRetry ? 'zernio-retry' : 'zernio-send' };
    if (a.type === 'zernio-send') { if (!m.selected.length) return; if (action === 'schedule' && !m.when) { document.getElementById('z-when').focus(); toast('Choose a posting time in Europe/London'); return; } Object.assign(a, { fields: m.fields, destinations: m.selected, accounts: Object.fromEntries(m.selected.map(p => [p, { accountId: connected.destinations[p].accountId, login: connected.destinations[p].login }])), mode: action, when: m.when, sha: m.sha }); }
    if (a.type === 'zernio-draft') a.fields = m.fields;
    if (a.type === 'zernio-retry') Object.assign(a, { submission: b.dataset.zRetry, sha: m.sha });
    pending = true; render();
    try {
      const r = await fetch('/api/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Could not complete this action');
      if (a.type === 'zernio-send') m.selected = [];
      toast(j.message); await load(true);
    } catch (err) { toast(err.message); }
    finally { pending = false; if (cur?.id === id) render(); }
  });
  // Remote refresh is GET-only at Zernio. No recovery/resubmission runs from this timer.
  setInterval(async () => {
    if (document.hidden || !cur || tab !== 'publish' || S.remote || pending || cur.zernio?.busy || !cur.zernio?.posts.some(p => !['published', 'cancelled'].includes(p.state))) return;
    try { await fetch('/api/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: cur.id, type: 'zernio-check' }) }); if (!document.querySelector('#z-publisher input:focus,#z-publisher textarea:focus,#z-publisher select:focus') && ![...document.querySelectorAll('video,audio')].some(v => !v.paused)) await load(true); } catch { /* the next refresh or Check status can recover */ }
  }, 30000);
  return { render: renderComposer };
})();
