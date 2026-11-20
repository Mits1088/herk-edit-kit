// Research area of the Command Centre. It shows research already saved in reels-data/research/, and lets Mits
// save an idea with his own angle, copy a brief, and export a qualifying short-form post to the script workflow.
// New research runs in Claude Code (the research-signals skill) and arrives through the importer.
// Loaded by index.html, which calls Research.mount(app) when the Research view is chosen.
(() => {
  const e = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tz = () => (typeof S !== 'undefined' && S && S.dueTimeZone) || undefined;
  const day = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz() });
  const when = d => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz() });
  const ago = n => (n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n.toLocaleString('en-GB')} days ago`);
  const n = v => Number(v).toLocaleString('en-GB', { maximumFractionDigits: 2 });
  const dur = s => (s == null ? 'Duration unknown' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
  const PLATFORM = { instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' };
  const FORMAT = { short: 'Short-form', long: 'Long-form', unknown: 'Format unknown' };
  const SOURCE = { 'signal-room': 'Signal Room', last30free: 'last30free' };
  const SOURCE_KIND = { 'signal-room': 'tracked creators', last30free: 'discovery' };
  const FIELD = { transcript: 'transcript', excerpt: 'search excerpt', title: 'title', caption: 'caption' };
  const EVIDENCE = { transcript: 'Full transcript', manual: 'Transcript pasted by you', excerpt: 'Search excerpt only', caption: 'Caption only', none: 'Title only' };
  const WINDOW = { 7: 'last 7 days', 30: 'last 30 days', 90: 'last 90 days', 365: 'last 12 months', all: 'any date' };
  const DEFAULTS = { search: '', q: '', platform: '', format: 'short', window: '30', sort: 'speed', hideUsed: '', limit: '50' };
  // An idea's stage: label and icon. Worked out on the server (lib/ideas.mjs ideaStage).
  const STAGE = { todo: ['Saved idea', 'bookmark'], production: ['In production', 'progress'], used: ['Used', 'check'], dropped: ['Dropped', 'dropped'] };
  // The badge stays short so a row keeps its height; the reel's name is in the tooltip and on the Ideas tab.
  const stageBadge = s => { if (!s) return ''; const reel = s.reel && s.key !== 'todo' ? (typeof s.reel === 'string' ? s.reel : s.reel.title) : '';
    return `<span class="r-status r-st-${s.key}"${reel ? ` title="Reel: ${e(reel)}"` : ''}>${UiIcon(STAGE[s.key][1])}${STAGE[s.key][0]}</span>`; };

  let remote = false, root = null, tab = 'signals', F = { ...DEFAULTS }, data = null, searches = null, ideas = null, detail = null, detailId = null, error = null, returnTo = null, returnY = 0, removeAsk = false, busy = false, trEdit = false;
  const get = async url => { const r = await fetch(url); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Request failed'); return j; };

  async function loadList() { error = null; try { data = await get('/api/research?' + new URLSearchParams(F)); } catch (x) { error = x.message; } draw(); }
  async function loadIdeas() { error = null; try { const j = await get('/api/research/ideas'); ideas = j.ideas; remote = !!j.remote; } catch (x) { error = x.message; } draw(); }
  const LOAD = { signals: () => loadList(), searches: () => loadSearches(), ideas: () => loadIdeas() };
  // One saved-idea action. A click is ignored while a request is in flight, and every action is repeat-safe on the server.
  async function act(body, focusSel) {
    if (busy) return; busy = true;
    try { const r = await fetch('/api/research/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); toast(r.ok ? j.message : j.error || 'That did not work'); }
    catch (x) { toast('That did not work: ' + x.message); }
    busy = false; removeAsk = false; trEdit = false; data = null; ideas = null;
    if (detailId) { try { detail = await get('/api/research/post?' + new URLSearchParams({ id: detailId, q: F.q || F.search })); } catch (x) { error = x.message; } draw(); const f = focusSel && root.querySelector(focusSel); if (f) f.focus(); }
    else if (tab === 'ideas') await loadIdeas();
  }
  async function loadSearches() { error = null; try { searches = (await get('/api/research/searches')).searches; } catch (x) { error = x.message; } draw(); }
  async function openPost(id) {
    returnTo = id; returnY = window.scrollY; detailId = id; detail = null; removeAsk = false; trEdit = false; draw(); window.scrollTo(0, 0);
    try { detail = await get('/api/research/post?' + new URLSearchParams({ id, q: F.q || F.search })); } catch (x) { error = x.message; detailId = null; }
    draw(); const h = root && root.querySelector('#r-title'); if (h) h.focus();
  }

  // ---- pieces ----
  const tags = r => `<span class="r-tags">${r.providers.map(p => `<span class="r-tag" title="${e(SOURCE_KIND[p])}">${e(SOURCE[p] || p)} · ${e(SOURCE_KIND[p] || '')}</span>`).join('')}</span>`;
  const fresh = m => m.measuredAt ? `<span class="${m.stale ? 'r-warn' : ''}">Measured ${ago(m.ageDays)}${m.stale ? ' (stale)' : ''}</span>` : '<span class="r-warn">Measurement time unknown</span>';
  function engagementCell(r) {
    const g = r.engagement; if (!g) return '<span class="sub">No count recorded</span>';
    return `${n(g.value)} ${e(g.metric)}<span class="sub">${fresh(g)} · ${e(SOURCE[g.provider])}</span>`;
  }
  function outlierCell(r) {
    const o = r.outlier; if (!o) return '<span class="sub">None recorded</span>';
    if (!o.rankable) return `<span class="sub">Not ranked</span><span class="sub">${e(o.label)} is unstable</span>`;
    return `${n(o.value)}<span class="sub">${e(o.label)}</span>`;
  }
  const growthCell = r => r.growth ? `${r.growth.delta >= 0 ? '+' : ''}${n(r.growth.delta)} ${e(r.growth.metric)}<span class="sub">over ${n(r.growth.days)} days · ${e(SOURCE[r.growth.provider])}</span>` : '<span class="sub">Growth unavailable</span>';
  function evidenceCell(r) {
    const m = r.match; let line = '';
    if (m) line = m.matched ? `“${e(m.query)}” found in ${m.fields.map(f => FIELD[f]).join(', ')}` : `“${e(m.query)}” not found in the saved text`;
    return `${EVIDENCE[r.evidence]}${line ? `<span class="sub">${line}</span>` : ''}`;
  }
  const publishedCell = r => r.publishedAt ? `${day(r.publishedAt)}<span class="sub">${ago(r.publishedAgeDays)}</span>` : '<span class="r-warn">Date unknown</span>';
  const pct = v => (v == null ? null : `${(v * 100).toLocaleString('en-GB', { maximumFractionDigits: v < 0.001 ? 3 : 1 })}%`);
  const big = v => (v == null ? null : v >= 1e6 ? `${(v / 1e6).toLocaleString('en-GB', { maximumFractionDigits: 1 })}M` : v >= 1e4 ? `${Math.round(v / 1e3).toLocaleString('en-GB')}K` : Math.round(v).toLocaleString('en-GB'));
  const cell = (v, label) => `<td class="num" data-label="${label}">${v == null ? '<span class="sub" title="Not given by the source">–</span>' : v}</td>`;
  function checkedCell(m) {
    if (!m) return '<td data-label="Last checked"><span class="sub">Not measured</span></td>';
    if (!m.measuredAt) return `<td data-label="Last checked"><span class="r-warn">Time unknown</span><span class="sub">retrieved ${day(m.retrievedAt)}</span></td>`;
    const age = Math.max(0, Math.round((Date.now() - Date.parse(m.measuredAt)) / 864e5));
    return `<td class="nowrap" data-label="Last checked"><span class="${age > data.staleDays ? 'r-warn' : ''}">${ago(age)}</span><span class="sub">${e(SOURCE[m.provider])}${m.measuredBasis === 'file-mtime' ? ' · file time' : ''}</span></td>`;
  }
  const growthMini = r => r.growth ? `${r.growth.delta >= 0 ? '+' : ''}${big(r.growth.delta)}<span class="sub">${day(r.growth.from.at)} → ${day(r.growth.to.at)}</span>` : null;
  function table(rows, caption) {
    return `<div class="r-frame"><table class="r-table r-list r-metrics"><caption class="sub" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">${e(caption)}</caption>
    <thead><tr><th scope="col">Post</th><th scope="col">Published</th><th scope="col" class="num">Views</th><th scope="col" class="num" title="Views divided by the post's age when it was measured">Avg views/day</th><th scope="col" class="num">Likes</th><th scope="col" class="num">Comments</th><th scope="col" class="num">Shares</th><th scope="col" class="num" title="(likes + comments) ÷ views">Engagement</th><th scope="col" class="num" title="shares ÷ views">Share rate</th><th scope="col" class="num" title="last30free's original score; compare within one platform">Score</th><th scope="col" class="num" title="Since the previous measurement by the same source">Growth</th><th scope="col">Last checked</th></tr></thead><tbody>
    ${rows.map(r => { const m = r.metrics || {}, st = (data.ideaStage || {})[r.id]; return `<tr${st ? ` class="r-row-${st.key}"` : ''}><td class="post" data-label="Post">${stageBadge(st)}<button class="r-open" data-r-open="${e(r.id)}">${e(r.title || 'Untitled post')}</button>
      <span class="sub">${BrandIcon(r.platform)}${e(PLATFORM[r.platform])} · ${e(r.creator.handle ? '@' + String(r.creator.handle).replace(/^@/, '') : r.creator.name || 'Creator unknown')} · ${dur(r.durationSeconds)}</span>${tags(r)}${r.match && !r.match.matched ? `<span class="sub">“${e(r.match.query)}” not found in the saved text</span>` : ''}</td>
      <td class="nowrap" data-label="Published">${publishedCell(r)}</td>
      ${cell(big(m.views), 'Views')}${cell(big(m.avgViewsPerDay), 'Avg views/day')}${cell(big(m.likes), 'Likes')}${cell(big(m.comments), 'Comments')}${cell(big(m.shares), 'Shares')}
      ${cell(pct(m.engagementRate), 'Engagement')}${cell(pct(m.shareRate), 'Share rate')}${cell(r.score ? `${n(r.score.value)}<span class="sub">${e(PLATFORM[r.score.platform])}${r.score.measuredAt && r.score.measuredAt !== (r.metrics || {}).measuredAt ? ` · from ${day(r.score.measuredAt)}` : ''}</span>` : null, 'Score')}
      ${cell(growthMini(r), 'Growth')}${checkedCell(r.metrics)}</tr>`; }).join('')}
    </tbody></table></div>`;
  }

  // ---- Signals ----
  const SORT = { speed: 'Avg views/day', views: 'Views', published: 'Newest published', engagement: 'Engagement rate', shares: 'Share rate', growth: 'Growth', score: 'Score (one platform)', outlier: 'Creator outlier' };
  function vSignals() {
    if (!data) return '<p class="sub">Loading saved research…</p>';
    const t = data.totals, f = data.filters, win = WINDOW[f.window];
    if (!t.posts && !t.searches) return `${note()}<div class="panel"><h3>No research is saved yet</h3><p>Run a search in Claude Code. Its results appear here once the importer has stored them.</p></div>`;
    const opt = (v, l, cur) => `<option value="${e(v)}" ${v === cur ? 'selected' : ''}>${e(l)}</option>`;
    const tabs = `<span class="seg r-seg" role="group" aria-label="Format">${[['short', 'Short-form'], ['long', 'Long-form'], ['unknown', 'Format unknown']].filter(([k]) => k !== 'unknown' || data.formats.unknown || f.format === 'unknown')
      .map(([k, l]) => `<button data-r-format="${k}" aria-current="${f.format === k}">${l} <span class="count">${data.formats[k] || 0}</span></button>`).join('')}</span>`;
    const filters = `<form class="r-filters" id="r-form" aria-label="Filter saved research"><input type="hidden" name="format" value="${e(f.format)}">
      <div class="r-field"><label for="r-search">Topic (saved search)</label><select id="r-search" name="search">${opt('', 'All topics', f.search)}${data.queries.map(q => opt(q, q, f.search)).join('')}</select></div>
      <div class="r-field"><label for="r-platform">Platform</label><select id="r-platform" name="platform">${opt('', 'All platforms', f.platform)}${Object.entries(PLATFORM).map(([k, l]) => opt(k, l, f.platform)).join('')}</select></div>
      <div class="r-field"><label for="r-window">Published</label><select id="r-window" name="window">${Object.entries(WINDOW).map(([k, l]) => opt(k, l[0].toUpperCase() + l.slice(1), f.window)).join('')}</select></div>
      <div class="r-field"><label for="r-sort">Sort by</label><select id="r-sort" name="sort">${Object.entries(SORT).map(([k, l]) => opt(k, l, f.sort)).join('')}</select></div>
      <div class="r-field wide full"><label for="r-q">Words in the saved text</label><input id="r-q" name="q" type="search" value="${e(f.q)}" placeholder='n8n, or "claude code" for an exact phrase' autocomplete="off"></div>
      <div class="r-actions"><button class="btn primary" type="submit">Filter saved research</button><button class="btn" type="button" data-r-reset="1">Reset filters</button>
      <a class="btn" href="/api/research/export.csv?${e(new URLSearchParams({ ...f, limit: '' }).toString())}" download>Export CSV</a>
      <label class="r-check" for="r-hideused"><input type="checkbox" id="r-hideused" name="hideUsed" value="1" ${f.hideUsed ? 'checked' : ''}>Hide used and dropped ideas</label>
      <span class="sub">${data.scoreNeedsPlatform ? '<span class="r-warn">Scores are only comparable within one platform: choose a platform to sort by score. Sorted by average views per day instead.</span>' : f.sort === 'outlier' ? 'Creator outlier compares a post with its own creator. Posts with only an unstable signal, or none, sort last.' : 'Every number in a row comes from one measurement. A dash means the source did not give it.'}</span></div></form>`;
    // One quiet line per search, so a gap is not read as "nothing found". The exact errors live on the Searches tab.
    const byQuery = new Map(); for (const x of data.failures) { if (!byQuery.has(x.query)) byQuery.set(x.query, { at: x.retrievedAt, lanes: [] }); byQuery.get(x.query).lanes.push(x.laneLabel); }
    const fails = [...byQuery].map(([q, v]) => `<p class="r-gap" role="status">Latest “${e(q)}” search (${when(v.at)}): ${e(v.lanes.join(', '))} did not run, so ${v.lanes.length === 1 ? 'that source has' : 'those sources have'} no new results. <button class="r-link" data-r-tab="searches">See why</button></p>`).join('')
      + data.partials.map(x => `<p class="r-gap" role="status">Latest “${e(x.query)}” search: ${e(x.laneLabel)} returned partial results (its paid run stopped early); what it returned is included. <button class="r-link" data-r-tab="searches">See why</button></p>`).join('');
    const hidden = [t.historical ? `${t.historical} published before the ${win}` : '', t.undated && f.window !== 'all' ? `${t.undated} with no publication date` : ''].filter(Boolean);
    const summary = `<p class="r-summary" role="status"><strong>${t.recent}</strong> ${FORMAT[f.format].toLowerCase()} ${t.recent === 1 ? 'post' : 'posts'} ${f.window === 'all' ? 'with a publication date' : `published in the ${win}`}, sorted by ${e(SORT[data.sortedBy].toLowerCase())}${data.rows.length < t.recent ? `, top ${data.rows.length} shown` : ''}.${hidden.length ? ` Not listed: ${hidden.join(' and ')}${f.window !== 'all' ? ` <button class="r-link" data-r-window="all">Show any date</button>` : ''}.` : ''} Saved posts stay stored when they leave this view.${data.hiddenUsed ? ` ${data.hiddenUsed} used or dropped ${data.hiddenUsed === 1 ? 'idea is' : 'ideas are'} hidden. <button class="r-link" data-r-showused="1">Show them</button>` : ''}</p>`;
    const list = data.rows.length ? table(data.rows, `${FORMAT[f.format]}, ${win}`) : `<div class="panel"><p>No saved ${FORMAT[f.format].toLowerCase()} post matches these filters${f.window === 'all' ? '' : ` in the ${win}`}.</p></div>`;
    const more = (data.more ? `<div class="row"><button class="btn" data-r-more="1">Show ${Math.min(data.pageSize, data.more)} more</button><span class="sub">${data.more} more match these filters.</span></div>` : '')
      + (!data.more && data.capped ? `<p class="sub">${data.capped.toLocaleString('en-GB')} more match these filters than one page can list. Narrow the filters, or export the full table as CSV.</p>` : '');
    const und = data.undatedRows.length ? `<details class="r-hist"><summary>${data.undatedRows.length} with no publication date</summary><p class="sub">The source gave no date, so these are never counted as recent.</p>${table(data.undatedRows, 'Publication date unknown')}</details>` : '';
    return `${note()}<div class="r-head">${tabs}</div>${filters}${fails}${summary}${list}${more}${und}`;
  }
  const note = () => `<div class="r-note"><span>These filters search research already saved on this PC. They do not run a new search.</span><span>New research runs in Claude Code:</span><code>/research-signals &lt;topic&gt;</code><button class="btn small" data-r-copy="/research-signals ">Copy command</button></div>`;

  // ---- Ideas ----
  const PF = p => `${PLATFORM[p.platform]} · ${FORMAT[p.format]}`;
  function ideaState(x) {
    if (x.exported) return ['ok', 'Exported to the script workflow', x.exported.pipelineStatus ? `In Pipeline: ${x.exported.pipelineStatus}` : `${x.exported.file} · ${when(x.exported.at)}`];
    if (x.handoff.ok) return ['you', 'Ready to export', 'Short-form with a full transcript, a source link and a duration.'];
    return ['wait', 'Brief only', x.handoff.reasons.join(' ')];
  }
  function vIdeas() {
    if (!ideas) return '<p class="sub">Loading saved ideas…</p>';
    if (!ideas.length) return '<div class="panel"><h3>No idea is saved yet</h3><p>Open a post in Signals and choose Save idea. A post can be saved with or without a transcript.</p></div>';
    const cardOf = (x, i) => {
      if (x.missing) return `<section class="panel"><h3>Source post not found</h3><p class="sub">The post <span class="mono">${e(x.idea.postId)}</span> is no longer in the research store. Your angle is kept.</p><div class="r-angle">${e(x.idea.angle || 'No angle written.')}</div></section>`;
      const [cls, label, why] = ideaState(x), s = x.stage || { key: 'todo' };
      return `<section class="panel" aria-label="Idea: ${e(x.post.title || 'Untitled post')}"><div class="r-head"><div><button class="r-open" data-r-open="${e(x.post.id)}">${e(x.post.title || 'Untitled post')}</button><span class="r-tags"><span class="r-tag">${e(PF(x.post))}</span><span class="r-tag">${EVIDENCE[x.post.evidence]}</span></span></div>${s.key === 'todo' ? `<span class="pill ${cls}">${label}</span>` : stageBadge(s)}</div>
        <div><p class="r-kind">Your angle</p>${x.idea.angle ? `<div class="r-angle">${e(x.idea.angle)}</div>` : '<p class="sub">No angle written yet.</p>'}</div>
        <p class="sub">${s.key === 'used' ? (s.manual ? `Marked as used ${when(s.at)}.` : `${s.reel ? `“${e(s.reel.title)}” went` : 'Its reel went'} on Instagram${s.at ? ' ' + when(s.at) : ''}.`) : s.key === 'dropped' ? `Dropped ${when(s.at)}.` : e(why)}</p>
        <div class="row"><button class="btn small" data-r-open="${e(x.post.id)}" aria-label="Open idea and evidence: ${e(x.post.title || 'Untitled post')}">Open idea and evidence</button><button class="btn small" data-r-briefof="${i}">Copy brief</button>${x.exported && x.exported.pipelineId ? `<button class="btn small" data-r-pipeline="${e(x.exported.pipelineId)}" aria-label="Open in Pipeline: ${e(x.post.title || 'Untitled post')}">Open in Pipeline</button>` : ''}${closeButtons(x)}</div></section>`;
    };
    const groups = { todo: [], production: [], used: [], dropped: [] };
    ideas.forEach((x, i) => groups[x.missing ? 'todo' : (x.stage || { key: 'todo' }).key].push(cardOf(x, i)));
    const HELP = { todo: 'Saved, not made yet.', production: 'Exported to the script workflow, so the reel is in your Pipeline.', used: 'Its reel is on Instagram, or you marked it used. Kept as a record of what inspired what.', dropped: 'Ideas you decided not to make. Reopen one to bring it back.' };
    const head = k => `<h3 class="r-group-head">${UiIcon(STAGE[k][1])}${k === 'todo' ? 'To do' : STAGE[k][0]} <span class="count">${groups[k].length}</span></h3>`;
    const open = k => `<section class="r-stage r-stage-${k}" aria-label="${k === 'todo' ? 'To do' : STAGE[k][0]}">${head(k)}<p class="sub">${HELP[k]}</p>${groups[k].length ? `<div class="r-ideas">${groups[k].join('')}</div>` : '<p class="sub">None right now.</p>'}</section>`;
    const folded = k => groups[k].length ? `<details class="r-stage r-stage-${k}"><summary>${head(k)}<span class="sub">${HELP[k]}</span></summary><div class="r-ideas">${groups[k].join('')}</div></details>` : '';
    return `<p class="sub">An idea moves on by itself: exporting it puts it In production, and it counts as Used once its reel is on Instagram. Research imports never change an idea.</p>${open('todo')}${open('production')}${folded('used')}${folded('dropped')}`;
  }
  // Close or reopen an idea by hand (made elsewhere, or not making it). Not on the phone.
  function closeButtons(x) {
    if (remote || x.missing) return ''; const s = x.stage || { key: 'todo' };
    if (s.manual) return `<button class="btn small" data-r-close="" data-r-ideaid="${e(x.idea.id)}">Reopen</button>`;
    if (s.key === 'used') return '';
    return `<button class="btn small" data-r-close="used" data-r-ideaid="${e(x.idea.id)}">Mark as used</button><button class="btn small" data-r-close="dropped" data-r-ideaid="${e(x.idea.id)}">Drop idea</button>`;
  }

  // Mits's own direction for one post: kept visibly apart from the source evidence further down the page.
  function ideaPanel(d) {
    const i = d.idea, x = d.exported, h = d.handoff;
    const intro = '<p class="sub">Your own direction. It is kept apart from the source evidence below, and research imports never change it.</p>';
    if (d.remote) return `<section class="panel r-idea" aria-label="Your idea"><h3>Your idea</h3><p class="sub">${i ? 'Saved.' : 'Not saved.'} Ideas are saved, edited and exported on the PC.</p>${i && i.angle ? `<div class="r-angle">${e(i.angle)}</div>` : ''}</section>`;
    const field = `<div class="r-field r-angle-field"><label for="r-angle">Your angle or note${i ? '' : ' (optional)'}</label><textarea id="r-angle" rows="3" maxlength="2000" placeholder="For example: show the build live instead of describing it">${e(i ? i.angle : '')}</textarea></div>`;
    if (!i) return `<section class="panel r-idea" aria-label="Your idea"><h3>Your idea</h3>${intro}${field}<div class="row"><button class="btn primary" data-r-save="1">Save idea</button><span class="sub">Works with or without a transcript.</span></div></section>`;
    let hand;
    if (x) hand = `<p>Exported ${when(x.at)} as <span class="mono">${e(x.file)}</span>. ${x.waiting ? 'The file is waiting in Instagram_transcript.' : 'The file is no longer in the drop folder: the script workflow has taken it, or it was moved.'}</p>
      ${x.angleChanged ? '<p class="r-warn">You changed your angle after exporting. The exported file still carries the earlier one.</p>' : ''}
      <div class="row"><span class="sub">Start the scripts in Claude Code:</span><code class="mono">${e(x.command)}</code><button class="btn small" data-r-copy="${e(x.command)}" data-r-toast="Copied. Paste it into Claude Code.">Copy command</button></div>
      ${x.pipelineId ? `<div class="row">${x.pipelineStatus ? `<span>In Pipeline: <strong>${e(x.pipelineStatus)}</strong></span>` : ''}<button class="btn small" data-r-pipeline="${e(x.pipelineId)}">Open “${e(x.pipelineTitle)}” in Pipeline</button></div>` : '<p class="sub">No Pipeline item is linked to this file yet.</p>'}`;
    else if (h.ok) hand = `<div class="row"><button class="btn primary" data-r-export="1">Export to the script workflow</button><span class="sub">Writes one transcript file into Instagram_transcript, with your angle on its own “Note from Mits” line. Nothing else changes, and an existing file is never replaced.</span></div>`;
    else hand = `<p>Not available for this post:</p><ul class="r-reasons">${h.reasons.map(r => `<li>${e(r)}</li>`).join('')}</ul>`;
    return `<section class="panel r-idea" aria-label="Your idea"><div class="r-head"><h3>Your idea</h3>${stageBadge(d.stage)}</div>${intro}${field}
      <p class="sub">Saved ${when(i.createdAt)}${i.updatedAt !== i.createdAt ? ' · last changed ' + when(i.updatedAt) : ''}</p>
      <div class="row"><button class="btn" data-r-angle="1">Save angle</button><button class="btn" data-r-copybrief="1">Copy brief</button>
      ${closeButtons({ idea: i, stage: d.stage })}${x ? '' : removeAsk ? '<span class="sub">Remove this idea and its angle?</span><button class="btn small" data-r-removeyes="1">Yes, remove the idea</button><button class="btn small" data-r-removeno="1">Keep it</button>' : '<button class="btn small" data-r-remove="1">Remove idea</button>'}</div>
      <div class="r-hand"><h4>Short-form handoff</h4>${hand}</div></section>`;
  }

  // ---- Searches ----
  function vSearches() {
    if (!searches) return '<p class="sub">Loading search history…</p>';
    if (!searches.length) return '<div class="panel"><p>No search has been imported yet.</p></div>';
    return `<p class="sub">Every imported search, newest first. Each run lists the top matches its source returned, or its failure.</p>` + searches.map(s => `<section class="panel" aria-label="Search ${e(s.query)}">
      <div class="r-head"><h3>“${e(s.query)}”</h3><button class="btn small" data-r-show="${e(s.query)}">Show results for “${e(s.query)}”</button></div>
      <dl class="kv"><dt>Retrieved</dt><dd>${when(s.retrievedAt)}</dd><dt>Imported</dt><dd>${s.importedAt ? when(s.importedAt) : 'Not recorded'}</dd><dt>Window asked for</dt><dd>${s.windowDays ? 'last ' + s.windowDays + ' days (the page filters by date itself)' : 'Not recorded'}</dd><dt>Posts stored</dt><dd>${s.posts}</dd><dt>Batch</dt><dd class="mono">${e(s.batchId)}</dd></dl>
      <div class="r-frame"><table class="r-table"><thead><tr><th scope="col">Run</th><th scope="col">Source</th><th scope="col">Result</th><th scope="col">Notes from the run</th></tr></thead><tbody>
      ${s.runs.map(r => `<tr><td data-label="Run">${e(r.laneLabel)}</td><td data-label="Source">${e(SOURCE[r.provider])}<span class="sub">${e(SOURCE_KIND[r.provider])}</span></td>
        <td data-label="Result">${r.status === 'ok' ? `<span class="pill ${r.partial ? 'wait' : 'ok'}">${r.partial ? 'Partial: ' : ''}${r.results} top ${r.results === 1 ? 'match' : 'matches'}</span>${r.kept ? `<span class="sub">+ ${r.kept} more fetched and kept</span>` : ''}${r.partial ? `<span class="sub">${e(r.partial)}</span>` : ''}` : `<span class="pill bad">Failed</span><span class="sub">${e(r.error)}</span>`}
          ${r.cost ? `<span class="sub">${r.cost.charged_usd != null ? `Apify charge $${Number(r.cost.charged_usd).toFixed(3)}` : 'Apify charge unknown'}${r.cost.status ? ` · run ${e(r.cost.status)}` : ''}${r.cost.stop && !r.cost.stop.confirmed ? ' · stop not confirmed' : ''}</span>` : ''}</td>
        <td data-label="Notes from the run">${r.note ? e(r.note) : '<span class="sub">None</span>'}</td></tr>`).join('')}</tbody></table></div></section>`).join('');
  }

  // ---- a transcript pasted by hand (kept on the idea, never in the research store) ----
  function pasteBox(d, text) {
    if (d.remote) return '<p class="sub">You can paste a transcript on the PC.</p>';
    return `<div class="r-field r-angle-field" style="margin-top:8px"><label for="r-trtext">${text ? 'Edit the transcript' : 'Paste the transcript yourself'}</label><textarea id="r-trtext" rows="8" maxlength="60000" placeholder="The spoken words, for example copied from the video's own transcript">${e(text)}</textarea></div>
      <div class="row" style="margin-top:8px"><button class="btn primary" data-r-trsave="1">Save transcript</button>${text ? '<button class="btn small" data-r-trcancel="1">Cancel</button>' : ''}<span class="sub">${d.idea ? 'Saved with your idea' : 'Saving it also saves this post as an idea'}, marked as pasted by you. Research imports never change it.</span></div>`;
  }
  function manualTranscript(d) {
    const locked = d.exported;
    if (trEdit && !locked) return pasteBox(d, d.transcriptText);
    return `<p class="sub">${n(d.transcript.words)} words, pasted by you ${when(d.transcript.capturedAt)}. No transcript was fetched for this post.</p>
      <div class="row" style="margin:8px 0"><button class="btn small" data-r-copytranscript="1">Copy transcript</button>${d.remote || locked ? '' : '<button class="btn small" data-r-tredit="1">Edit transcript</button><button class="btn small" data-r-trremove="1">Remove transcript</button>'}${locked ? '<span class="sub">Kept as exported.</span>' : ''}</div><div class="r-text" id="r-transcript">${e(d.transcriptText)}</div>`;
  }

  // ---- one post ----
  const segs = a => a.map(x => (x.m ? `<mark>${e(x.t)}</mark>` : e(x.t))).join('');
  function vPost() {
    const back = `<div><button class="back" data-r-back="1">Back to ${tab === 'ideas' ? 'Ideas' : tab === 'searches' ? 'Searches' : 'Signals'}</button></div>`;
    if (!detail) return `${back}<p class="sub">Loading the saved post…</p>`;
    const d = detail, q = d.query;
    const facts = `<section class="panel" aria-label="Post"><dl class="kv">
      <dt>Platform</dt><dd>${BrandIcon(d.platform)}${PLATFORM[d.platform]} · ${FORMAT[d.format]}</dd><dt>Creator</dt><dd>${e([d.creator.name, d.creator.handle && '@' + String(d.creator.handle).replace(/^@/, '')].filter(Boolean).join(' · ') || 'Unknown')}</dd>
      <dt>Published</dt><dd>${d.publishedAt ? `${when(d.publishedAt)} · ${ago(d.publishedAgeDays)}` : '<span class="r-warn">Unknown: the source gave no date</span>'}</dd><dt>Duration</dt><dd>${dur(d.durationSeconds)}</dd>
      <dt>First imported</dt><dd>${when(d.firstRetrievedAt)}</dd><dt>Last seen in a search</dt><dd>${when(d.lastRetrievedAt)}</dd><dt>Source link</dt><dd><a href="${e(d.url)}" target="_blank" rel="noopener noreferrer">${e(d.url)}</a></dd></dl></section>`;
    const found = `<section class="panel" aria-label="Where it was found"><h3>Where it was found</h3>${d.runs.length ? `<div class="r-frame"><table class="r-table"><thead><tr><th scope="col">Search</th><th scope="col">Run</th><th scope="col">Source</th><th scope="col">Position</th><th scope="col">Retrieved</th></tr></thead><tbody>
      ${d.runs.map(r => `<tr><td data-label="Search">“${e(r.query)}”<span class="sub mono">${e(r.batchId)}</span></td><td data-label="Run">${e(r.laneLabel)}</td><td data-label="Source">${e(SOURCE[r.provider])}<span class="sub">${e(SOURCE_KIND[r.provider])}</span></td><td data-label="Position">${r.kept ? 'Fetched and kept, not in the top matches' : `${r.rank} of ${r.of} top matches`}</td><td data-label="Retrieved">${when(r.retrievedAt)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="sub">No search run on record lists this post.</p>'}</section>`;
    const growthLine = d.growth ? `<p>${d.growth.delta >= 0 ? '+' : ''}${n(d.growth.delta)} ${e(d.growth.metric)} between ${when(d.growth.from.at)} and ${when(d.growth.to.at)}, both measured by ${e(SOURCE[d.growth.provider])}.</p>` : '<p><strong>Growth unavailable.</strong> <span class="sub">It needs two dated measurements of the same count from the same source.</span></p>';
    const meas = `<section class="panel" aria-label="Measurements"><h3>Measurements</h3><p class="sub">Raw counts and creator-relative signals are separate. A measurement time comes from the source; the retrieval time is when this PC fetched it.</p>
      ${d.observations.length ? `<div class="r-frame"><table class="r-table"><thead><tr><th scope="col">Source</th><th scope="col">Measured</th><th scope="col">Retrieved</th><th scope="col">Raw counts</th><th scope="col">Creator outlier</th><th scope="col">Discovery score</th></tr></thead><tbody>
      ${d.observations.map(o => `<tr><td data-label="Source">${e(SOURCE[o.provider])}</td><td data-label="Measured">${o.measuredAt ? `${when(o.measuredAt)}<span class="sub ${o.stale ? 'r-warn' : ''}">${ago(o.ageDays)}${o.stale ? ' (stale)' : ''}</span>` : '<span class="r-warn">Unknown</span>'}</td>
        <td data-label="Retrieved">${when(o.lastRetrievedAt)}${o.firstRetrievedAt !== o.lastRetrievedAt ? `<span class="sub">first ${when(o.firstRetrievedAt)}</span>` : ''}</td>
        <td data-label="Raw counts">${Object.entries(o.metrics).map(([k, v]) => `${n(v)} ${e(k)}`).join('<br>') || '<span class="sub">None</span>'}</td>
        <td data-label="Creator outlier">${o.outlier ? `${n(o.outlier.value)}<span class="sub">${e(o.outlier.label)}${o.outlier.rankable ? '' : '. Unstable: not used for ranking or growth'}</span>` : '<span class="sub">None</span>'}</td>
        <td data-label="Discovery score">${o.discoveryScore != null ? `${n(o.discoveryScore)}<span class="sub">last30free engagement score at fetch</span>` : '<span class="sub">None</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="sub">No measurement was recorded for this post.</p>'}
      ${growthLine}</section>`;
    const m = d.match;
    const matched = q ? `<p>${m && m.matched ? `“${e(q)}” was found in: ${Object.keys(m.fields).map(f => FIELD[f]).join(', ')}.` : `<span class="r-warn">“${e(q)}” was not found in any text saved for this post.</span> The source matched it in text that was not fetched.`}</p>` : '';
    const text = `<section class="panel" aria-label="Evidence"><h3>Evidence saved</h3>${matched}
      ${d.transcriptPassage ? `<div><p class="r-kind">Matching passage, cut from the full transcript below</p><div class="r-text">${d.transcriptPassage.cutStart ? '…' : ''}${segs(d.transcriptPassage.segments)}${d.transcriptPassage.cutEnd ? '…' : ''}</div></div>` : ''}
      ${d.excerpts.map(x => `<div><p class="r-kind">Search excerpt (${x.kind === 'hook' ? 'opening lines' : 'passage around the match'}) from ${e(SOURCE[x.provider])}, batch ${e(x.batchId)}. ${x.complete === false ? 'Word for word, but only part of what the search returned was copied.' : 'Word for word as the search returned it.'} Not the full transcript.</p><div class="r-text">${segs(x.segments)}</div></div>`).join('')}
      ${d.excerpts.length ? '' : '<p class="sub">No search excerpt was saved for this post.</p>'}
      <div><p class="r-kind">Caption or description (written by the creator, not spoken)</p>${d.caption ? `<div class="r-text">${d.captionSegments ? segs(d.captionSegments) : e(d.caption)}</div>` : '<p class="sub">No caption was saved.</p>'}</div>
      <div><p class="r-kind">Full transcript (spoken words)${d.manualTranscript ? ', pasted by you' : ''}</p>${d.manualTranscript ? manualTranscript(d) : d.transcriptText ? `<p class="sub">${n(d.transcript.words)} words, ${d.transcript.origin === 'subtitles' ? 'YouTube subtitles fetched through' : d.transcript.origin === 'whisper' ? 'speech-to-text through' : 'transcript held by'} ${e(SOURCE[d.transcript.provider])}${d.transcript.capturedAt ? ', captured ' + when(d.transcript.capturedAt) : ', capture time unknown'}.</p>
        <div class="row" style="margin:8px 0"><button class="btn small" data-r-copytranscript="1">Copy transcript</button></div><div class="r-text" id="r-transcript">${e(d.transcriptText)}</div>` : `<p><strong>No transcript was fetched for this post.</strong> <span class="sub">Excerpts and captions above are not a transcript.</span></p>${pasteBox(d, '')}`}</div></section>`;
    const inputs = `<section class="panel" aria-label="Builder inputs"><h3>Original records</h3><p class="sub">What the batch was built from, kept so a copied number can be checked against its source.</p>
      ${d.builderInputs.map(b => `<div><p><span class="mono">${e(b.batchId)}</span> · ${e(SOURCE[b.provider])} · ${b.kept ? `kept in <span class="mono">${e(b.folder)}</span>` : '<span class="r-warn">not kept for this batch</span>'}</p>
        ${b.records.length ? b.records.map(r => `<details><summary class="sub">${e(r.what)}</summary><pre class="r-json">${e(JSON.stringify(r.data, null, 2))}</pre></details>`).join('') : b.kept ? '<p class="sub">This post was not found in the kept records.</p>' : ''}</div>`).join('') || '<p class="sub">No batch is recorded for this post.</p>'}</section>`;
    return `${back}<div class="r-detail"><div><h2 id="r-title" tabindex="-1">${d.titleSegments ? segs(d.titleSegments) : e(d.title || 'Untitled post')}</h2><span class="r-tags">${d.providers.map(p => `<span class="r-tag">${e(SOURCE[p])} · ${e(SOURCE_KIND[p])}</span>`).join('')}</span></div>${ideaPanel(d)}<h3 class="r-divide">Source evidence</h3>${facts}${found}${meas}${text}${inputs}</div>`;
  }

  function draw() {
    if (!root || !root.isConnected) return;
    const head = `<div class="r-head"><h2>Research</h2><span class="seg r-seg" role="group" aria-label="Research views"><button data-r-tab="signals" aria-current="${tab === 'signals'}">Signals</button><button data-r-tab="ideas" aria-current="${tab === 'ideas'}">Ideas</button><button data-r-tab="searches" aria-current="${tab === 'searches'}">Searches</button></span></div>`;
    const err = error ? `<div class="r-fail" role="alert">Could not read saved research: ${e(error)}</div>` : '';
    root.innerHTML = detailId ? err + vPost() : head + err + (tab === 'signals' ? vSignals() : tab === 'ideas' ? vIdeas() : vSearches());
  }

  function mount(app) {
    app.innerHTML = '<div id="research-root" style="display:grid;gap:16px"></div>'; root = app.firstChild; draw();
    if (detailId) return; LOAD[tab]();
  }
  // A filter change starts again from the top 50.
  function readForm() { const fd = new FormData(root.querySelector('#r-form')); for (const k of Object.keys(DEFAULTS)) F[k] = String(fd.get(k) ?? DEFAULTS[k]); F.limit = DEFAULTS.limit; }

  document.addEventListener('click', ev => {
    if (!root || !root.contains(ev.target)) return; const b = ev.target.closest('button'); if (!b) return; const d = b.dataset;
    if (d.rTab) { tab = d.rTab; draw(); LOAD[tab](); }
    else if (d.rOpen) openPost(d.rOpen);
    else if (d.rBack) { detailId = null; detail = null; draw(); const refocus = () => { const again = returnTo && root.querySelector(`[data-r-open="${CSS.escape(returnTo)}"]`); if (again) { const h = again.closest('details'); if (h) h.open = true; again.focus({ preventScroll: true }); } window.scrollTo(0, returnY); }; if (tab !== 'signals' || !data) LOAD[tab]().then(refocus); else refocus(); }
    else if (d.rReset) { F = { ...DEFAULTS }; loadList(); }
    else if (d.rFormat) { F = { ...F, format: d.rFormat, limit: DEFAULTS.limit }; loadList(); }
    else if (d.rWindow) { F = { ...F, window: d.rWindow, limit: DEFAULTS.limit }; loadList(); }
    else if (d.rMore) { const y = window.scrollY; F = { ...F, limit: String(Number(F.limit) + data.pageSize) }; loadList().then(() => window.scrollTo(0, y)); }
    else if (d.rShow) { F = { ...DEFAULTS, search: d.rShow, window: 'all' }; tab = 'signals'; data = null; draw(); loadList(); }
    else if (d.rSave) act({ type: 'save-idea', postId: detailId, angle: root.querySelector('#r-angle').value }, '#r-angle');
    else if (d.rAngle) act({ type: 'set-angle', ideaId: detail.idea.id, angle: root.querySelector('#r-angle').value }, '[data-r-angle]');
    else if (d.rExport) act({ type: 'export-idea', ideaId: detail.idea.id }, '[data-r-copy]');
    else if (d.rRemove) { removeAsk = true; draw(); root.querySelector('[data-r-removeno]').focus(); }
    else if (d.rRemoveno) { removeAsk = false; draw(); root.querySelector('[data-r-remove]').focus(); }
    else if (d.rClose !== undefined) act({ type: 'close-idea', ideaId: d.rIdeaid, as: d.rClose });
    else if (d.rShowused) { F = { ...F, hideUsed: '', limit: DEFAULTS.limit }; loadList(); }
    else if (d.rRemoveyes) act({ type: 'remove-idea', ideaId: detail.idea.id }, '#r-angle');
    else if (d.rCopybrief) copyText(detail.brief).then(() => toast('Brief copied'), () => toast('Copy was blocked'));
    else if (d.rBriefof !== undefined) copyText(ideas[Number(d.rBriefof)].brief).then(() => toast('Brief copied'), () => toast('Copy was blocked'));
    else if (d.rPipeline) load(true).then(() => open(d.rPipeline));
    else if (d.rCopy !== undefined) copyText(d.rCopy).then(() => toast(d.rToast || 'Copied. Paste it into Claude Code and add your topic.'), () => toast('Copy was blocked; select the text instead'));
    else if (d.rTrsave) act({ type: 'set-transcript', postId: detailId, text: root.querySelector('#r-trtext').value, angle: (root.querySelector('#r-angle') || {}).value || '' }, '#r-transcript');
    else if (d.rTredit) { trEdit = true; draw(); const t = root.querySelector('#r-trtext'); if (t) t.focus(); }
    else if (d.rTrcancel) { trEdit = false; draw(); }
    else if (d.rTrremove) act({ type: 'remove-transcript', ideaId: detail.idea.id }, '#r-trtext');
    else if (d.rCopytranscript) copyText(detail.transcriptText).then(() => toast('Transcript copied'), () => toast('Copy was blocked; select the text instead'));
  });
  document.addEventListener('submit', ev => { if (ev.target.id === 'r-form') { ev.preventDefault(); readForm(); loadList(); } });
  document.addEventListener('change', ev => { if (root && ev.target.closest && ev.target.closest('#r-form') && (ev.target.tagName === 'SELECT' || ev.target.type === 'checkbox')) { readForm(); loadList().then(() => { const s = root.querySelector('#' + CSS.escape(ev.target.id)); if (s) s.focus(); }); } });

  window.Research = { mount, open: openPost };
})();
