#!/usr/bin/env node
// preflight-reel.mjs - Gate B, the creative preflight: validate a new reel's creative plan, print its fingerprint and the
// facts the person needs to approve it, and (with --approve) record that person's explicit approval.
//
// Usage:  node .claude/skills/create-reel/scripts/preflight-reel.mjs <project-folder> [--json]
//         node .claude/skills/create-reel/scripts/preflight-reel.mjs <project-folder> --approve --fingerprint <12+ hex>
//                --approved-by "<name>" [--paid-provider <name> --spend-limit "<limit>" [--max-calls N]] [--note "..."]
//
// Without --approve it only reads: it checks assets/plan.json (schemaVersion 2) at the preflight stage (no asset files
// needed yet), and reports the fingerprint, simulated and authentic scenes, planned paid assets and planned callbacks.
// --approve re-runs that check and writes reel.json "preflight" only when the plan is valid and the --fingerprint prefix
// matches the plan the person reviewed. Run it only after the person approved in a later message than the report, never
// on the agent's own judgement. It is a workflow safeguard, not proof of who approved: anyone who can edit the project
// can run it. Paid generation is not approved unless --paid-provider and --spend-limit are given.
// Exit codes: 0 valid (or approved), 1 invalid or refused, 2 usage.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { kitRoot } from './lib.mjs';
import { preflightStatus, readPreflightInputs } from './qa-core.mjs';
import { validateVisualPlan } from '../../short-form-edit/scripts/validate-plan.mjs';

const BOOL = new Set(['approve', 'json', 'help']);
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const key = a.slice(2).replace(/-(\w)/g, (m, c) => c.toUpperCase());
    if (BOOL.has(key)) { o[key] = true; continue; }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
    o[key] = v; i++;
  }
  return o;
}

