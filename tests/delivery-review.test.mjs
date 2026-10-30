// Delivery review (create-reel step 9): the intent-sheet frame picks, Gate B keyframe lookup, the review record's
// coverage, verdicts and freshness, the source hash that carries a draft's review to a candidate, and that the row
// blocks Stage 1 through the shared rule. Every test writes only to its own temporary folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  intentFrames, motionFrames, motionSheetHtml, findKeyframes, intentSheetHtml, parseDeliveryReview, copiedFromIntent, reviewFreshness, deliveryReviewRow,
  projectSourceHash, fileRefs,
} from '../.claude/skills/create-reel/scripts/delivery-review.mjs';
import { makeCollector, evaluate } from '../.claude/skills/create-reel/scripts/qa-core.mjs';
import { facelessPlan, footagePlan, deliveryReviewText } from './fixtures/visual-plans.mjs';

const scratch = (p) => mkdtempSync(join(tmpdir(), `delivery-review-${p}-`));
const SHA_D = 'aaaaaaaaaaaa' + '0'.repeat(52), SHA_C = 'cccccccccccc' + '0'.repeat(52);
const draft = 'renders/r-draft-v001.mp4', cand = 'renders/r-candidate-v001.mp4';
const renders = (draftSrc = 'src1', candSrc = 'src1') => [
  { file: draft, kind: 'draft', sha256: SHA_D, sourceHash: draftSrc },
  { file: cand, kind: 'candidate', sha256: SHA_C, sourceHash: candSrc },
];
const row = (text, extra = {}) => deliveryReviewRow({ text, plan: facelessPlan(), render: cand, sha: SHA_C, renders: renders(), candidate: true, required: true, ...extra });
const blocks = r => { const { results, add } = makeCollector(); add(...r); return !evaluate(results).passed; };

// ---------- intent sheet
test('intent frames: last planned event of each scene, settled; midpoint without one; clamped inside scene and film', () => {
  const plan = facelessPlan(2);
  plan.events.push({ time: 0.3, type: 'second-fold', visual: 's01' });
  const [a, b] = intentFrames(plan, { fps: 30, duration: 2 });
  assert.equal(a.event, 'second-fold'); assert.equal(a.frame, Math.round(0.7 * 30)); // 0.3 + 0.4 settle
  assert.equal(b.event, 'land'); assert.equal(b.frame, Math.round(1.4 * 30));
  assert.match(a.intent, /folds itself/);
  const bare = intentFrames({ scenes: [{ id: 'x', start: 0, end: 3, visualPurpose: 'performance', holdReason: 'the face carries it' }] }, { fps: 30, duration: 3 });
  assert.equal(bare[0].frame, 45); assert.equal(bare[0].event, null); assert.match(bare[0].intent, /performance: the face carries it/);
  // An event near the end of a short scene settles no further than two frames before the cut.
  const tight = intentFrames({ scenes: [{ id: 'y', start: 0, end: 0.5 }], events: [{ time: 0.45, visual: 'y' }] }, { fps: 30, duration: 0.5 });
  assert.equal(tight[0].frame, Math.round(0.45 * 30));
  assert.ok(intentFrames({ scenes: [{ id: 'z', start: 9, end: 12 }] }, { fps: 30, duration: 10 })[0].frame <= 299, 'never past the last frame');
});

