import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, ID, TRIAL, fakeKeys } from './helpers/zernio-fixture.mjs';
import { accounts, gate, londonToUtc, caption, readPost, check } from '../dashboard/lib/zernio.mjs';
import { handleAction, createServer } from '../dashboard/server.mjs';
import { buildState, itemDetail } from '../dashboard/lib/state.mjs';
import { applyAction, updateManifest } from '../dashboard/lib/manifest.mjs';

const posts = f => f.calls.filter(x => x.method === 'POST' && /\/posts(?:\/|$)/.test(x.url));
const retry = (f, platform) => handleAction(f.cfg, { id: ID, type: 'zernio-retry', submission: platform + '-1', sha: f.sha }, { wait: true });
test('accounts use separate credentials, report eligibility and never return credentials', async () => {
  const f = fixture(), a = await accounts(f.cfg);
  for (const [p, login] of Object.entries({ tiktok: 'A', youtube: 'A', instagram: 'B', facebook: 'B' })) { assert.equal(a.destinations[p].login, login); assert.equal(a.destinations[p].ready, true); assert.equal(a.destinations[p].accountId, p + '-account'); }
  assert.equal(a.destinations.facebook.pageId, '12345'); assert.match(a.destinations.instagram.notes.join(), /Professional/);
  for (const key of Object.values(fakeKeys)) assert.ok(!JSON.stringify(a).includes(key));
  assert.ok(f.calls.every(c => c.method === 'GET'));
  f.healthOverrides.instagram = { canPost: false }; f.accountSets.B[1].metadata = {};
  const b = await accounts(f.cfg, { fresh: true }); assert.equal(b.destinations.instagram.ready, false); assert.equal(b.destinations.facebook.eligible, false);
  f.accountSets.A.push({ ...f.accountSets.A[1], _id: 'youtube-duplicate' });
  const c = await accounts(f.cfg, { fresh: true }); assert.equal(c.destinations.youtube.ready, false); assert.match(c.destinations.youtube.notes.join(), /Several accounts/);
});

test('script, final-video QA, preflight and resource gates hold, including the PENDING REVIEW trial', async () => {
  const f = fixture(); assert.equal(gate(f.item()).ok, true);
  const trial = buildState(f.cfg).items.find(i => i.id === TRIAL); assert.equal(trial.review, 'PENDING REVIEW'); assert.equal(gate(trial).ok, false);
  await assert.rejects(handleAction(f.cfg, { ...f.action(), id: TRIAL }, { wait: true }), /Not ready/); assert.equal(posts(f).length, 0);
  for (const mutate of [i => i.review = 'PENDING REVIEW', i => i.files.approved = null, i => i.project.approval = null, i => i.project.renders[0].qa.state = 'failed', i => i.project.preflight.status = 'pending', i => i.resource = { keyword: 'GUIDE', state: 'draft' }, i => i.resource = { keyword: 'GUIDE', state: 'live', pdf: 'guide.pdf', gate: 'changed' }]) {
    const item = f.item(); mutate(item); assert.equal(gate(item).ok, false);
  }
  f.put('video-projects/publishing-fixture/renders/final.mp4', 'unapproved replacement');
  await assert.rejects(handleAction(f.cfg, f.action(), { wait: true }), /not the file that was approved/); assert.equal(posts(f).length, 0);
});

