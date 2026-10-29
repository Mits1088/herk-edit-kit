#!/usr/bin/env node
// approve-reel.mjs - Stage 2: promote ONE technically verified candidate to renders/final.mp4 after a person approved it.
//
// Usage:  node .claude/skills/create-reel/scripts/approve-reel.mjs <project-folder> --candidate renders/<slug>-candidate-vNNN.mp4
//                                                                   --sha <first 12+ hex of its SHA-256> --approved-by "<name>" [--note "..."]
//
// Run it only after the person has watched and listened to that candidate and said so explicitly. A passing Stage 1 is
// never approval. The --sha prefix identifies the file the person reviewed; it is not proof of approval.
// Refuses unless: the file is a candidate; its OWN qa.json (renders/<candidate>.qa/qa.json) names this file, holds a full
// SHA-256 and says technically verified; the prefix matches that hash; the file still hashes to it right now.
// Promotion is copy -> verify -> archive previous final (copy, verified) -> atomic rename -> verify. Any failure leaves
// renders/final.mp4 as it was. Approval is written into that candidate's qa.json, reel.json "approvals" and QA.md.
// For modes other than footage, reel.json "requireHumanApproval": false lets --approved-by be omitted; the promotion
// is still an explicit command and is recorded as "promoted-without-human-approval".
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isCandidateFile, recordPathFor, sha256File, humanApprovalRequired, promote, readJson, writeJson, writeProjectSummary, qaDirFor, HUMAN_CHECKLIST } from './qa-core.mjs';

export async function approveCandidate(dir, { candidate, sha, approvedBy, note = '', copy } = {}) {
  dir = resolve(dir);
  const reelPath = join(dir, 'reel.json');
  if (!existsSync(reelPath)) throw new Error(`No reel.json in ${dir}.`);
  const reel = readJson(reelPath);
  if (!candidate) throw new Error('--candidate is required: name the exact file that was reviewed.');
  const file = resolve(dir, candidate);
  const rel = relative(dir, file).replaceAll('\\', '/');
  if (!isCandidateFile(file, reel.slug)) throw new Error(`${rel} is not a candidate (${reel.slug}-candidate-vNNN.mp4). Drafts cannot be approved.`);
  if (!existsSync(file)) throw new Error(`Candidate not found: ${rel}`);
  const recordPath = recordPathFor(dir, file);
  if (!existsSync(recordPath)) throw new Error(`No QA record for ${rel}. Run full QA on this candidate first.`);
  const record = readJson(recordPath);
  if (record.render !== rel || !record.candidate) throw new Error(`The QA record in ${relative(dir, recordPath)} is for ${record.render}, not ${rel}.`);
  if (!/^[a-f0-9]{64}$/.test(record.sha256 || '')) throw new Error('The QA record has no full SHA-256 for this candidate.');
  if (!record.technicallyVerified) throw new Error(`${rel} did not pass Stage 1: ${(record.blocking || []).map(r => `${r.status} ${r.check}`).join('; ') || 'not verified'}.`);
  if (record.approval?.status === 'approved') throw new Error(`${rel} was already approved at ${record.approval.approvedAt}.`);
  if (!/^[a-f0-9]{12,64}$/i.test(sha || '')) throw new Error('--sha needs at least the first 12 hex characters of the candidate hash shown in QA.md.');
  if (!record.sha256.startsWith(sha.toLowerCase())) throw new Error(`--sha ${sha} does not match the QA-verified hash ${record.sha256.slice(0, 12)} of ${rel}.`);
  const needHuman = humanApprovalRequired(reel);
  if (needHuman && !String(approvedBy || '').trim()) throw new Error('--approved-by is required: this project needs explicit human approval.');
  // Re-hash immediately before promotion: the file must be the one QA verified.
  const now = await sha256File(file);
  if (now !== record.sha256) throw new Error(`${rel} changed after QA (now ${now.slice(0, 12)}, verified ${record.sha256.slice(0, 12)}). Run QA again on a new candidate.`);

  const at = new Date();
  const result = await promote(dir, file, record.sha256, { copy, now: at });
  const approval = needHuman || approvedBy
    ? { status: 'approved', approvedBy: String(approvedBy).trim(), approvedAt: at.toISOString(), sha256: record.sha256, note, checklist: reel.mode === 'footage' ? HUMAN_CHECKLIST : HUMAN_CHECKLIST.filter(x => !/speech|Voice/.test(x)) }
    : { status: 'promoted-without-human-approval', approvedAt: at.toISOString(), sha256: record.sha256, note, reason: 'reel.json requireHumanApproval is false' };
  approval.promotedTo = 'renders/final.mp4';
  if (result.archived) approval.previousFinalArchivedAs = result.archived.replaceAll('\\', '/');
  record.approval = approval;
  writeJson(recordPath, record);
  const qaMd = join(qaDirFor(dir, file), 'QA.md');
  if (existsSync(qaMd)) writeFileSync(qaMd, readFileSync(qaMd, 'utf8').replace(/^- Stage 2, human creative approval: .*$/m, `- Stage 2, human creative approval: ${approval.status === 'approved' ? `APPROVED by ${approval.approvedBy} at ${approval.approvedAt}` : 'not required by project settings'}`));
  reel.approvals = reel.approvals || [];
  reel.approvals.push({ candidate: rel, ...approval });
  writeFileSync(reelPath, JSON.stringify(reel, null, 2) + '\n');
  writeProjectSummary(dir, record, relative(dir, qaMd).replaceAll('\\', '/'));
  return { candidate: rel, sha256: record.sha256, final: 'renders/final.mp4', archived: approval.previousFinalArchivedAs || null, approval };
}

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help') { o.help = true; continue; }
    if (a.startsWith('--')) { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`); o[a.slice(2).replace(/-(\w)/g, (m, c) => c.toUpperCase())] = v; i++; }
    else o._.push(a);
  }
  return o;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const o = parseArgs(process.argv.slice(2));
    if (!o._[0] || o.help) {
      console.log('Usage: node .claude/skills/create-reel/scripts/approve-reel.mjs <project-folder> --candidate renders/<file>.mp4 --sha <12+ hex> --approved-by "<name>" [--note "..."]');
      process.exit(o.help ? 0 : 2);
    }
    const r = await approveCandidate(o._[0], o);
    console.log(`Approved ${r.candidate} (${r.sha256.slice(0, 12)}) -> ${r.final}${r.archived ? `; previous final kept as ${r.archived}` : ''}.`);
    console.log(`Recorded in ${basename(r.candidate, '.mp4')}.qa/qa.json, reel.json and QA.md.`);
  } catch (e) { console.error(`Not approved: ${e.message}`); process.exit(1); }
}
