// Idea groups: up to 3 YouTube ideas side by side with Mits's own script (dashboard/lib/ideas.mjs). Throwaway folders
// and a fake subtitle runner only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { loadConfig } = await import('../dashboard/lib/config.mjs');
const { importBatch } = await import('../dashboard/lib/research.mjs');
const { readIdeas, readGroups, ideaAction, ideasView, groupView, groupsSummary, fetchesIdle } = await import('../dashboard/lib/ideas.mjs');
const { createServer } = await import('../dashboard/server.mjs');

const NOW = new Date('2026-11-21T10:00:00Z'), AT = '2026-11-21T09:00:00Z';
const Y = ['AAAAAAAAAA1', 'BBBBBBBBBB2', 'CCCCCCCCCC3', 'DDDDDDDDDD4'], TT = '7708502162103438612';
const key = id => 'youtube-' + Buffer.from(id).toString('hex'), iid = id => 'idea-' + key(id);
const later = m => new Date(NOW.getTime() + m * 60000);

function store() {
  const pending = [];
  const cfg = loadConfig({ root: mkdtempSync(join(tmpdir(), 'groups-')), subtitleGapMs: 0, subtitleRunner: () => new Promise(r => pending.push(r)) });
  importBatch(cfg, { schema: 1, batchId: 'b1', retrievedAt: AT, search: { query: 'claude', windowDays: 30 }, runs: [
    { provider: 'last30free', lane: 'youtube_discovery', status: 'ok', results: Y.map(y => 'youtube:' + y) },
    { provider: 'last30free', lane: 'tiktok_hashtag', status: 'ok', results: ['tiktok:' + TT] }],
  posts: [
    ...Y.map((y, i) => ({ platform: 'youtube', id: y, provider: 'last30free', url: 'https://www.youtube.com/watch?v=' + y, format: 'long', creator: { name: 'Channel ' + (i + 1) }, title: `Claude video ${i + 1}`, publishedAt: '2026-11-16T12:00:00Z', durationSeconds: 600 + i,
      transcript: i === 3 ? null : { text: `Spoken words of video ${i + 1}.`, origin: 'subtitles', capturedAt: AT }, observation: { measuredAt: AT, metrics: { views: 1000 * (i + 1) } } })),
    { platform: 'tiktok', id: TT, provider: 'last30free', url: `https://www.tiktok.com/@x/video/${TT}`, format: 'short', title: 'tiktok', publishedAt: '2026-11-15T20:45:31Z', durationSeconds: 66, transcript: null, observation: null }] });
  for (const y of Y) ideaAction(cfg, { type: 'save-idea', postId: key(y), angle: 'Angle for ' + y }, NOW);
  ideaAction(cfg, { type: 'save-idea', postId: 'tiktok-' + TT }, NOW);
  return { cfg, pending };
}
const act = (cfg, body, m = 1) => ideaAction(cfg, body, later(m));

test('a group is created with 1 to 3 YouTube ideas, and pressing Create twice duplicates nothing', () => {
  const { cfg } = store();
  assert.throws(() => act(cfg, { type: 'create-group', ideaIds: [] }), /at least one YouTube idea/);
  assert.throws(() => act(cfg, { type: 'create-group', ideaIds: Y.map(iid) }), /at most 3 ideas/);
  assert.throws(() => act(cfg, { type: 'create-group', ideaIds: [iid(Y[0]), 'idea-tiktok-' + TT] }), /Only YouTube ideas/);
  assert.throws(() => act(cfg, { type: 'create-group', ideaIds: ['idea-nope'] }), /no longer exists/);
  const one = act(cfg, { type: 'create-group', ideaIds: [iid(Y[3])] }); assert.equal(one.message, 'Group created.');
  const r = act(cfg, { type: 'create-group', ideaIds: [iid(Y[0]), iid(Y[1]), iid(Y[1]), iid(Y[2])] }); // a repeated id counts once
  assert.equal(r.message, 'Group created.');
  const again = act(cfg, { type: 'create-group', ideaIds: [iid(Y[2]), iid(Y[0]), iid(Y[1])] }, 2);
  assert.deepEqual([again.message, again.groupId], ['These ideas are already a group. Nothing was duplicated.', r.groupId]);
  assert.throws(() => act(cfg, { type: 'create-group', ideaIds: [iid(Y[0])] }), /already in the group “Claude video 1”/);
  const gs = readGroups(cfg); assert.equal(gs.length, 2);
  assert.deepEqual([gs[1].name, gs[1].ideaIds, gs[1].draft], ['Claude video 1', [iid(Y[0]), iid(Y[1]), iid(Y[2])], '']);
  assert.equal(act(cfg, { type: 'create-group', ideaIds: [iid(Y[3])] }).message, 'These ideas are already a group. Nothing was duplicated.');
});

