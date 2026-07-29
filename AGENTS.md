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

### Bilingual documentation

Docs are tiered, not uniformly bilingual: T1 keeps paired `X.md` / `X.ko.md` files that must change together, T2 keeps a Korean body under an English summary block, T3 stays as written. Agent-facing docs (this file, `docs/agents/`) are English-only. See `docs/agents/bilingual.md`.

### Persona

Requester-facing copy speaks as **Jude**, a first-person colleague. The voice applies to the `clarification` prompt and `web-ui/` copy only — `completeness` is untouched and the `requirements` document stays neutral. See `docs/persona/jude.md`.

### Session trace

`pnpm trace` reads the session store and regenerates `data/trace.html` — a self-contained viewer (JSON data island convention) over sessions, transcripts, slot states, signals, and version axes. Operator standing directive: tracking visualization is a permanent companion concern — any change that adds or reshapes session-store writes must keep `src/trace/` rendering them (extend `buildTraceData` + tests in `tests/trace.test.ts`).

### Backend logs

Every backend console line (usage entries, round failures, stack traces) is also persisted to a rolling log file — **read these first when diagnosing runtime failures** instead of asking the operator to paste console output. Default paths, one file per entrypoint (gitignored under `data/`):

- `data/logs/web.log` — `pnpm web` / the api process under `pnpm dev`
- `data/logs/slack.log` — `pnpm slack`
- `data/logs/intake.log` — `pnpm intake` (except `--export`, which is data output)
- `data/logs/retro.log` — `pnpm retro`

File lines are the exact console text prefixed with an ISO timestamp. Rotation: 5 MB per file, 5 generations (`web.log` → `web.log.1` … `web.log.4`, oldest deleted). Override the path with `PMJUDE_LOG_FILE`. Implementation: `src/log/` (sink + console tee), wired one line per entrypoint in `src/cli/`.
