<img src="web-ui/public/jude.svg" width="96" align="right" alt="Jude">

# PM Jude

한국어: [README.ko.md](README.ko.md)

An AI PM intake layer. Non-developer stakeholders bring a vague request; Jude asks a few pointed questions and hands the development team a requirement they can start building from.

Teams without a PM get requests fired straight at engineers — usually underspecified ("build me a dashboard"), usually missing the what, the why, and any notion of done. The cost lands on developers as interpretation, re-questions and rework. PM Jude stands in front of that.

## What it does

**Intake → clarification → document → gate.** A request arrives on any channel and becomes a session. Before asking anything, Jude searches existing issues, past documents and closed sessions, so the questions are grounded in what the organisation already knows. Then three to five targeted questions, in the requester's language, in their business vocabulary — and every question carries an "I don't know" path, because a requester who cannot answer must not be a dead end.

Completeness is judged in two layers: deterministic rule checks on required slots and format, then a model judging whatever semantic ambiguity survives. The rule layer exists because the model will otherwise wave things through.

What comes out is a `requirements` document — problem, users, scope, user stories with EARS acceptance criteria, data sources, open issues. It deliberately contains no architecture, no stack and no code; deciding *how* belongs to the developers.

Four properties the design is organised around:

- **Channel-agnostic.** The core knows nothing about web or Slack. Adapters call one core API.
- **Predefined control flow.** A hand-written state machine decides stage transitions; the model only makes structured calls inside a stage. Hard constraints — no issue without approval, no session closed without a reply — are enforced in code, not requested in a prompt.
- **No production code.** Jude refines requests. Jude does not build.
- **Instrumented from day one.** Every session is attributed to a prompt, model, threshold and slot-schema version, because quality is judged by downstream signals rather than by an internal score.

Full requirements: [PRD.md](PRD.md). Vocabulary: [CONTEXT.md](CONTEXT.md).

## Where the name comes from

"Hey Jude", and the coincidence that PM is both the role this product stands in for and Paul McCartney's initials. That is the whole of the joke — nothing in the product refers to music, and the character borrows no likeness, lyric or artwork. Jude is the character requesters talk to: a first-person colleague who listens before speaking, and who carries whatever you cannot answer to the development team rather than stalling on it. See [docs/persona/jude.md](docs/persona/jude.md).

## Status

**Phase 0 — proof of concept.** The refinement pipeline runs end to end on a local web surface. Everything downstream of the document is not built yet.

Working:

- Intake, session persistence, resume across browsers via the session link
- Context-grounded clarification loop with a round ceiling and an "I don't know" path on every question
- Two-layer completeness check with slot tri-state (filled / unfilled / promoted)
- `requirements` document generation, slot-level confirmation in the requester's language
- On-hold for insufficient info, resumable at any time
- Session trace viewer over transcripts, slot states, signals and version axes
- Retrospective Linear archive analysis (baseline and re-question taxonomy)

Not built yet:

- Approval gate, Linear issue creation, progress report-back
- Interactive mockups for UI requests
- Duplicate merge, SLA auto-backlog, backlog resurfacing
- Golden-set regression and the deployment gate (the `regressionPassed` flag exists; enforcement is Phase 2)

Slack has a runner and is sealed rather than removed — web-first verification was chosen because Slack and Linear provisioning is operator-dependent and was blocking the PoC ([ADR-0007](docs/adr/0007-web-first-verification.md)).

## Quick start

Node 22+ and pnpm 10. From the repository root:

```bash
pnpm install
cp .env.example .env      # set ANTHROPIC_API_KEY
pnpm dev
```

`pnpm dev` brings up the API server and the Next dev server together; if one dies, both go down. The UI is at http://localhost:3000, the API at http://127.0.0.1:8787.

No Anthropic credentials to hand:

```bash
PMJUDE_FAKE_BACKEND=1 pnpm dev
```

A deterministic fake backend on a separate database — enough to walk the whole flow.

The API root doubles as a **local hub**: [/board](http://localhost:3000/board) for the issue board, [/trace](http://localhost:3000/trace) for live session traces, [/repo/docs/](http://localhost:3000/repo/docs/) for repository documents with markdown and mermaid rendering. All of them are reachable on port 3000 as well.

## How it is put together

```
src/
├── gateway/     LLM gateway — complete(promptVersion, input) → structuredOutput
├── prompts/     Versioned prompt registry. Versions are immutable
├── store/       SQLite session store (Drizzle)
├── runner/      Channel-agnostic core runner + web and Slack adapters
├── web/         API server and local hub
├── trace/       Session trace renderer
├── analysis/    Retrospective archive analysis
└── cli/         intake · trace · retro · slack · web
web-ui/          Next.js App Router + shadcn/ui, client-only SPA
```

Nothing outside `gateway/` knows which model backend is in use. Nothing outside `runner/` knows which channel a request came from. Prompt versions are registered once and never mutated, so a session's signals stay attributable to exactly the prompt that produced them.

Diagrams, state machine and ERD: [ARCHITECTURE.md](ARCHITECTURE.md).

## Documentation

| Document | What it is |
| --- | --- |
| [PRD.md](PRD.md) | Product requirements. Overview and principles here, sections under [docs/prd/](docs/prd/) |
| [CONTEXT.md](CONTEXT.md) | Canonical glossary, bilingual. Use these terms verbatim |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System diagram, lifecycle state machine, sequences, ERD |
| [docs/adr/](docs/adr/) | Architecture decision records |
| [docs/persona/jude.md](docs/persona/jude.md) | Who Jude is, how Jude sounds, how Jude is drawn |
| [docs/ux/requester-journey.md](docs/ux/requester-journey.md) | Requester journey UX design |
| [AGENTS.md](AGENTS.md) | How agents work in this repository |

Documentation is tiered bilingual rather than uniformly translated — see [docs/agents/bilingual.md](docs/agents/bilingual.md).

## Development

```bash
pnpm test          # vitest
pnpm typecheck
pnpm lint
pnpm format

pnpm --dir web-ui test
pnpm --dir web-ui build
```

CI runs all of the above on every pull request. Two scripts are deliberately kept out of CI and run by hand: `node scripts/check-arch-sync.mjs` (mermaid blocks mirrored into `docs/architecture.html`) and `node scripts/check-bilingual-sync.mjs` (T1 document pairs).

Work is tracked on a local single-file board at `issues/index.html` — a JSON data island is the source of truth and the rendered page is for humans. One directive is one branch is one pull request, landed serially. See [docs/agents/workflow.md](docs/agents/workflow.md).