test('after creation a group holds 0 to 3; removing the last idea keeps the group and its script, after a reload too', () => {
  const { cfg } = store();
  const { groupId } = act(cfg, { type: 'create-group', ideaIds: [iid(Y[0])], name: '  My   AI  group ' });
  assert.equal(readGroups(cfg)[0].name, 'My AI group');
  assert.equal(act(cfg, { type: 'add-to-group', groupId, ideaId: iid(Y[1]) }).message, 'Added to the group.');
  assert.equal(act(cfg, { type: 'add-to-group', groupId, ideaId: iid(Y[1]) }).message, 'Already in this group.');
  act(cfg, { type: 'add-to-group', groupId, ideaId: iid(Y[2]) });
  assert.throws(() => act(cfg, { type: 'add-to-group', groupId, ideaId: iid(Y[3]) }), /already holds 3 ideas/);
  assert.throws(() => act(cfg, { type: 'add-to-group', groupId, ideaId: 'idea-tiktok-' + TT }), /Only YouTube ideas/);
  const script = 'Hook: the one thing all three videos miss.\n\nBody…';
  assert.equal(act(cfg, { type: 'set-group-draft', groupId, draft: script }).message, 'Script saved.');
  assert.equal(act(cfg, { type: 'set-group-draft', groupId, draft: script }, 3).message, 'No change.');
  for (const y of Y.slice(0, 3)) act(cfg, { type: 'remove-from-group', groupId, ideaId: iid(y) });
  assert.match(act(cfg, { type: 'remove-from-group', groupId, ideaId: iid(Y[0]) }).message, /Not in this group/);
  // a "reload": everything read back from the file
  const g = JSON.parse(readFileSync(join(cfg.researchDir, 'ideas.json'), 'utf8')).groups[0];
  assert.deepEqual([g.id, g.ideaIds, g.draft], [groupId, [], script]);
  const v = groupView(cfg, groupId, NOW); assert.deepEqual([v.members, v.group.draft, v.candidates.length], [[], script, 4]); // all four YouTube ideas are free again; TikTok never is
  assert.deepEqual(groupsSummary(cfg).map(s => [s.count, s.hasDraft, s.titles]), [[0, true, []]]);
  // the ideas themselves are untouched, and an empty group can be filled again
  assert.equal(readIdeas(cfg).length, 5); act(cfg, { type: 'add-to-group', groupId, ideaId: iid(Y[3]) }); assert.deepEqual(readGroups(cfg)[0].ideaIds, [iid(Y[3])]);
});

test('only Delete group removes a group; it keeps the ideas, and is repeat-safe', () => {
  const { cfg } = store();
  const { groupId } = act(cfg, { type: 'create-group', ideaIds: [iid(Y[0]), iid(Y[1])] }); act(cfg, { type: 'set-group-draft', groupId, draft: 'script' });
  assert.equal(act(cfg, { type: 'delete-group', groupId }).message, 'Group deleted. Its ideas are kept.');
  assert.equal(act(cfg, { type: 'delete-group', groupId }).message, 'That group was already deleted.');
  assert.deepEqual(readGroups(cfg), []); assert.equal(readIdeas(cfg).length, 5);
  assert.throws(() => act(cfg, { type: 'set-group-draft', groupId, draft: 'x' }), /no longer exists/);
  assert.equal(groupView(cfg, groupId, NOW), null);
  // the ideas can be grouped again
  assert.equal(act(cfg, { type: 'create-group', ideaIds: [iid(Y[0])] }).message, 'Group created.');
});

test('removing an idea takes it out of its group; the group and its script stay, even when it was the last one', () => {
  const { cfg } = store();
  const { groupId } = act(cfg, { type: 'create-group', ideaIds: [iid(Y[0])] }); act(cfg, { type: 'set-group-draft', groupId, draft: 'kept' });
  act(cfg, { type: 'remove-idea', ideaId: iid(Y[0]) });
  assert.deepEqual([readGroups(cfg)[0].ideaIds, readGroups(cfg)[0].draft], [[], 'kept']);
  assert.equal(readIdeas(cfg).some(i => i.id === iid(Y[0])), false);
});