test('motion frames: each scene from its first to its last frame, about every 0.4 s (4-12), planned events added and marked', () => {
  const plan = facelessPlan(2);
  const [a, b] = motionFrames(plan, { fps: 30, duration: 2 });
  assert.equal(a.frames[0].frame, 0); assert.equal(a.frames.at(-1).frame, 29, 'ends on the scene\'s last frame, not the next scene\'s first');
  assert.equal(b.frames[0].frame, 30); assert.equal(b.frames.at(-1).frame, 59);
  assert.ok(a.frames.length >= 4 && a.frames.every((f, i) => !i || f.frame > a.frames[i - 1].frame), 'in time order, no duplicates');
  assert.equal(a.frames.find(f => f.frame === 0).event, 'fold', 'the planned event is marked');
  const long = motionFrames({ scenes: [{ id: 'l', start: 0, end: 20 }] }, { fps: 30, duration: 20 })[0];
  assert.equal(long.frames.length, 12, 'capped');
  const ev = motionFrames({ scenes: [{ id: 'e', start: 0, end: 4 }], events: [{ time: 1.23, type: 'crack', visual: 'e' }] }, { fps: 30, duration: 4 })[0];
  assert.ok(ev.frames.some(f => f.frame === 37 && f.event === 'crack'), 'an event between strip frames gets its own frame');
  const html = motionSheetHtml([{ ...ev, frames: ev.frames.map(f => ({ ...f, frameUrl: 'file:///x.jpg' })) }], { title: 't<' });
  assert.match(html, /t&lt;/); assert.match(html, /class="ev"/); assert.match(html, /Stills, not full-speed viewing/);
});

test('Gate B keyframes are found by scene id, never by prefix of another id', () => {
  const dir = scratch('kf');
  assert.deepEqual(findKeyframes(dir, ['s01']), {}, 'no keyframes folder');
  mkdirSync(join(dir, 'keyframes'));
  for (const f of ['s01.png', 's02-hero.jpg', 's010.png', 'notes.txt']) writeFileSync(join(dir, 'keyframes', f), 'x');
  assert.deepEqual(findKeyframes(dir, ['s01', 's02', 's03']), { s01: 'keyframes/s01.png', s02: 'keyframes/s02-hero.jpg' });
});

