# Collaboration workflow: one directive, one PR

Policy for how agents land work in this repo. Two parties work here — the operator and agents — so PR granularity optimizes for integration cost, not review parallelism.

## Rules

1. **One directive = one branch = one PR.** Batch work spanning multiple tickets lands as issue-unit commits (`(#N)` suffix) on a single branch. Dependencies between tickets resolve naturally inside the branch — no stack needed.
2. **PRs land serially.** Merge the previous PR before starting the next directive (ask the operator, or merge with prior approval). If work must continue while a PR is open, grow that same branch with issue-unit commits instead of opening a second branch from main. Two open branches must never both touch a registry file. Predicting a conflict in a PR body is not prevention.
3. **No stacked PRs by default.** If a stack ever seems necessary, ask the operator first. Per-ticket PR separation only when the operator explicitly requests it.
4. **Parallel multi-agent work: worktrees for execution, serial integration for history.** Subagents work in isolated worktrees; the orchestrator owns the integration branch and lands each result onto it sequentially.
5. **Registry-like files are integration-time edits.** `package.json` (scripts/deps), `.env.example`, `src/prompts/catalog.ts` are shared append-points and therefore conflict magnets. Subagents do not edit them directly; the orchestrator edits them once at integration time.
6. **The issue board lives on main.** All writes to `issues/index.html` (claim, create, comment, close) are small `docs:` commits pushed directly to main — never carried on a PR branch. The board is coordination state, not review material: a claim that waits for a merge coordinates nothing, and parallel PRs appending to the same data island conflict by construction.
7. **Claim tickets on the board before starting.** A session sets `assignee` on the ticket as its first write, pushed straight to main (rule 6; see [issue-tracker.md](issue-tracker.md)). Concurrent sessions coordinate through the board, not through git.

Merge strategy stays rebase-merge (operator preference): one PR lands as N clean issue-unit commits on main.

## Why

2026-07-26: a batch directive ("implement the remaining tickets") was split into 3 PRs, one of them stacked. In a two-party repo this bought nothing — history is already reviewable per commit — and cost restack ceremony plus conflicts in registry files edited by parallel branches. GitHub has no native stacked-PR support, and stacking tools (Graphite etc.) automate restacking without preventing the shared-file conflicts, so the fix is this process, not tooling.

2026-07-26, second incident (same day): four directives in one session went out as parallel PRs from main, each appending its ticket to the board data island. The conflicts were predicted in the PR bodies, then paid three times as rebase fixups instead of prevented — the letter of rule 1 was followed while its purpose (integration cost) was not. Hence rules 2 and 6: land serially, and keep the board off PR branches entirely. Rule 6 also repairs a contradiction in the original policy: a board claim carried on a PR branch is invisible to other sessions until merge, which defeated rule 7's purpose.