test('exact video/text, identity and all destinations are persisted before upload; routes and payloads match docs', async () => {
  const f = fixture(); await handleAction(f.cfg, f.action(['instagram', 'facebook', 'tiktok', 'youtube']), { wait: true });
  const m = f.manifest(); assert.equal(m.zernio.posts.length, 4); assert.equal(posts(f).length, 4);
  for (const p of m.zernio.posts) { assert.equal(p.state, 'published'); assert.equal(p.video.sha, f.sha); assert.equal(p.remote.postId, 'remote-' + p.platform); assert.ok(m.publishing[p.platform].url); }
  const firstUpload = f.calls.find(c => /media\/presign/.test(c.url));
  assert.equal(firstUpload.manifests[ID].zernio.posts.length, 4); assert.ok(firstUpload.manifests[ID].zernio.posts.every(p => p.key && p.state === 'prepared' || p.state === 'uploading'));
  const byPlatform = Object.fromEntries(posts(f).map(c => [c.body.platforms[0].platform, c]));
  assert.equal(byPlatform.instagram.login, 'B'); assert.equal(byPlatform.facebook.login, 'B'); assert.equal(byPlatform.youtube.login, 'A'); assert.equal(byPlatform.tiktok.login, 'A');
  assert.equal(byPlatform.facebook.body.platforms[0].customContent, 'Separate Facebook text\n\n#facebook');
  assert.equal(byPlatform.youtube.body.platforms[0].platformSpecificData.title, 'A deliberate title'); assert.deepEqual(byPlatform.youtube.body.tags, ['automation', 'tutorial']);
  assert.equal(byPlatform.youtube.body.platforms[0].platformSpecificData.visibility, 'unlisted');
  assert.deepEqual(byPlatform.tiktok.body.tiktokSettings, { privacy_level: 'PUBLIC_TO_EVERYONE', allow_comment: false, allow_duet: false, allow_stitch: false, commercialContentType: 'none', content_preview_confirmed: true, express_consent_given: true });
  for (const call of posts(f)) { assert.ok(call.body.platforms[0].customContent.includes('#')); assert.equal(call.headers['idempotency-key'], m.zernio.posts.find(p => p.platform === call.body.platforms[0].platform).key); }
  assert.equal(f.calls.filter(c => c.method === 'PUT').length, 4); assert.ok(f.calls.filter(c => c.method === 'PUT').every(c => !c.headers.authorization));
  const publicData = JSON.stringify(itemDetail(f.cfg, buildState(f.cfg), ID));
  for (const secret of [...Object.values(fakeKeys), ...m.zernio.posts.map(p => p.key), ...m.zernio.posts.map(p => p.mediaUrl)]) assert.ok(!publicData.includes(secret));
});

