#!/usr/bin/env node
// render-reel.mjs - render a Reel with HyperFrames to a new versioned file; never overwrites an earlier render.
//
// Usage:  node .claude/skills/create-reel/scripts/render-reel.mjs <project-folder> --draft|--final [--workers N]
//
// --draft  renders/<slug>-draft-vNNN.mp4 at draft quality, then quick checks only (ffprobe dimensions, fps,
//          duration, audio stream; full decode). Results in renders/<file>.qa/quick.json. No full QA.
// --final  renders/<slug>-candidate-vNNN.mp4 at final quality, then runs full QA (qa-reel.mjs) on that exact file.
//          Refused before rendering while any reel.json "direction" field (hook, coreClaim, heroBeat, motif, style) is empty.
//          A candidate becomes renders/final.mp4 only through approve-reel.mjs after a person approves it.
// Gate B: a new reel (reel.json "preflightRequired", or a schemaVersion 2 plan) renders neither a draft nor a candidate
// until a person has approved its creative preflight (preflight-reel.mjs) and the creative plan and script still match
// that approval. Timing, caption, layout and animation changes keep the approval. Legacy reels are not gated.
// Exit codes: 0 rendered and checks passed, 1 render or checks failed, 2 usage. A failed render or failed QA never
// touches renders/final.mp4 or any earlier render. Quality comes from the project's profile. Renders with --strict
// so lint errors stop it. Each render is appended to reel.json "renders" with its SHA-256 and the hash of the source
// it was rendered from (delivery-review.mjs), so a delivery review of the latest draft carries over to a candidate only
// when nothing changed in between. Before --final it says when QA will block on the delivery review; it never refuses.
// HyperFrames telemetry is disabled.
//
// Test hooks (tests only): REEL_STUDIO_RENDERER=<node script> replaces the HyperFrames CLI with the same arguments;
// REEL_STUDIO_QA_SCRIPT=<node script> replaces qa-reel.mjs. Both are announced loudly and recorded in reel.json.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { getProfile, hyperframes, readComposition, run, skillDir } from './lib.mjs';
import { probeChecks, decodeCheck, evaluate, makeCollector, sha256File, qaDirFor, writeJson, missingDirection, preflightStatus, readPreflightInputs } from './qa-core.mjs';
import { validateVisualPlan } from '../../short-form-edit/scripts/validate-plan.mjs';
import { REVIEW_FILE, deliveryReviewRow, projectSourceHash } from './delivery-review.mjs';