export function preflightReport(dir) {
  dir = resolve(dir);
  const reelPath = join(dir, 'reel.json');
  if (!existsSync(reelPath)) throw new Error(`No reel.json in ${dir}. Create Reel projects with new-reel.mjs.`);
  const reel = JSON.parse(readFileSync(reelPath, 'utf8'));
  const inputs = readPreflightInputs(dir);
  const status = preflightStatus({ reel, plan: inputs.plan, transcript: inputs.transcript, validate: validateVisualPlan });
  // The plan's own validity, separate from whether it is approved yet.
  const errors = [...inputs.errors, ...(status.validation?.errors || []), ...status.problems.filter(p => /^no assets\/plan|schema \d|^assets\//.test(p))];
  return { dir, reel, plan: inputs.plan, status, errors: [...new Set(errors)] };
}

export function approvePreflight(dir, { fingerprint, approvedBy, paidProvider, spendLimit, maxCalls, note = '' } = {}) {
  const r = preflightReport(dir);
  if (!r.status.required) throw new Error('This reel does not use the creative preflight (legacy project: no preflightRequired and no schemaVersion 2 plan).');
  if (r.errors.length) throw new Error(`the creative plan is not valid yet: ${r.errors.slice(0, 6).join('; ')}`);
  if (!/^[a-f0-9]{12,64}$/i.test(fingerprint || '')) throw new Error('--fingerprint needs at least the first 12 hex characters printed by preflight-reel for the plan the person reviewed.');
  if (!r.status.fingerprint.startsWith(fingerprint.toLowerCase())) throw new Error(`--fingerprint ${fingerprint} does not match the current plan (${r.status.fingerprint.slice(0, 12)}). The plan changed after the report; show the person the current report.`);
  if (!String(approvedBy || '').trim()) throw new Error('--approved-by is required: name the person who approved the creative plan.');
  if (!!paidProvider !== !!spendLimit) throw new Error('Paid generation needs both --paid-provider and --spend-limit, or neither.');
  if (maxCalls !== undefined && !(Number(maxCalls) > 0)) throw new Error('--max-calls must be a positive number.');
  const reel = r.reel, previous = reel.preflight;
  reel.preflight = {
    status: 'approved',
    approvedBy: String(approvedBy).trim(),
    approvedAt: new Date().toISOString(),
    fingerprint: r.status.fingerprint,
    snapshot: r.status.snapshot,
    scriptWords: r.status.words,
    paidScope: paidProvider ? { provider: paidProvider, spendLimit, ...(maxCalls !== undefined ? { maxCalls: Number(maxCalls) } : {}) } : null,
    note,
    safeguard: 'Workflow record of an explicit approval; not proof of identity.',
  };
  if (previous?.status === 'approved') (reel.preflightHistory ||= []).push(previous);
  writeFileSync(join(r.dir, 'reel.json'), JSON.stringify(reel, null, 2) + '\n');
  return reel.preflight;
}

function printReport(r) {
  const { plan, status } = r, v = status.validation, m = v?.metrics || {};
  const scenes = plan?.scenes || [];
  console.log(`Creative preflight (Gate B): ${relative(process.cwd(), r.dir) || '.'}`);
  if (!status.required) { console.log('Not required: legacy project (no preflightRequired, no schemaVersion 2 plan). Renders are not gated.'); return; }
  console.log(`Plan: ${r.errors.length ? `NOT VALID (${r.errors.length} problem(s))` : 'valid at the preflight stage (asset files are checked later, in production QA)'}`);
  for (const e of r.errors) console.log(`  - ${e}`);
  for (const w of status.warnings) console.log(`  ! ${w}`);
  if (status.fingerprint) console.log(`Fingerprint: ${status.fingerprint.slice(0, 12)} (full ${status.fingerprint})`);
  if (scenes.length) {
    console.log('\nScenes (what the viewer sees):');
    for (const s of scenes) console.log(`  ${s.id} ${Number(s.start).toFixed(2)}-${Number(s.end).toFixed(2)} s  ${s.visualPurpose ?? '?'} / ${s.brollMode ?? '?'} / ${s.evidenceType ?? '?'}${s.visualIntent ? `: ${s.visualIntent}` : ''}${s.asset?.whyThis ? `\n      why this: ${s.asset.whyThis}` : ''}`);
  }
  console.log(`\nAuthentic: ${m.authenticScenes?.join(', ') || 'none'}`);
  console.log(`Simulated (not real evidence): ${m.simulatedScenes?.join(', ') || 'none'}`);
  console.log(`Paid assets planned: ${m.paidAssets?.join(', ') || 'none'}${m.paidAssets?.length ? ` (approved scope: ${r.reel.preflight?.paidScope ? JSON.stringify(r.reel.preflight.paidScope) : 'none; ask for a provider and spending limit'})` : ''}`);
  console.log(`Planned callbacks (declared, not verified as rendered transitions): ${(m.callbacks || []).map(c => `${c.from} -> ${c.to} ${c.motif}${c.element ? ` #${c.element}` : ''}${c.adjacent ? '' : ' (callback)'}`).join(', ') || 'none'}`);
  const approval = r.reel.preflight;
  console.log(`\nApproval: ${status.ok ? `APPROVED by ${approval.approvedBy} at ${approval.approvedAt}; the current plan matches` : approval?.status === 'approved' ? 'approved earlier, but no longer valid:' : 'not approved'}`);
  if (!status.ok) for (const p of status.problems) if (!r.errors.includes(p)) console.log(`  - ${p}`);
  if (!status.ok && !r.errors.length) {
    const arg = relative(kitRoot, r.dir).replaceAll('\\', '/');
    console.log(`\nAfter the person explicitly approves this plan (in a later message), record it:\n  npm run preflight-reel -- ${arg} --approve --fingerprint ${status.fingerprint.slice(0, 12)} --approved-by "<name>"`);
    console.log('  Add --paid-provider <name> --spend-limit "<limit>" only if they approved paid generation too.');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (!o._[0] || o.help) {
    console.log('Usage: node .claude/skills/create-reel/scripts/preflight-reel.mjs <project-folder> [--json] | --approve --fingerprint <12+ hex> --approved-by "<name>" [--paid-provider <p> --spend-limit "<limit>" [--max-calls N]]');
    process.exit(o.help ? 0 : 2);
  }
  try {
    if (o.approve) {
      const p = approvePreflight(o._[0], o);
      console.log(`Creative preflight approved by ${p.approvedBy} (${p.fingerprint.slice(0, 12)}). Paid generation: ${p.paidScope ? JSON.stringify(p.paidScope) : 'not approved'}.`);
      console.log('Recorded in reel.json "preflight". This is a workflow safeguard, not proof of identity.');
    } else {
      const r = preflightReport(o._[0]);
      if (o.json) console.log(JSON.stringify({ required: r.status.required, valid: !r.errors.length, approved: r.status.ok, errors: r.errors, problems: r.status.problems, warnings: r.status.warnings, fingerprint: r.status.fingerprint ?? null, metrics: r.status.validation?.metrics ?? null }, null, 2));
      else printReport(r);
      process.exitCode = r.errors.length ? 1 : 0;
    }
  } catch (e) { console.error(`Not approved: ${e.message}`); process.exit(1); }
}
