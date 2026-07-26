# Collaboration workflow: one directive, one PR

Policy for how agents land work in this repo. Two parties work here — the operator and agents — so PR granularity optimizes for integration cost, not review parallelism.

## Rules

1. **One directive = one branch = one PR.** Batch work spanning multiple tickets lands as issue-unit commits (`(#N)` suffix) on a single branch. Dependencies between tickets resolve naturally inside the branch — no stack needed.
2. **No stacked PRs by default.** If a stack ever seems necessary, ask the operator first. Per-ticket PR separation only when the operator explicitly requests it.
3. **Parallel multi-agent work: worktrees for execution, serial integration for history.** Subagents work in isolated worktrees; the orchestrator owns the integration branch and lands each result onto it sequentially.
4. **Registry-like files are integration-time edits.** `package.json` (scripts/deps), `.env.example`, `issues/index.html`, `src/prompts/catalog.ts` are shared append-points and therefore conflict magnets. Subagents do not edit them directly; the orchestrator edits them once at integration time. Issue-board updates go into a single trailing `docs:` commit per PR.
5. **Claim tickets on the board before starting.** A session sets `assignee` on the ticket as its first write (see [issue-tracker.md](issue-tracker.md)). Concurrent sessions coordinate through the board, not through git.

Merge strategy stays rebase-merge (operator preference): one PR lands as N clean issue-unit commits on main.

## Why

2026-07-26: a batch directive ("implement the remaining tickets") was split into 3 PRs, one of them stacked. In a two-party repo this bought nothing — history is already reviewable per commit — and cost restack ceremony plus conflicts in registry files edited by parallel branches. GitHub has no native stacked-PR support, and stacking tools (Graphite etc.) automate restacking without preventing the shared-file conflicts, so the fix is this process, not tooling.
