# pm-jude

## Collaboration workflow

One directive = one branch = one PR with issue-unit commits, **landed serially** — merge the previous PR before starting the next. No stacked PRs; registry-like files (`package.json`, `.env.example`, catalog) are edited only at integration time. The issue board (`issues/index.html`) lives on main: claim/close via small docs commits pushed directly to main, never on PR branches. See `docs/agents/workflow.md`.

## Agent skills

### Issue tracker

Issues live in a local single-file HTML kanban board at `issues/index.html` — a JSON data island is the source of truth; the browser view is for humans. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Session trace

`pnpm trace` reads the session store and regenerates `data/trace.html` — a self-contained viewer (JSON data island convention) over sessions, transcripts, slot states, signals, and version axes. Operator standing directive: tracking visualization is a permanent companion concern — any change that adds or reshapes session-store writes must keep `src/trace/` rendering them (extend `buildTraceData` + tests in `tests/trace.test.ts`).
