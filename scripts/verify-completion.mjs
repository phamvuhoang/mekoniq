#!/usr/bin/env node
// Program completion inventory. Reads docs/superpowers/plans/2026-10-30-plan-index.json and answers one question honestly: is every REQUIRED row accepted?
// Nothing passes because documents exist: a row is accepted only when the index says `accepted` (evidence-backed). Usage:
//   node scripts/verify-completion.mjs            print the verdict, exit 1 if the program is not complete
//   node scripts/verify-completion.mjs --write    rewrite docs/implementation/gates/D-full-scope.md from the index
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function programComplete(rows) { return rows.filter(r => r.required).every(r => r.status === 'accepted'); }
export function inventory(index) {
  const byId = new Map(index.tasks.map(t => [t.id, t]));
  const taskRows = index.tasks.map(t => ({ id: t.id, title: t.title, required: true, status: t.status, remaining: t.remaining ?? null, evidence: t.evidence ?? null }));
  const groupRows = (list, kind) => list.map(g => { const tasks = (g.tasks ?? []).map(id => byId.get(id)).filter(Boolean); const blockers = tasks.filter(t => t.status !== 'accepted'); return { id: g.id, label: g.label ?? g.requirement ?? '', kind, required: true, status: blockers.length ? 'not_accepted' : 'accepted', blockers: blockers.map(t => `${t.id}:${t.status}`) }; });
  const features = groupRows(index.featureCoverage, 'feature'), offline = groupRows(index.offlineCoverage, 'offline'), stack = groupRows(index.stackCoverage, 'stack');
  return { taskRows, features, offline, stack, complete: programComplete([...taskRows, ...features, ...offline, ...stack]), gateA: index.gateA };
}
export function render(inv, index) {
  const count = s => inv.taskRows.filter(r => r.status === s).length, statuses = [...new Set(inv.taskRows.map(r => r.status))].sort();
  const lines = ['# Gate D — full accepted scope (inventory)', '', `Verdict: **${inv.complete ? 'complete' : 'NOT COMPLETE'}**. Generated from \`docs/superpowers/plans/2026-10-30-plan-index.json\` by \`node scripts/verify-completion.mjs --write\`; do not edit by hand.`,
    'A row is accepted only when the index says `accepted`. `verified_local` means implemented and exercised locally; `blocked_external` means the software exists but a mandatory physical, provider, hosted or soak qualification is missing; `planned` means not started.', '',
    `Tasks: ${inv.taskRows.length} — ${statuses.map(s => `${s}: ${count(s)}`).join(', ')}. Gate A: ${inv.gateA}.`, '', '## Tasks that are not accepted', '', '| Task | Status | What is missing |', '|---|---|---|'];
  for (const r of inv.taskRows.filter(r => r.status !== 'accepted')) lines.push(`| ${r.id} ${r.title} | ${r.status} | ${(r.remaining ?? (r.status === 'verified_local' ? 'Local evidence only; no external qualification recorded.' : '—')).replace(/\|/g, '/')} |`);
  for (const [title, rows] of [['Feature groups F01–F30', inv.features], ['Offline / maintenance cases O01–O22', inv.offline], ['Stack requirements S01–S07', inv.stack]]) {
    lines.push('', `## ${title}`, '', '| ID | Requirement | Status | Blocking tasks |', '|---|---|---|---|');
    for (const r of rows) lines.push(`| ${r.id} | ${String(r.label).replace(/\|/g, '/')} | ${r.status} | ${r.blockers.join(', ') || '—'} |`);
  }
  lines.push('', '## Reading this honestly', '', '- Nothing is `accepted` yet because acceptance needs evidence this repository cannot produce alone: physical tablets and a venue network (Gate A), a supervised robot and signed commissioning (Gate B), real providers, hosted Supabase/Vercel measurements and a recovery drill (Gate D/production).', '- `trial-service` parity is implemented and tested locally on the same build as the full product; the first live shift and customer UAT are procedures in `docs/operations/{cutover,first-shift,post-release}.md`, not results.', `- Index reviewRepair status: ${index.reviewRepair?.status ?? 'n/a'}.`);
  return lines.join('\n') + '\n';
}
export function verifyEvidenceFiles(index, root = 'docs/superpowers/plans') {
  const missing = [];
  for (const t of index.tasks) if (t.status !== 'planned' && (!t.evidence || !existsSync(new URL(t.evidence, pathToFileURL(root + '/').href)))) missing.push(t.id);
  return missing;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = JSON.parse(readFileSync('docs/superpowers/plans/2026-10-30-plan-index.json', 'utf8')), inv = inventory(index);
  if (process.argv.includes('--write')) { writeFileSync('docs/implementation/gates/D-full-scope.md', render(inv, index)); console.log('written docs/implementation/gates/D-full-scope.md'); }
  const open = inv.taskRows.filter(r => r.status !== 'accepted');
  console.log(inv.complete ? 'PROGRAM COMPLETE' : `NOT COMPLETE: ${open.length}/${inv.taskRows.length} tasks not accepted, ${inv.features.filter(f => f.status !== 'accepted').length}/30 feature groups, ${inv.offline.filter(f => f.status !== 'accepted').length}/22 offline cases`);
  process.exit(inv.complete ? 0 : 1);
}
