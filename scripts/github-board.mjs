#!/usr/bin/env node
// Keeps the ticket issues organised: every `T-NN · …` issue with a `phase-N`
// label gets a type label if it has none, and is attached as a sub-issue of
// its `Phase N · Name` epic. Phases are the only grouping — no milestones
// until there is a real ship date to track. The issues are the
// ticket register (CLAUDE.md, Tickets); this script only files them.
//
// Dry run by default. Idempotent: re-running finds what exists and skips it.
//
//   node scripts/github-board.mjs                        # print what would change
//   node scripts/github-board.mjs --apply                # make the changes
//   node scripts/github-board.mjs --apply --project 4    # also sync the board
//
// With --project, every ticket and epic is on the board with its Phase field
// set, and a "Phase status" field reads Complete once every ticket in its
// phase is closed, Active otherwise — so a view filtered on
// `-phase-status:Complete` drops finished phases by itself. The board-sync
// workflow runs this on every issue event; --project needs a token with the
// `project` scope (the workflow's PROJECT_TOKEN secret).

import { execFileSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');
const projectIdx = process.argv.indexOf('--project');
const PROJECT = projectIdx >= 0 ? Number(process.argv[projectIdx + 1]) : null;

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

// ── Labels ──────────────────────────────────────────────────────────────────

const labels = new Set(ghJsonLines('label', 'list', '--limit', '500', '--json', 'name', '--jq', '.[] | {name}').map((l) => l.name));
console.log('Labels');
for (const [name, l] of [...Object.entries(TYPE_LABELS).map(([t, l]) => [`type:${t}`, l]), [EPIC_LABEL.name, EPIC_LABEL]]) {
  if (!labels.has(name)) act(`label ${name}`, () => gh('label', 'create', name, '--color', l.color, '--description', l.description));
}

// ── Ticket issues ───────────────────────────────────────────────────────────

// The issues endpoint returns PRs too, and PR titles also start with `T-NN ·`.
const issues = ghJsonLines(
  'api', '--paginate', 'repos/{owner}/{repo}/issues?state=all&per_page=100',
  '--jq', '.[] | select(.pull_request | not) | {number, id, title, state, labels: [.labels[].name]}',
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
  if (!t.labels.some((n) => n.startsWith('type:'))) {
    act(`#${t.number} ${t.title.split(' ·')[0]} → type:feature`, () => gh('issue', 'edit', String(t.number), '--add-label', 'type:feature'));
  }
}

// ── Phase epics and sub-issues ──────────────────────────────────────────────

console.log('Phase epics');
const epics = new Map();
for (const i of issues) {
  const m = /^Phase (\d+) · /.exec(i.title);
  if (m && i.labels.includes('epic')) epics.set(Number(m[1]), i);
}
const noEpic = new Set();
const phaseComplete = new Map();
for (const phase of [...new Set(tickets.map(phaseOf))].filter((p) => p !== null).sort((a, b) => a - b)) {
  const epic = epics.get(phase);
  const children = tickets.filter((t) => phaseOf(t) === phase);
  phaseComplete.set(phase, children.every((c) => c.state === 'closed'));
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
  const allClosed = phaseComplete.get(phase);
  if (epic.state === 'open' && allClosed) {
    act(`close #${epic.number} — all ${children.length} tickets closed`, () => gh('issue', 'close', String(epic.number), '--reason', 'completed'));
  } else if (epic.state === 'closed' && !allClosed) {
    act(`reopen #${epic.number} — it has open tickets`, () => gh('issue', 'reopen', String(epic.number)));
  }
}

// ── Project board ───────────────────────────────────────────────────────────

if (PROJECT !== null) {
  console.log('Project board');
  const repo = JSON.parse(gh('repo', 'view', '--json', 'nameWithOwner,owner')).nameWithOwner;
  const login = repo.split('/')[0];
  const graphql = (query, vars = {}) =>
    JSON.parse(gh('api', 'graphql', '-f', `query=${query}`, ...Object.entries(vars).flatMap(([k, v]) => [typeof v === 'number' ? '-F' : '-f', `${k}=${v}`]))).data;

  const FIELDS = `fields(first: 50) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } }`;
  const head = graphql(`query($login: String!, $num: Int!) { user(login: $login) { projectV2(number: $num) { id ${FIELDS} } } }`, { login, num: PROJECT }).user.projectV2;
  const fieldByName = (name) => head.fields.nodes.find((f) => f.name === name);

  const phaseField = fieldByName('Phase');
  if (!phaseField) throw new Error('The project has no "Phase" single-select field.');
  let statusField = fieldByName('Phase status');
  if (!statusField) {
    act('create field "Phase status" (Active / Complete)', () => {
      statusField = graphql(`mutation { createProjectV2Field(input: { projectId: "${head.id}", dataType: SINGLE_SELECT, name: "Phase status",
        singleSelectOptions: [{ name: "Active", color: GREEN, description: "The phase still has open tickets" },
                              { name: "Complete", color: GRAY, description: "Every ticket in the phase is closed" }] })
        { projectV2Field { ... on ProjectV2SingleSelectField { id name options { id name } } } } }`).createProjectV2Field.projectV2Field;
    });
  }

  // Every item on the board, keyed by issue number, with its single-select values by field name.
  const items = new Map();
  for (let cursor = null, more = true; more; ) {
    const page = graphql(
      `query($login: String!, $num: Int!${cursor ? ', $cursor: String!' : ''}) { user(login: $login) { projectV2(number: $num) {
        items(first: 100${cursor ? ', after: $cursor' : ''}) { pageInfo { hasNextPage endCursor } nodes { id
          content { ... on Issue { number } }
          fieldValues(first: 20) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2SingleSelectField { name } } } } } } } } } }`,
      { login, num: PROJECT, ...(cursor ? { cursor } : {}) },
    ).user.projectV2.items;
    for (const n of page.nodes) {
      if (n.content?.number === undefined) continue;
      const values = Object.fromEntries(n.fieldValues.nodes.filter((v) => v.field).map((v) => [v.field.name, v.name]));
      items.set(n.content.number, { id: n.id, values });
    }
    more = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }

  const setOption = (itemId, field, option) =>
    gh('project', 'item-edit', '--id', itemId, '--project-id', head.id, '--field-id', field.id, '--single-select-option-id', option.id);

  const onBoard = [...tickets, ...[...epics.values()]];
  for (const issue of onBoard) {
    const phase = phaseOf(issue) ?? Number(/^Phase (\d+) · /.exec(issue.title)?.[1] ?? NaN);
    if (!Number.isFinite(phase)) continue;
    const tag = issue.title.split(' ·')[0];
    let item = items.get(issue.number);
    if (!item) {
      act(`add #${issue.number} ${tag} to project ${PROJECT}`, () => {
        const added = JSON.parse(gh('project', 'item-add', String(PROJECT), '--owner', login, '--url', `https://github.com/${repo}/issues/${issue.number}`, '--format', 'json'));
        item = { id: added.id, values: {} };
      });
    }
    const wantPhase = phaseField.options.find((o) => o.name.startsWith(`${phase} ·`));
    if (!wantPhase) { console.log(`    no Phase option for phase ${phase} — add one named "${phase} · <name>"`); continue; }
    const wantStatus = phaseComplete.get(phase) ? 'Complete' : 'Active';
    if (item?.values.Phase !== wantPhase.name) {
      act(`#${issue.number} ${tag} Phase → ${wantPhase.name}`, () => setOption(item.id, phaseField, wantPhase));
    }
    if (item?.values['Phase status'] !== wantStatus) {
      act(`#${issue.number} ${tag} Phase status → ${wantStatus}`, () =>
        setOption(item.id, statusField, statusField.options.find((o) => o.name === wantStatus)));
    }
  }
}

if (unphased.length) console.log(`\nNo phase-N label: ${unphased.join(', ')}`);
if (noEpic.size) console.log(`No "Phase N · Name" epic (label epic) for phase ${[...noEpic].join(', ')} — create one, then re-run.`);
console.log(changes === 0 ? '\nNothing to change.' : APPLY ? '' : '\nDry run — nothing changed. Re-run with --apply.');