test('double-clicks and simultaneous submissions cannot duplicate posts or strand another destination', async () => {
  const f = fixture(); const results = await Promise.allSettled([handleAction(f.cfg, f.action(), { wait: true }), handleAction(f.cfg, f.action(), { wait: true })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(posts(f).length, 1);
  await assert.rejects(handleAction(f.cfg, f.action(), { wait: true }), /already/); assert.equal(posts(f).length, 1);
});

test('partial failure is independent across logins; retry keeps identity and does not repost successes', async () => {
  const f = fixture(); f.faults.youtube = 'failed';
  await handleAction(f.cfg, f.action(['instagram', 'facebook', 'youtube']), { wait: true });
  assert.equal(f.manifest().zernio.posts.find(p => p.platform === 'youtube').state, 'failed'); assert.ok(!f.manifest().publishing.youtube);
  const key = f.manifest().zernio.posts.find(p => p.platform === 'youtube').key;
  await retry(f, 'youtube');
  assert.equal(posts(f).filter(c => c.url.endsWith('/posts')).length, 3); assert.equal(posts(f).filter(c => c.url.endsWith('/retry')).length, 1);
  assert.equal(f.manifest().zernio.posts.find(p => p.platform === 'youtube').key, key); assert.ok(f.manifest().publishing.youtube);
  assert.equal(posts(f).filter(c => c.body?.platforms?.[0].platform === 'instagram').length, 1);
  await assert.rejects(retry(f, 'youtube'), /cannot be retried|already/);
});

test('status checks are read-only; uncertain submission retries reuse the exact saved key', async () => {
  const f = fixture(); f.faults.instagram = 'timeout'; await handleAction(f.cfg, f.action(), { wait: true });
  assert.equal(f.manifest().zernio.posts[0].state, 'unknown'); const key = posts(f)[0].headers['idempotency-key'], media = posts(f)[0].body.mediaItems;
  const count = f.calls.length; await check(f.cfg, ID, { update: updateManifest }); assert.ok(f.calls.slice(count).every(c => c.method === 'GET')); assert.equal(posts(f).length, 1);
  delete f.faults.instagram; await retry(f, 'instagram');
  assert.equal(posts(f)[1].headers['idempotency-key'], key); assert.deepEqual(posts(f)[1].body.mediaItems, media); assert.equal(f.manifest().zernio.posts.length, 1);
});

test('accepted but lost responses recover through provider idempotency without a second remote post', async () => {
  const f = fixture(); f.faults.instagram = call => { f.remote.set('lost-response', { key: call.headers['idempotency-key'], post: f.result('lost-response', 'instagram') }); throw new Error('Response lost'); };
  await handleAction(f.cfg, f.action(), { wait: true }); delete f.faults.instagram;
  await retry(f, 'instagram'); assert.equal(f.remote.size, 1); assert.equal(f.manifest().zernio.posts[0].remote.postId, 'lost-response');
});

test('expired uncertainty and crash recovery require deliberate action; Check status never resumes uploads', async () => {
  const f = fixture(); await accounts(f.cfg); applyAction(f.cfg, buildState(f.cfg), f.action());
  const n = f.calls.length; await check(f.cfg, ID, { update: updateManifest }); assert.equal(f.calls.length, n); assert.equal(f.manifest().zernio.posts[0].state, 'prepared');
  updateManifest(f.cfg, ID, m => { m.zernio.posts[0].state = 'submitting'; m.zernio.posts[0].sentAt = new Date(Date.now() - 25 * 3600000).toISOString(); });
  await check(f.cfg, ID, { update: updateManifest }); assert.equal(f.manifest().zernio.posts[0].state, 'verify'); await assert.rejects(retry(f, 'instagram'), /cannot be retried/); assert.equal(posts(f).length, 0);
});

test('London schedules handle GMT, BST, invalid dates and clock changes independently of the machine clock', async () => {
  assert.equal(londonToUtc('2027-01-10T09:00').toISOString(), '2027-01-10T09:00:00.000Z');
  assert.equal(londonToUtc('2027-07-10T09:00').toISOString(), '2027-07-10T08:00:00.000Z');
  for (const s of ['2027-03-28T01:30', '2027-10-31T01:30', '2027-02-30T09:00', '2027-01-01T24:00', 'soon']) assert.equal(londonToUtc(s), null, s);
  const f = fixture(); const when = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  await handleAction(f.cfg, f.action(['youtube'], { mode: 'schedule', when }), { wait: true });
  const p = f.manifest().zernio.posts[0]; assert.equal(p.state, 'scheduled'); assert.ok(!f.manifest().publishing.youtube);
  assert.equal(posts(f)[0].body.scheduledFor, londonToUtc(when).toISOString()); assert.equal(posts(f)[0].body.timezone, 'Europe/London'); assert.ok(!posts(f)[0].body.publishNow);
  const previous = f.calls.length; await check(f.cfg, ID, { update: updateManifest }); assert.ok(f.calls.slice(previous).every(c => c.method === 'GET')); assert.ok(!f.manifest().publishing.youtube);
  f.remote.get('remote-youtube').post = f.result('remote-youtube', 'youtube'); await check(f.cfg, ID, { update: updateManifest }); assert.ok(f.manifest().publishing.youtube);
  await assert.rejects(handleAction(f.cfg, f.action(['facebook'], { mode: 'schedule', when: new Date(Date.now() - 60000).toISOString().slice(0, 16) }), { wait: true }), /10 minutes/);
});

test('TikTok privacy, interaction and consent choices are mandatory; Inbox is not publication until a public link exists', async () => {
  for (const patch of [{ privacy: '' }, { consentPreview: false }, { consentExpress: false }, { mode: '' }, { comment: undefined }, { commercial: 'invalid' }]) {
    const f = fixture(), action = f.action(['tiktok']); Object.assign(action.fields.tiktok, patch);
    await assert.rejects(handleAction(f.cfg, action, { wait: true })); assert.equal(posts(f).length, 0);
  }
  const f = fixture(); f.creator.postingLimits.interactionSettings.allow_stitch.enabled = false;
  const invalid = f.action(['tiktok']); invalid.fields.tiktok.stitch = true; await assert.rejects(handleAction(f.cfg, invalid, { wait: true }), /does not allow stitch/);
  const inbox = f.action(['tiktok']); inbox.fields.tiktok.mode = 'inbox'; await handleAction(f.cfg, inbox, { wait: true });
  assert.equal(posts(f)[0].body.tiktokSettings.draft, true); assert.equal(f.manifest().zernio.posts[0].state, 'inbox'); assert.ok(!f.manifest().publishing.tiktok);
  f.remote.get('remote-tiktok').post = f.result('remote-tiktok', 'tiktok'); await check(f.cfg, ID, { update: updateManifest }); assert.equal(f.manifest().zernio.posts[0].state, 'published'); assert.ok(f.manifest().publishing.tiktok);
});

test('upload failures never create posts; provider conflicts and unconfirmed responses are held', async () => {
  const f = fixture(); f.faults.upload = true; await handleAction(f.cfg, f.action(), { wait: true }); assert.equal(posts(f).length, 0); assert.equal(f.manifest().zernio.posts[0].state, 'failed');
  delete f.faults.upload; await retry(f, 'instagram'); assert.equal(f.manifest().zernio.posts[0].state, 'published');
  for (const [fault, state] of [['409', 'unknown'], ['500', 'unknown'], ['duplicate', 'verify'], ['400', 'failed']]) { const x = fixture(); x.faults.instagram = fault; await handleAction(x.cfg, x.action(), { wait: true }); assert.equal(x.manifest().zernio.posts[0].state, state); assert.ok(!x.manifest().publishing.instagram); }
});

test('Facebook is explicit; old all-platforms records and publication history are preserved', async () => {
  const f = fixture(); f.put('Uploads/All social media/old.mp4', 'old'); updateManifest(f.cfg, ID, m => { m.links.uploadsFile = 'All social media/old.mp4'; m.publishing.instagram = { at: '2026-11-16T10:00:00Z', url: 'https://instagram.com/reel/old/' }; });
  const state = f.item(); assert.equal(state.platforms.yt.state, 'published'); assert.equal(state.platforms.tt.state, 'published'); assert.equal(state.platforms.fb.state, 'not-recorded');
  await handleAction(f.cfg, f.action(['facebook']), { wait: true }); assert.equal(f.manifest().publishing.instagram.url, 'https://instagram.com/reel/old/'); assert.ok(f.manifest().publishing.facebook);
});

test('readPost distinguishes platform state, scheduled processing, invalid links and manual handoff', () => {
  const rec = { platform: 'youtube' };
  assert.equal(readPost(rec, { status: 'published', platforms: [{ platform: 'youtube', status: 'failed' }] }).state, 'failed');
  assert.equal(readPost(rec, { status: 'scheduled', platforms: [{ platform: 'youtube', status: 'pending' }] }).state, 'scheduled');
  assert.equal(readPost(rec, { status: 'scheduled', platforms: [{ platform: 'youtube', status: 'failed' }] }).state, 'scheduled', 'a hosted automatic retry is not a new local failure');
  assert.equal(readPost(rec, { status: 'processing' }).state, 'processing');
  assert.equal(readPost(rec, { status: 'published', platforms: [{ platform: 'youtube', status: 'published', platformPostUrl: 'javascript:alert(1)' }] }).remote.url, null);
  assert.equal(caption({ text: 'Text', tags: 'one, #two' }), 'Text\n\n#one #two');
});

test('failed scheduled posts can retry once due; a future schedule cannot publish early through retry', async () => {
  const f = fixture(), when = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  f.faults.youtube = 'failed'; await handleAction(f.cfg, f.action(['youtube'], { mode: 'schedule', when }), { wait: true });
  await assert.rejects(retry(f, 'youtube'), /immediately/); assert.equal(posts(f).filter(c => c.url.endsWith('/retry')).length, 0);
  updateManifest(f.cfg, ID, m => m.zernio.posts[0].scheduledUtc = new Date(Date.now() - 60000).toISOString());
  await retry(f, 'youtube'); assert.equal(f.manifest().zernio.posts[0].state, 'published'); assert.equal(f.manifest().zernio.posts[0].retryMode, 'now');
});

test('a changed account mapping is refused before upload', async () => {
  const f = fixture(), a = f.action(); a.accounts.instagram.accountId = 'old-account';
  await assert.rejects(handleAction(f.cfg, a, { wait: true }), /account changed/); assert.equal(f.calls.filter(c => c.method !== 'GET').length, 0);
});

test('HTTP preview and Check status cannot upload; draft saves are inert and keys stay server-side', async t => {
  const f = fixture(), srv = createServer(f.cfg); await new Promise(r => srv.listen(0, '127.0.0.1', r)); t.after(() => srv.close()); const base = `http://localhost:${srv.address().port}`;
  for (const route of ['/api/state', '/api/item?id=' + ID, '/api/zernio/accounts', '/publish.js', '/publish.css']) { const r = await fetch(base + route); assert.equal(r.status, 200); const text = await r.text(); for (const k of Object.values(fakeKeys)) assert.ok(!text.includes(k)); }
  const r = await fetch(base + '/api/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ID, type: 'zernio-draft', fields: f.fields }) }); assert.equal(r.status, 200); assert.equal(posts(f).length, 0);
  assert.ok(f.calls.every(c => c.method === 'GET')); assert.equal(f.manifest().zernio.draft.fields.facebook.text, 'Separate Facebook text');
  assert.ok(!readFileSync(join(f.cfg.contentDir, 'history.jsonl'), 'utf8').includes(fakeKeys.A));
});

test('outside edits: listed for approval, held by in-flight posts, and the gate follows an outside-edit approval', () => {
  const f = fixture(), dir = join(f.cfg.projectsDir, 'publishing-fixture'), named = 'renders/publishing-fixture-final.mp4';
  writeFileSync(join(dir, named), 'canva-video');
  const item = () => buildState(f.cfg).items.find(i => i.id === ID);
  const e = item().project.outsideEdits;
  assert.deepEqual(e.map(x => x.file), [named], 'only the unrecorded, unapproved MP4 is offered; the candidate and approved bytes are not');
  const act = extra => applyAction(f.cfg, buildState(f.cfg), { id: ID, type: 'approve-external', file: named, sha: e[0].sha, ...extra });
  assert.throws(() => act({ watched: false }), /Tick the box/);
  assert.throws(() => act({ watched: true, sha: '0'.repeat(64) }), /changed since you opened it/);
  assert.throws(() => act({ watched: true, file: 'renders/candidate-v001.mp4' }), /not an outside edit/);
  updateManifest(f.cfg, ID, m => { m.zernio = { posts: [{ id: 'tiktok-1', platform: 'tiktok', state: 'scheduled', video: { sha: f.sha }, remote: null }] }; });
  assert.throws(() => act({ watched: true }), /Zernio still holds tiktok/);
  const reelPath = join(dir, 'reel.json'), reel = JSON.parse(readFileSync(reelPath, 'utf8')), base = reel.approvals[0];
  reel.approvals.push({ kind: 'external-edit', status: 'approved', file: named, candidate: null, sha256: e[0].sha, basedOn: { candidate: base.candidate, sha256: base.sha256 }, source: 'Canva', promotedTo: named, approvedBy: 'Reviewer', approvedAt: new Date().toISOString() });
  reel.finalFile = named; writeFileSync(reelPath, JSON.stringify(reel));
  const it = item();
  assert.equal(it.project.approval.kind, 'external-edit'); assert.equal(it.project.finalFile, `video-projects/publishing-fixture/${named}`);
  assert.deepEqual(it.project.outsideEdits.map(x => x.file), ['renders/final.mp4'], 'the earlier approved copy can be chosen again; the current one is not offered'); assert.equal(it.candidate, null);
  assert.ok(!gate(it).reasons.some(r => /candidate|not approved/.test(r)), gate(it).reasons.join('; '));
  reel.approvals.at(-1).basedOn.sha256 = 'f'.repeat(64); writeFileSync(reelPath, JSON.stringify(reel));
  assert.ok(gate(item()).reasons.some(r => /outside edit must finish a candidate/.test(r)));
});