test('groups survive every other ideas write, including a transcript fetch landing', async () => {
  const { cfg, pending } = store(); // Y[3] has no transcript, so saving it queued a fetch
  const { groupId } = act(cfg, { type: 'create-group', ideaIds: [iid(Y[2]), iid(Y[3])] }); act(cfg, { type: 'set-group-draft', groupId, draft: 'mine' });
  const before = readGroups(cfg);
  act(cfg, { type: 'set-angle', ideaId: iid(Y[0]), angle: 'new' });
  act(cfg, { type: 'close-idea', ideaId: iid(Y[1]), as: 'dropped' });
  act(cfg, { type: 'save-idea', postId: 'tiktok-' + TT });
  act(cfg, { type: 'set-transcript', postId: 'tiktok-' + TT, text: 'pasted' });
  pending.shift()({ ok: true, text: 'Fetched words for video four.' }); await fetchesIdle(cfg);
  assert.deepEqual(readGroups(cfg), before);
  // and the group shows the fetched transcript in its column
  const m = groupView(cfg, groupId, NOW).members[1];
  assert.deepEqual([m.transcriptText, m.transcriptLabel, m.fetch.state], ['Fetched words for video four.', 'YouTube subtitles fetched when you saved the idea', 'ok']);
});

test('the group page has each video side by side, and Copy all transcripts labels every part', async () => {
  const { cfg, pending } = store();
  const { groupId } = act(cfg, { type: 'create-group', ideaIds: [iid(Y[1]), iid(Y[3])], name: 'Claude for work' });
  const v = groupView(cfg, groupId, NOW);
  assert.deepEqual(v.members.map(m => [m.title, m.creator, m.views, m.angle, m.transcriptText]), [['Claude video 2', 'Channel 2', 2000, 'Angle for ' + Y[1], 'Spoken words of video 2.'], ['Claude video 4', 'Channel 4', 4000, 'Angle for ' + Y[3], null]]);
  assert.equal(v.members[1].fetch.state, 'fetching');
  assert.deepEqual(v.candidates.map(c => c.ideaId), [iid(Y[0]), iid(Y[2])]);
  for (const part of ['GROUP: Claude for work', '2 YouTube videos.', '=== VIDEO 1 of 2: Claude video 2', 'Creator: Channel 2', 'Source: https://www.youtube.com/watch?v=' + Y[1],
    'Views: 2000 (measured 2026-11-21)', 'MY ANGLE: Angle for ' + Y[1], 'TRANSCRIPT (YouTube subtitles, 5 words):\nSpoken words of video 2.', '=== VIDEO 2 of 2: Claude video 4', 'TRANSCRIPT: none yet (still being fetched).']) assert.ok(v.bundle.includes(part), part);
  pending.shift()({ ok: false, error: "Couldn't fetch subtitles" }); await fetchesIdle(cfg);
  assert.ok(groupView(cfg, groupId, NOW).bundle.includes("TRANSCRIPT: none yet (couldn't fetch subtitles)."));
  // the Ideas list marks grouped ideas
  const marks = Object.fromEntries(ideasView(cfg, [], NOW).map(x => [x.idea.id, x.group && x.group.name]));
  assert.deepEqual([marks[iid(Y[1])], marks[iid(Y[3])], marks[iid(Y[0])], marks['idea-tiktok-' + TT]], ['Claude for work', 'Claude for work', null, null]);
  assert.throws(() => act(cfg, { type: 'rename-group', groupId, name: '   ' }), /Give the group a name/);
  assert.throws(() => act(cfg, { type: 'rename-group', groupId, name: 'x'.repeat(121) }), /under 120 characters/);
  assert.equal(act(cfg, { type: 'rename-group', groupId, name: 'New name' }).message, 'Group renamed.');
});

test('the group routes: a long script saves over HTTP, unknown groups are 404, an over-long script is refused', async () => {
  const { cfg } = store(); const srv = createServer(cfg); await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = 'http://localhost:' + srv.address().port;
  const send = body => fetch(base + '/api/research/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const { groupId } = await (await send({ type: 'create-group', ideaIds: [iid(Y[0]), iid(Y[1])] })).json();
    const long = 'Line of my script with “quotes” and é.\n'.repeat(2400); // ~100 KB of UTF-8, past the old 64 KB request limit
    assert.ok(long.length < 100000 && Buffer.byteLength(JSON.stringify({ draft: long })) > 65536);
    const r = await send({ type: 'set-group-draft', groupId, draft: long }); assert.equal(r.status, 200); assert.equal(readGroups(cfg)[0].draft, long);
    const j = await (await fetch(base + '/api/research/ideas')).json(); assert.deepEqual(j.groups.map(g => [g.id, g.count, g.hasDraft]), [[groupId, 2, true]]);
    const g = await (await fetch(base + '/api/research/group?id=' + groupId)).json(); assert.deepEqual([g.members.length, g.group.draft === long, g.remote], [2, true, false]);
    assert.equal((await fetch(base + '/api/research/group?id=group-nope')).status, 404);
    assert.equal((await send({ type: 'set-group-draft', groupId, draft: 'x'.repeat(100001) })).status, 400);
  } finally { srv.close(); }
});