const args = process.argv.slice(2);
const kind = args.includes('--final') ? 'final' : args.includes('--draft') ? 'draft' : null;
if (!args[0] || args[0].startsWith('--') || !kind) {
  console.log('Usage: node .claude/skills/create-reel/scripts/render-reel.mjs <project-folder> --draft|--final [--workers N]');
  process.exit(args.includes('--help') ? 0 : 2);
}
const dir = resolve(args[0]);
const reelPath = join(dir, 'reel.json');
if (!existsSync(reelPath)) { console.error(`No reel.json in ${dir}. Create Reel projects with new-reel.mjs.`); process.exit(2); }
const reel = JSON.parse(readFileSync(reelPath, 'utf8'));
const profile = getProfile(reel.profile);
const wi = args.indexOf('--workers');
const workers = wi >= 0 ? args[wi + 1] : 'auto';
const label = kind === 'final' ? 'candidate' : 'draft';
// A candidate is a deliberate piece of work: its creative direction must be on record before it is rendered.
const undecided = kind === 'final' ? missingDirection(reel) : [];
if (undecided.length) {
  console.error(`Final render refused: reel.json "direction" is missing ${undecided.join(', ')}. Record the hook, core claim, hero beat, motif and style first (drafts do not need them).`);
  process.exit(1);
}
// Gate B before any render, draft or final: say exactly what needs reviewing, never a generic error.
{
  const inputs = readPreflightInputs(dir);
  const pre = preflightStatus({ reel, plan: inputs.plan, transcript: inputs.transcript, validate: validateVisualPlan });
  const problems = pre.required ? [...inputs.errors, ...pre.problems] : [];
  if (problems.length) {
    console.error(`Render refused: the creative preflight (Gate B) is not approved for this ${kind === 'final' ? 'final' : 'draft'}.`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(`Review it: npm run preflight-reel -- ${args[0]}`);
    console.error('Then show the person the report and stop. Record approval only after they explicitly approve the plan, in a later message.');
    process.exit(1);
  }
  for (const w of pre.warnings || []) console.warn(`Preflight note: ${w}`);
}
const hooks = { renderer: process.env.REEL_STUDIO_RENDERER || null, qa: process.env.REEL_STUDIO_QA_SCRIPT || null };
for (const [k, v] of Object.entries(hooks)) if (v) console.warn(`TEST HOOK ACTIVE: ${k} = ${v}`);

const rendersDir = join(dir, 'renders');
mkdirSync(rendersDir, { recursive: true });
const pattern = new RegExp(`^${reel.slug}-${label}-v(\\d{3})\\.mp4$`);
const taken = readdirSync(rendersDir).map(f => (f.match(pattern) || [])[1]).filter(Boolean).map(Number);
const version = String((taken.length ? Math.max(...taken) : 0) + 1).padStart(3, '0');
const file = `${reel.slug}-${label}-v${version}.mp4`;
const out = join(rendersDir, file);
if (existsSync(out)) { console.error(`Refusing to overwrite ${file}`); process.exit(1); }

// Creative execution review (create-reel step 9): a candidate is verified only when the delivery review judged the
// latest render of this same source and every scene delivered. Say so before spending a final render; do not refuse.
const sourceHash = projectSourceHash(dir, { profile });
if (kind === 'final') {
  const inputs = readPreflightInputs(dir);
  const reviewPath = join(dir, REVIEW_FILE);
  if (preflightStatus({ reel, plan: inputs.plan, transcript: inputs.transcript, validate: validateVisualPlan }).required) {
    const renders = [...(reel.renders || []), { file: `renders/${file}`, sourceHash }];
    const [, , status, detail] = deliveryReviewRow({ text: existsSync(reviewPath) ? readFileSync(reviewPath, 'utf8') : null, plan: inputs.plan,
      render: `renders/${file}`, renders, candidate: true, required: true });
    if (status !== 'PASS') console.warn(`Delivery review: QA will block this candidate (${status}): ${detail}`);
  }
}

const quality = kind === 'final' ? profile.finalQuality : profile.draftQuality;
console.log(`Rendering ${file} (${quality}, ${profile.width}x${profile.height} @ ${profile.fps} fps, workers ${workers})`);
const renderArgs = ['render', '--quality', quality, '--fps', String(profile.fps), '--workers', String(workers), '--strict', '--quiet', '--output', `renders/${file}`];
const r = hooks.renderer ? run(process.execPath, [hooks.renderer, ...renderArgs], { cwd: dir, stdio: 'inherit' }) : hyperframes(renderArgs, { cwd: dir, stdio: 'inherit' });
if (r.status !== 0 || !existsSync(out)) { console.error(`Render failed (exit ${r.status}). renders/final.mp4 and earlier renders are unchanged.`); process.exit(1); }

const sha256 = await sha256File(out);
reel.renders = reel.renders || [];
reel.renders.push({ file: `renders/${file}`, kind: label, version: Number(version), quality, fps: profile.fps, sha256, sourceHash, renderedAt: new Date().toISOString(), ...(hooks.renderer || hooks.qa ? { testHooks: hooks } : {}) });
writeFileSync(reelPath, JSON.stringify(reel, null, 2) + '\n');
console.log(`Rendered ${basename(dir)}/renders/${file} (SHA-256 ${sha256.slice(0, 12)})`);

if (kind === 'draft') {
  // Lightweight checks: is it a decodable MP4 of the right shape and length? Full QA is for candidates.
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const comp = readComposition(html);
  const { results, add } = makeCollector();
  const p = run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', out]);
  let probe = null; try { probe = JSON.parse(p.stdout); } catch {}
  const expectsAudio = reel.mode === 'footage' || /<audio\b/i.test(html);
  for (const row of probeChecks(probe, { width: comp.width, height: comp.height, fps: profile.fps, duration: comp.duration, audio: expectsAudio })) add(...row);
  add(...decodeCheck(run('ffmpeg', ['-v', 'error', '-xerror', '-i', out, '-f', 'null', '-'])));
  const ev = evaluate(results, { scope: 'draft' });
  const qaDir = qaDirFor(dir, out);
  mkdirSync(qaDir, { recursive: true });
  writeJson(join(qaDir, 'quick.json'), { render: `renders/${file}`, level: 'draft quick checks', sha256, checkedAt: new Date().toISOString(), ...ev, results });
  for (const x of results) console.log(`${x.status.padEnd(14)} [${x.area}] ${x.check}: ${x.detail}`);
  console.log(`Draft quick checks ${ev.passed ? 'PASS' : 'FAIL'}: ${ev.verdict} (not full QA; drafts are never eligible for approval).`);
  console.log(`Full QA on this draft if you want it: npm run qa:reel -- ${args[0]} --render renders/${file}`);
  process.exit(ev.passed ? 0 : 1);
}

// Final: full QA on this exact candidate.
const qaScript = hooks.qa || join(skillDir, 'scripts/qa-reel.mjs');
console.log(`Running full QA on renders/${file}`);
const q = run(process.execPath, [qaScript, dir, '--render', `renders/${file}`], { stdio: 'inherit' });
if (q.status === 0) {
  console.log(`Stage 1 passed: renders/${file} is technically verified. See ${basename(dir)}/QA.md.`);
  console.log('Stage 2: watch and listen to it, then approve it explicitly (approve-reel.mjs). Nothing is promoted automatically.');
  process.exit(0);
}
console.error(`Stage 1 blocked (QA exit ${q.status}). renders/${file} and its QA folder are kept for debugging; renders/final.mp4 is unchanged.`);
process.exit(1);