test('intent sheet page: escapes text, pairs keyframes, labels exist on the sheet only', () => {
  const items = [{ id: 's01', start: 0, end: 1, t: 0.4, event: 'fold', intent: 'A <list> & "card"', frameUrl: 'file:///a.jpg', keyframeUrl: 'file:///k.png' },
    { id: 's02', start: 1, end: 2, t: 1.4, event: null, intent: '', frameUrl: 'file:///b.jpg' }];
  const html = intentSheetHtml(items, { title: 'demo' });
  assert.match(html, /A &lt;list&gt; &amp; &quot;card&quot;/);
  assert.match(html, /Gate B keyframe/); assert.match(html, /no keyframe/); assert.match(html, /no visual intent in the plan/);
  assert.match(html, /grid-template-columns:repeat\(2,/, 'paired cards: two per row');
  const many = Array.from({ length: 6 }, (_, k) => ({ ...items[1], id: `s0${k}` }));
  assert.match(intentSheetHtml(many), /grid-template-columns:repeat\(4,360px\)/, 'unpaired: four phone-width frames per row');
  assert.match(intentSheetHtml([items[1]]), /grid-template-columns:repeat\(1,360px\)/, 'never wider than the scenes it shows');
});

// ---------- the review record
test('a complete review of this candidate passes; it parses render, hash, rows and notes', () => {
  const text = deliveryReviewText(facelessPlan(), { render: cand, sha: SHA_C });
  const r = parseDeliveryReview(text);
  assert.equal(r.render, cand); assert.equal(r.sha, SHA_C.slice(0, 12));
  assert.deepEqual(Object.keys(r.scenes), ['s01', 's02']); assert.equal(r.scenes.s01.verdict, 'delivered');
  assert.match(r.notes.silhouettes, /different shape/);
  const out = row(text);
  assert.equal(out[2], 'PASS', out[3]); assert.equal(out[4].required, true);
  assert.match(out[3], /not that its judgement is right/);
  assert.equal(blocks(out), false);
});

test('missing file or section: NOT TESTED and blocking for a candidate of a gated reel', () => {
  for (const text of [null, '# Entertainment review\n\n| t | finding |\n| --- | --- |\n| 1 | slow |\n']) {
    const out = row(text);
    assert.equal(out[2], 'NOT TESTED', out[3]); assert.ok(blocks(out));
    assert.match(out[3], /step 9/);
  }
});

test('a scene without a verdict, an unknown verdict or a scene not in the plan is incomplete', () => {
  const plan = facelessPlan();
  let out = row(deliveryReviewText(plan, { render: cand, sha: SHA_C, skip: ['s02'] }));
  assert.equal(out[2], 'NOT TESTED'); assert.match(out[3], /s02: no verdict/); assert.ok(blocks(out));
  out = row(deliveryReviewText(plan, { render: cand, sha: SHA_C, verdicts: { s01: 'fine' } }));
  assert.match(out[3], /s01: verdict "fine" is not delivered, partial or missing/);
  out = row(deliveryReviewText(plan, { render: cand, sha: SHA_C }).replace('| s02 |', '| s09 |'));
  assert.match(out[3], /s02: no verdict.*scenes not in the plan: s09/);
});

test('a partial or missing scene FAILs the candidate and names the rebuild', () => {
  for (const v of ['partial', 'missing']) {
    const out = row(deliveryReviewText(facelessPlan(), { render: cand, sha: SHA_C, verdicts: { s02: v } }));
    assert.equal(out[2], 'FAIL', out[3]); assert.ok(blocks(out));
    assert.match(out[3], new RegExp(`s02 ${v} \\(rebuild it\\)`)); assert.match(out[3], /render a new draft and review again/);
  }
  // On a draft the same finding is a WARNING: drafts are where the rebuild happens.
  const d = deliveryReviewRow({ text: deliveryReviewText(facelessPlan(), { render: draft, sha: SHA_D, verdicts: { s01: 'partial' } }), plan: facelessPlan(), render: draft, sha: null, renders: renders(), candidate: false, required: false });
  assert.equal(d[2], 'WARNING'); assert.equal(d[4].required, false);
});

test('box-ticking is refused: one-word descriptions, the intent pasted back, missing silhouette or slide notes', () => {
  const plan = facelessPlan();
  let out = row(deliveryReviewText(plan, { render: cand, sha: SHA_C, seen: { s01: 'looks good' } }));
  assert.equal(out[2], 'NOT TESTED'); assert.match(out[3], /s01: describe what the frame shows/);
  out = row(deliveryReviewText(plan, { render: cand, sha: SHA_C, seen: { s02: plan.scenes[1].visualIntent } }));
  assert.match(out[3], /s02: the description repeats the approved intent/);
  out = row(deliveryReviewText(plan, { render: cand, sha: SHA_C, notes: false }));
  assert.match(out[3], /"Modality:" needs a sentence.*"Silhouettes:" needs a sentence.*"Slide test:" needs a sentence/);
  // Motion is judged per scene, from the strip: an empty or pasted motion note is refused, and so is a table without it.
  out = row(deliveryReviewText(plan, { render: cand, sha: SHA_C, motion: { s01: '' } }));
  assert.match(out[3], /s01: describe what moves or changes across its motion strip/);
  out = row(deliveryReviewText(plan, { render: cand, sha: SHA_C, motion: { s02: plan.scenes[1].visualIntent } }));
  assert.match(out[3], /s02: the motion note repeats the approved intent/);
  out = row(deliveryReviewText(plan, { render: cand, sha: SHA_C, motion: { s01: 'holds still on the face' } }));
  assert.equal(out[2], 'PASS', 'stillness described is an answer');
  out = row(deliveryReviewText(plan, { render: cand, sha: SHA_C }).replace('| Motion (strip) |', '| Notes |'));
  assert.match(out[3], /needs Scene, Seen, Motion and Verdict columns/);
  assert.doesNotMatch(out[3], /Keyframes/, 'no keyframe note is needed when no keyframes exist');
  out = row(deliveryReviewText(plan, { render: cand, sha: SHA_C }).replace(/^Keyframes:.*$/m, ''), { keyframes: { s01: 'keyframes/s01.png' } });
  assert.match(out[3], /"Keyframes:" needs a sentence/);
  assert.equal(copiedFromIntent('a dark code panel with one typed line and no lamp', plan.scenes[0].visualIntent), false);
  assert.equal(copiedFromIntent('A long to-do list folds itself into one card on "fail"', plan.scenes[0].visualIntent), true);
});

test('freshness: a review of the draft carries to a candidate only from the same source; otherwise it is stale', () => {
  const plan = facelessPlan();
  const ofDraft = deliveryReviewText(plan, { render: draft, sha: SHA_D });
  let out = row(ofDraft);
  assert.equal(out[2], 'PASS', out[3]); assert.match(out[3], /r-draft-v001\.mp4 \(same source as this render\)/);
  out = row(ofDraft, { renders: renders('src1', 'src2') });
  assert.equal(out[2], 'NOT TESTED'); assert.match(out[3], /stale: the source changed between r-draft-v001\.mp4 and r-candidate-v001\.mp4/); assert.ok(blocks(out));
  out = row(ofDraft, { renders: [{ file: draft, sha256: SHA_D }, { file: cand, sha256: SHA_C }] });
  assert.match(out[3], /stale: no source hash recorded/, 'renders from before source hashing never carry a review');
  // An older render, not the one just before the candidate.
  const three = [{ file: draft, sha256: SHA_D, sourceHash: 's' }, { file: 'renders/r-draft-v002.mp4', sha256: 'b'.repeat(64), sourceHash: 's' }, { file: cand, sha256: SHA_C, sourceHash: 's' }];
  out = row(ofDraft, { renders: three });
  assert.match(out[3], /stale: it judged r-draft-v001\.mp4, but the latest render before this one is r-draft-v002\.mp4/);
  // The right file name with the wrong hash: a different render under the same name.
  out = row(deliveryReviewText(plan, { render: cand, sha: 'dddddddddddd' }));
  assert.match(out[3], /stale: it names r-candidate-v001\.mp4 with SHA-256 dddddddddddd, but this file is cccccccccccc/);
  assert.equal(reviewFreshness(parseDeliveryReview(''), { render: cand }).fresh, false);
  // A draft QA run (no file hash computed) checks the name against reel.json's log.
  const d = deliveryReviewRow({ text: ofDraft, plan, render: draft, sha: null, renders: renders(), candidate: false });
  assert.equal(d[2], 'PASS', d[3]);
});

test('legacy reels and plans without scenes are not gated', () => {
  const legacy = deliveryReviewRow({ text: null, plan: facelessPlan(), render: cand, sha: SHA_C, renders: [], candidate: true, required: false });
  assert.equal(legacy[2], 'NOT APPLICABLE'); assert.equal(blocks(legacy), false);
  assert.equal(deliveryReviewRow({ text: null, plan: null, render: cand, required: false })[2], 'NOT APPLICABLE');
  assert.equal(deliveryReviewRow({ text: null, plan: { scenes: [] }, render: cand, required: true })[2], 'NOT TESTED', 'a gated candidate with no scenes cannot be reviewed');
});

test('Mode B: performance scenes are reviewed too (the face carries them)', () => {
  const plan = footagePlan();
  const text = deliveryReviewText(plan, { render: cand, sha: SHA_C, seen: { [plan.scenes[0].id]: 'the speaker fills the frame, eyes to lens, the hook in captions' } });
  const out = deliveryReviewRow({ text, plan, render: cand, sha: SHA_C, renders: renders(), candidate: true, required: true });
  assert.equal(out[2], 'PASS', out[3]);
});

// ---------- what was rendered
test('source hash: changes with the composition and assets, not with records, reviews, renders or keyframes', () => {
  const dir = scratch('src');
  for (const d of ['assets', 'compositions', 'renders', 'keyframes', 'archive']) mkdirSync(join(dir, d));
  writeFileSync(join(dir, 'index.html'), '<div id="r"></div>');
  writeFileSync(join(dir, 'assets/plate.png'), 'png');
  const h0 = projectSourceHash(dir);
  writeFileSync(join(dir, 'reel.json'), '{"renders":[1]}');
  writeFileSync(join(dir, 'ENTERTAINMENT-REVIEW.md'), '## Delivery review');
  writeFileSync(join(dir, 'QA.md'), 'x');
  writeFileSync(join(dir, 'renders/r-draft-v001.mp4'), 'mp4');
  writeFileSync(join(dir, 'keyframes/s01.png'), 'k');
  writeFileSync(join(dir, 'archive/old.html'), 'old');
  assert.equal(projectSourceHash(dir), h0, 'records and outputs leave it unchanged');
  writeFileSync(join(dir, 'compositions/s01.html'), '<div></div>');
  const h1 = projectSourceHash(dir);
  assert.notEqual(h1, h0, 'a new composition changes it');
  writeFileSync(join(dir, 'index.html'), '<div id="r" class="x"></div>');
  assert.notEqual(projectSourceHash(dir), h1, 'an edited composition changes it');
  const h2 = projectSourceHash(dir);
  writeFileSync(join(dir, 'assets/plate.png'), 'png, regenerated and larger');
  assert.notEqual(projectSourceHash(dir), h2, 'a replaced asset changes it');
  const h3 = projectSourceHash(dir);
  writeFileSync(join(dir, 'assets/plate.png'), 'png, regenerated and LARGER'); // same size; content differs
  utimesSync(join(dir, 'assets/plate.png'), new Date(2020, 0, 1), new Date(2020, 0, 1));
  assert.notEqual(projectSourceHash(dir), h3, 'a same-size asset with an old timestamp is still caught (content hash)');
  const h4 = projectSourceHash(dir);
  mkdirSync(join(dir, 'a/b/c/d/e/f/g'), { recursive: true });
  writeFileSync(join(dir, 'a/b/c/d/e/f/g/deep.css'), 'x{}');
  assert.notEqual(projectSourceHash(dir), h4, 'no depth limit');
});

test('source hash: files referenced outside the project, the profile and the HyperFrames version are render inputs', () => {
  const root = scratch('ext'), dir = join(root, 'project'), media = join(root, 'media');
  mkdirSync(dir); mkdirSync(media);
  writeFileSync(join(media, 'take.mp4'), 'take one');
  writeFileSync(join(media, 'bg.png'), 'bg');
  writeFileSync(join(dir, 'index.html'), '<video src="../media/take.mp4" muted></video><div style="background:url(\'../media/bg.png\')"></div><img src="https://example.com/x.png"><a href="#top"></a>');
  const opts = { profile: { name: 'organic', width: 1080, height: 1920, fps: 30 }, hyperframesVersion: '1.0.0' };
  const h0 = projectSourceHash(dir, opts);
  assert.equal(projectSourceHash(dir, opts), h0, 'stable');
  writeFileSync(join(media, 'take.mp4'), 'take two');
  const h1 = projectSourceHash(dir, opts);
  assert.notEqual(h1, h0, 'replaced external footage changes it');
  writeFileSync(join(media, 'bg.png'), 'bg2');
  const h2 = projectSourceHash(dir, opts);
  assert.notEqual(h2, h1, 'an external CSS url() asset changes it');
  assert.notEqual(projectSourceHash(dir, { ...opts, profile: { ...opts.profile, fps: 60 } }), h2, 'the profile frame rate changes it');
  assert.notEqual(projectSourceHash(dir, { ...opts, hyperframesVersion: '1.0.1' }), h2, 'the HyperFrames version changes it');
  rmSync(join(media, 'bg.png'));
  assert.notEqual(projectSourceHash(dir, opts), h2, 'a referenced file going missing changes it');
  assert.deepEqual(fileRefs('<img src="a.png?v=2"> <a href="https://x/y.css"> url(data:image/png;base64,AA) url( "b.woff2" ) <use href="#i">'), ['a.png', 'b.woff2']);
});
