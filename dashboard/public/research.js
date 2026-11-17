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
  const EVIDENCE = { transcript: 'Full transcript', excerpt: 'Search excerpt only', caption: 'Caption only', none: 'Title only' };
  const WINDOW = { 7: 'last 7 days', 30: 'last 30 days', 90: 'last 90 days', 365: 'last 12 months', all: 'any date' };
  const DEFAULTS = { search: '', q: '', platform: '', format: '', window: '30', sort: 'published' };

  let root = null, tab = 'signals', F = { ...DEFAULTS }, data = null, searches = null, ideas = null, detail = null, detailId = null, error = null, returnTo = null, returnY = 0, removeAsk = false, busy = false;
  const get = async url => { const r = await fetch(url); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Request failed'); return j; };

  async function loadList() { error = null; try { data = await get('/api/research?' + new URLSearchParams(F)); } catch (x) { error = x.message; } draw(); }
  async function loadIdeas() { error = null; try { ideas = (await get('/api/research/ideas')).ideas; } catch (x) { error = x.message; } draw(); }
  const LOAD = { signals: () => loadList(), searches: () => loadSearches(), ideas: () => loadIdeas() };
  // One saved-idea action. A click is ignored while a request is in flight, and every action is repeat-safe on the server.
  async function act(body, focusSel) {
    if (busy) return; busy = true;
    try { const r = await fetch('/api/research/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); toast(r.ok ? j.message : j.error || 'That did not work'); }
    catch (x) { toast('That did not work: ' + x.message); }
    busy = false; removeAsk = false; data = null; ideas = null;
    if (detailId) { try { detail = await get('/api/research/post?' + new URLSearchParams({ id: detailId, q: F.q || F.search })); } catch (x) { error = x.message; } draw(); const f = focusSel && root.querySelector(focusSel); if (f) f.focus(); }
  }
  async function loadSearches() { error = null; try { searches = (await get('/api/research/searches')).searches; } catch (x) { error = x.message; } draw(); }
  async function openPost(id) {
    returnTo = id; returnY = window.scrollY; detailId = id; detail = null; removeAsk = false; draw(); window.scrollTo(0, 0);
    try { detail = await get('/api/research/post?' + new URLSearchParams({ id, q: F.q || F.search })); } catch (x) { error = x.message; detailId = null; }
    draw(); const h = root && root.querySelector('#r-title'); if (h) h.focus();
  }

  // ---- pieces ----
  const tags = (r, saved) => `<span class="r-tags">${saved ? '<span class="r-tag r-saved">Saved idea</span>' : ''}${r.providers.map(p => `<span class="r-tag" title="${e(SOURCE_KIND[p])}">${e(SOURCE[p] || p)} · ${e(SOURCE_KIND[p] || '')}</span>`).join('')}</span>`;
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
  function table(rows, caption) {
    return `<div class="r-frame"><table class="r-table r-list"><caption class="sub" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">${e(caption)}</caption>
    <thead><tr><th scope="col">Post</th><th scope="col">Published</th><th scope="col">Evidence saved</th><th scope="col">Raw engagement</th><th scope="col">Creator outlier</th><th scope="col">Growth</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td class="post" data-label="Post"><button class="r-open" data-r-open="${e(r.id)}">${e(r.title || 'Untitled post')}</button>
      <span class="sub">${e(r.creator.handle ? '@' + String(r.creator.handle).replace(/^@/, '') : r.creator.name || 'Creator unknown')} · ${dur(r.durationSeconds)}</span>${tags(r, data.ideaPosts.includes(r.id))}</td>
      <td class="nowrap" data-label="Published">${publishedCell(r)}</td><td data-label="Evidence saved">${evidenceCell(r)}</td>
      <td data-label="Raw engagement">${engagementCell(r)}</td><td data-label="Creator outlier">${outlierCell(r)}</td><td data-label="Growth">${growthCell(r)}</td></tr>`).join('')}
    </tbody></table></div>`;
  }

  // ---- Signals ----
  function vSignals() {
    if (!data) return '<p class="sub">Loading saved research…</p>';
    const t = data.totals, f = data.filters, win = WINDOW[f.window];
    if (!t.posts && !t.searches) return `${note()}<div class="panel"><h3>No research is saved yet</h3><p>Run a search in Claude Code. Its results appear here once the importer has stored them.</p></div>`;
    const opt = (v, l, cur) => `<option value="${e(v)}" ${v === cur ? 'selected' : ''}>${e(l)}</option>`;
    const filters = `<form class="r-filters" id="r-form" aria-label="Filter saved research">
      <div class="r-field"><label for="r-search">Saved search</label><select id="r-search" name="search">${opt('', 'All saved searches', f.search)}${data.queries.map(q => opt(q, q, f.search)).join('')}</select></div>
      <div class="r-field wide full"><label for="r-q">Words in the saved text</label><input id="r-q" name="q" type="search" value="${e(f.q)}" placeholder='n8n, or "claude code" for an exact phrase' autocomplete="off"></div>
      <div class="r-field"><label for="r-platform">Platform</label><select id="r-platform" name="platform">${opt('', 'All platforms', f.platform)}${Object.entries(PLATFORM).map(([k, l]) => opt(k, l, f.platform)).join('')}</select></div>
      <div class="r-field"><label for="r-format">Format</label><select id="r-format" name="format">${opt('', 'All formats', f.format)}${Object.entries(FORMAT).map(([k, l]) => opt(k, l, f.format)).join('')}</select></div>
      <div class="r-field"><label for="r-window">Published</label><select id="r-window" name="window">${Object.entries(WINDOW).map(([k, l]) => opt(k, l[0].toUpperCase() + l.slice(1), f.window)).join('')}</select></div>
      <div class="r-field"><label for="r-sort">Sort each list by</label><select id="r-sort" name="sort">${opt('published', 'Newest published', f.sort)}${opt('engagement', 'Raw engagement', f.sort)}${opt('outlier', 'Creator outlier', f.sort)}</select></div>
      <div class="r-actions"><button class="btn primary" type="submit">Filter saved research</button><button class="btn" type="button" data-r-reset="1">Reset filters</button>
      <span class="sub">${f.sort === 'outlier' ? 'Creator outlier compares a post with its own creator. Posts with only an unstable signal, or none, sort last.' : f.sort === 'engagement' ? 'Raw engagement is a plain count. It is not adjusted for audience size or age.' : 'Lists are never merged across platforms or formats.'}</span></div></form>`;
    // One quiet line per search, so a gap is not read as "nothing found". The exact errors live on the Searches tab.
    const byQuery = new Map(); for (const x of data.failures) { if (!byQuery.has(x.query)) byQuery.set(x.query, { at: x.retrievedAt, lanes: [] }); byQuery.get(x.query).lanes.push(x.laneLabel); }
    const fails = [...byQuery].map(([q, v]) => `<p class="r-gap" role="status">Latest “${e(q)}” search (${when(v.at)}): ${e(v.lanes.join(', '))} did not run, so ${v.lanes.length === 1 ? 'that source has' : 'those sources have'} no new results. <button class="r-link" data-r-tab="searches">See why</button></p>`).join('');
    const summary = `<p class="r-summary" role="status"><strong>${t.recent}</strong> ${f.window === 'all' ? 'saved posts with a publication date' : `published in the ${win}`}${f.window === 'all' ? '' : ` · <strong>${t.historical}</strong> older, kept as historical references`}${t.undated ? ` · <strong>${t.undated}</strong> with no publication date` : ''}. ${t.shown} of ${t.posts} saved posts match these filters.</p>`;
    const groups = data.groups.map(g => {
      const lead = g.recent.length ? table(g.recent, `${g.label}, published in the ${win}`) : `<p class="sub">No saved ${e(g.label)} post was published in the ${win}.</p>`;
      const hist = g.historical.length ? `<details class="r-hist"><summary>${g.historical.length} historical ${g.historical.length === 1 ? 'reference' : 'references'}, published before the ${win}</summary><p class="sub">Outside the date filter. Kept for reference; not current results.</p>${table(g.historical, `${g.label}, historical references`)}</details>` : '';
      const und = g.undated.length ? `<details class="r-hist"><summary>${g.undated.length} with no publication date</summary><p class="sub">The source gave no date, so these are never counted as recent.</p>${table(g.undated, `${g.label}, publication date unknown`)}</details>` : '';
      return `<section class="r-group" aria-label="${e(g.label)}"><h3>${e(g.label)} <span class="sub">${g.recent.length} in the ${win}. Top matches from the saved searches, not everything that exists.</span></h3>${lead}${hist}${und}</section>`;
    }).join('');
    return `${note()}${filters}${fails}${summary}${groups || '<div class="panel"><p>No saved post matches these filters.</p></div>'}`;
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
    return `<p class="sub">Your saved ideas, newest first. Your angle is your own direction; the source evidence stays on the post's page. Research imports never change an idea.</p><div class="r-ideas">` + ideas.map((x, i) => {
      if (x.missing) return `<section class="panel"><h3>Source post not found</h3><p class="sub">The post <span class="mono">${e(x.idea.postId)}</span> is no longer in the research store. Your angle is kept.</p><div class="r-angle">${e(x.idea.angle || 'No angle written.')}</div></section>`;
      const [cls, label, why] = ideaState(x);
      return `<section class="panel" aria-label="Idea: ${e(x.post.title || 'Untitled post')}"><div class="r-head"><div><button class="r-open" data-r-open="${e(x.post.id)}">${e(x.post.title || 'Untitled post')}</button><span class="r-tags"><span class="r-tag">${e(PF(x.post))}</span><span class="r-tag">${EVIDENCE[x.post.evidence]}</span></span></div><span class="pill ${cls}">${label}</span></div>
        <div><p class="r-kind">Your angle</p>${x.idea.angle ? `<div class="r-angle">${e(x.idea.angle)}</div>` : '<p class="sub">No angle written yet.</p>'}</div>
        <p class="sub">${e(why)}</p>
        <div class="row"><button class="btn small" data-r-open="${e(x.post.id)}" aria-label="Open idea and evidence: ${e(x.post.title || 'Untitled post')}">Open idea and evidence</button><button class="btn small" data-r-briefof="${i}">Copy brief</button>${x.exported && x.exported.pipelineId ? `<button class="btn small" data-r-pipeline="${e(x.exported.pipelineId)}" aria-label="Open in Pipeline: ${e(x.post.title || 'Untitled post')}">Open in Pipeline</button>` : ''}</div></section>`;
    }).join('') + '</div>';
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
    return `<section class="panel r-idea" aria-label="Your idea"><div class="r-head"><h3>Your idea</h3><span class="pill ok">Saved</span></div>${intro}${field}
      <p class="sub">Saved ${when(i.createdAt)}${i.updatedAt !== i.createdAt ? ' · last changed ' + when(i.updatedAt) : ''}</p>
      <div class="row"><button class="btn" data-r-angle="1">Save angle</button><button class="btn" data-r-copybrief="1">Copy brief</button>
      ${x ? '' : removeAsk ? '<span class="sub">Remove this idea and its angle?</span><button class="btn small" data-r-removeyes="1">Yes, remove the idea</button><button class="btn small" data-r-removeno="1">Keep it</button>' : '<button class="btn small" data-r-remove="1">Remove idea</button>'}</div>
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
        <td data-label="Result">${r.status === 'ok' ? `<span class="pill ok">${r.results} top ${r.results === 1 ? 'match' : 'matches'}</span>` : `<span class="pill bad">Failed</span><span class="sub">${e(r.error)}</span>`}</td>
        <td data-label="Notes from the run">${r.note ? e(r.note) : '<span class="sub">None</span>'}</td></tr>`).join('')}</tbody></table></div></section>`).join('');
  }

  // ---- one post ----
  const segs = a => a.map(x => (x.m ? `<mark>${e(x.t)}</mark>` : e(x.t))).join('');
  function vPost() {
    const back = `<div><button class="back" data-r-back="1">Back to ${tab === 'ideas' ? 'Ideas' : tab === 'searches' ? 'Searches' : 'Signals'}</button></div>`;
    if (!detail) return `${back}<p class="sub">Loading the saved post…</p>`;
    const d = detail, q = d.query;
    const facts = `<section class="panel" aria-label="Post"><dl class="kv">
      <dt>Platform</dt><dd>${PLATFORM[d.platform]} · ${FORMAT[d.format]}</dd><dt>Creator</dt><dd>${e([d.creator.name, d.creator.handle && '@' + String(d.creator.handle).replace(/^@/, '')].filter(Boolean).join(' · ') || 'Unknown')}</dd>
      <dt>Published</dt><dd>${d.publishedAt ? `${when(d.publishedAt)} · ${ago(d.publishedAgeDays)}` : '<span class="r-warn">Unknown: the source gave no date</span>'}</dd><dt>Duration</dt><dd>${dur(d.durationSeconds)}</dd>
      <dt>First imported</dt><dd>${when(d.firstRetrievedAt)}</dd><dt>Last seen in a search</dt><dd>${when(d.lastRetrievedAt)}</dd><dt>Source link</dt><dd><a href="${e(d.url)}" target="_blank" rel="noopener noreferrer">${e(d.url)}</a></dd></dl></section>`;
    const found = `<section class="panel" aria-label="Where it was found"><h3>Where it was found</h3>${d.runs.length ? `<div class="r-frame"><table class="r-table"><thead><tr><th scope="col">Search</th><th scope="col">Run</th><th scope="col">Source</th><th scope="col">Position</th><th scope="col">Retrieved</th></tr></thead><tbody>
      ${d.runs.map(r => `<tr><td data-label="Search">“${e(r.query)}”<span class="sub mono">${e(r.batchId)}</span></td><td data-label="Run">${e(r.laneLabel)}</td><td data-label="Source">${e(SOURCE[r.provider])}<span class="sub">${e(SOURCE_KIND[r.provider])}</span></td><td data-label="Position">${r.rank} of ${r.of} top matches</td><td data-label="Retrieved">${when(r.retrievedAt)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="sub">No search run on record lists this post.</p>'}</section>`;
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
      <div><p class="r-kind">Full transcript (spoken words)</p>${d.transcriptText ? `<p class="sub">${n(d.transcript.words)} words, ${d.transcript.origin === 'subtitles' ? 'YouTube subtitles fetched through' : d.transcript.origin === 'whisper' ? 'speech-to-text through' : 'transcript held by'} ${e(SOURCE[d.transcript.provider])}${d.transcript.capturedAt ? ', captured ' + when(d.transcript.capturedAt) : ', capture time unknown'}.</p>
        <div class="row" style="margin:8px 0"><button class="btn small" data-r-copytranscript="1">Copy transcript</button></div><div class="r-text" id="r-transcript">${e(d.transcriptText)}</div>` : '<p><strong>No transcript was fetched for this post.</strong> <span class="sub">Excerpts and captions above are not a transcript.</span></p>'}</div></section>`;
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
  function readForm() { const fd = new FormData(root.querySelector('#r-form')); for (const k of Object.keys(DEFAULTS)) F[k] = String(fd.get(k) ?? DEFAULTS[k]); }

  document.addEventListener('click', ev => {
    if (!root || !root.contains(ev.target)) return; const b = ev.target.closest('button'); if (!b) return; const d = b.dataset;
    if (d.rTab) { tab = d.rTab; draw(); LOAD[tab](); }
    else if (d.rOpen) openPost(d.rOpen);
    else if (d.rBack) { detailId = null; detail = null; draw(); const refocus = () => { const again = returnTo && root.querySelector(`[data-r-open="${CSS.escape(returnTo)}"]`); if (again) { const h = again.closest('details'); if (h) h.open = true; again.focus({ preventScroll: true }); } window.scrollTo(0, returnY); }; if (tab !== 'signals' || !data) LOAD[tab]().then(refocus); else refocus(); }
    else if (d.rReset) { F = { ...DEFAULTS }; loadList(); }
    else if (d.rShow) { F = { ...DEFAULTS, search: d.rShow, window: 'all' }; tab = 'signals'; data = null; draw(); loadList(); }
    else if (d.rSave) act({ type: 'save-idea', postId: detailId, angle: root.querySelector('#r-angle').value }, '#r-angle');
    else if (d.rAngle) act({ type: 'set-angle', ideaId: detail.idea.id, angle: root.querySelector('#r-angle').value }, '[data-r-angle]');
    else if (d.rExport) act({ type: 'export-idea', ideaId: detail.idea.id }, '[data-r-copy]');
    else if (d.rRemove) { removeAsk = true; draw(); root.querySelector('[data-r-removeno]').focus(); }
    else if (d.rRemoveno) { removeAsk = false; draw(); root.querySelector('[data-r-remove]').focus(); }
    else if (d.rRemoveyes) act({ type: 'remove-idea', ideaId: detail.idea.id }, '#r-angle');
    else if (d.rCopybrief) copyText(detail.brief).then(() => toast('Brief copied'), () => toast('Copy was blocked'));
    else if (d.rBriefof !== undefined) copyText(ideas[Number(d.rBriefof)].brief).then(() => toast('Brief copied'), () => toast('Copy was blocked'));
    else if (d.rPipeline) load(true).then(() => open(d.rPipeline));
    else if (d.rCopy !== undefined) copyText(d.rCopy).then(() => toast(d.rToast || 'Copied. Paste it into Claude Code and add your topic.'), () => toast('Copy was blocked; select the text instead'));
    else if (d.rCopytranscript) copyText(detail.transcriptText).then(() => toast('Transcript copied'), () => toast('Copy was blocked; select the text instead'));
  });
  document.addEventListener('submit', ev => { if (ev.target.id === 'r-form') { ev.preventDefault(); readForm(); loadList(); } });
  document.addEventListener('change', ev => { if (root && ev.target.closest && ev.target.closest('#r-form') && ev.target.tagName === 'SELECT') { readForm(); loadList().then(() => { const s = root.querySelector('#' + CSS.escape(ev.target.id)); if (s) s.focus(); }); } });

  window.Research = { mount, open: openPost };
})();
