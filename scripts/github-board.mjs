#!/usr/bin/env node
// Keeps the ticket issues organised: every `T-NN · …` issue with a `phase-N`
// label gets its release milestone, a type label if it has none, and is
// attached as a sub-issue of its `Phase N · Name` epic. The issues are the
// ticket register (CLAUDE.md, Tickets); this script only files them.
//
// Dry run by default. Idempotent: re-running finds what exists and skips it.
//
//   node scripts/github-board.mjs            # print what would change
//   node scripts/github-board.mjs --apply    # make the changes
//
// Needs `gh` authenticated against this repo. New issues reach the project
// board through the project's own auto-add workflow, not this script.

import { execFileSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');

const RELEASES = [
  { title: 'v1 Planner', phases: [0, 1, 2, 3, 4, 5, 6], description: 'Fuel planner — PROJECT-SCOPE.md, phases 0–6.' },
  { title: 'v2 Actuals', phases: [7, 8, 9, 10], description: 'Actuals and reconciliation — PROJECT-SCOPE-v2.md, phases 7–10.' },
  { title: 'v2 Canada', phases: [11], description: 'Canadian invoices, currency and billing weeks — phase 11 (D24–D30).' },
  { title: 'v2 UI refresh', phases: [12], description: 'Overview redesign and screen restyles — phase 12.' },
];
const releaseOf = (phase) => RELEASES.find((r) => r.phases.includes(phase))?.title;

const TYPE_LABELS = {
  feature: { color: '1f6feb', description: 'New capability or change in behaviour' },
  bug: { color: 'd73a4a', description: 'Fix for something that was wrong' },
  task: { color: '8b949e', description: 'Infrastructure, tooling, data or design work' },
};
const EPIC_LABEL = { name: 'epic', color: '8957e5', description: 'A phase — parent of its ticket issues' };

const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const ghJsonLines = (...a) => gh(...a).split('\n').filter(Boolean).map((l) => JSON.parse(l));
let changes = 0;
const act = (desc, fn) => {
  changes++;
  console.log(`${APPLY ? '  ✓' : '  ·'} ${desc}`);
  return APPLY ? fn() : undefined;
};

// ── Labels and milestones ───────────────────────────────────────────────────

const labels = new Set(ghJsonLines('label', 'list', '--limit', '500', '--json', 'name', '--jq', '.[] | {name}').map((l) => l.name));
console.log('Labels');
for (const [name, l] of [...Object.entries(TYPE_LABELS).map(([t, l]) => [`type:${t}`, l]), [EPIC_LABEL.name, EPIC_LABEL]]) {
  if (!labels.has(name)) act(`label ${name}`, () => gh('label', 'create', name, '--color', l.color, '--description', l.description));
}

console.log('Milestones');
const milestones = new Set(
  ghJsonLines('api', '--paginate', 'repos/{owner}/{repo}/milestones?state=all&per_page=100', '--jq', '.[] | {title}').map((m) => m.title),
);
for (const r of RELEASES) {
  if (!milestones.has(r.title)) {
    act(`milestone "${r.title}"`, () => gh('api', 'repos/{owner}/{repo}/milestones', '-f', `title=${r.title}`, '-f', `description=${r.description}`));
  }
}

// ── Ticket issues ───────────────────────────────────────────────────────────

// The issues endpoint returns PRs too, and PR titles also start with `T-NN ·`.
const issues = ghJsonLines(
  'api', '--paginate', 'repos/{owner}/{repo}/issues?state=all&per_page=100',
  '--jq', '.[] | select(.pull_request | not) | {number, id, title, state, milestone: .milestone.title, labels: [.labels[].name]}',
);
const phaseOf = (i) => {
  const l = i.labels.find((n) => /^phase-\d+$/.test(n));
  return l ? Number(l.slice(6)) : null;
};
const tickets = issues.filter((i) => /^T-\d+[A-Z]? ·/.test(i.title));

console.log('Ticket issues');
const unphased = [];
for (const t of tickets) {
  const phase = phaseOf(t);
  if (phase === null) { unphased.push(`#${t.number}`); continue; }
  const want = releaseOf(phase);
  const edit = [];
  if (want && t.milestone !== want) edit.push('--milestone', want);
  if (!t.labels.some((n) => n.startsWith('type:'))) edit.push('--add-label', 'type:feature');
  if (edit.length) act(`#${t.number} ${t.title.split(' ·')[0]} → ${edit.filter((_, k) => k % 2).join(', ')}`, () => gh('issue', 'edit', String(t.number), ...edit));
}

// ── Phase epics and sub-issues ──────────────────────────────────────────────

console.log('Phase epics');
const epics = new Map();
for (const i of issues) {
  const m = /^Phase (\d+) · /.exec(i.title);
  if (m && i.labels.includes('epic')) epics.set(Number(m[1]), i);
}
const noEpic = new Set();
for (const phase of [...new Set(tickets.map(phaseOf))].filter((p) => p !== null).sort((a, b) => a - b)) {
  const epic = epics.get(phase);
  const children = tickets.filter((t) => phaseOf(t) === phase);
  if (!epic) { noEpic.add(phase); continue; }

  const linked = new Set(
    ghJsonLines('api', '--paginate', `repos/{owner}/{repo}/issues/${epic.number}/sub_issues?per_page=100`, '--jq', '.[] | {id}').map((s) => s.id),
  );
  for (const c of children) {
    if (linked.has(c.id)) continue;
    act(`#${c.number} under #${epic.number} (${epic.title})`, () =>
      gh('api', '-X', 'POST', `repos/{owner}/{repo}/issues/${epic.number}/sub_issues`, '-F', `sub_issue_id=${c.id}`));
  }

  // A phase is open while any of its tickets is.
  const allClosed = children.every((c) => c.state === 'closed');
  if (epic.state === 'open' && allClosed) {
    act(`close #${epic.number} — all ${children.length} tickets closed`, () => gh('issue', 'close', String(epic.number), '--reason', 'completed'));
  } else if (epic.state === 'closed' && !allClosed) {
    act(`reopen #${epic.number} — it has open tickets`, () => gh('issue', 'reopen', String(epic.number)));
  }
}

if (unphased.length) console.log(`\nNo phase-N label: ${unphased.join(', ')}`);
if (noEpic.size) console.log(`No "Phase N · Name" epic (label epic) for phase ${[...noEpic].join(', ')} — create one, then re-run.`);
console.log(changes === 0 ? '\nNothing to change.' : APPLY ? '' : '\nDry run — nothing changed. Re-run with --apply.');
