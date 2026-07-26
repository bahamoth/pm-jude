# pm-jude

## Collaboration workflow

One directive = one branch = one PR with issue-unit commits. No stacked PRs; registry-like files (`package.json`, `.env.example`, `issues/index.html`, catalog) are edited only at integration time; claim tickets on the board before starting. See `docs/agents/workflow.md`.

## Agent skills

### Issue tracker

Issues live in a local single-file HTML kanban board at `issues/index.html` — a JSON data island is the source of truth; the browser view is for humans. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
