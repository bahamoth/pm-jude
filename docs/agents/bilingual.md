# Bilingual documentation

Collaborators on this repo read English; the operator writes Korean. Documentation is tiered rather than uniformly bilingual — full coverage of every document would be a permanent tax on every PR and would decay silently. Rationale in [ADR-0009](../adr/0009-bilingual-documentation-tiers.md).

## The three tiers

**T1 — both languages canonical.** Paired files: `X.md` in English, `X.ko.md` in Korean. **Both must change in the same commit.** Heading structure must match one-to-one so the two files stay navigable side by side.

- `README.md` / `README.ko.md`
- `docs/persona/jude.md` / `docs/persona/jude.ko.md`
- `CONTEXT.md` — the exception: a glossary is anchored by its terms, so both languages live in one file, English definition following Korean under the same term

**T2 — Korean body, English summary block.** A blockquote at the top of the document, immediately under the H1 (or under the frontmatter, if any):

```markdown
> **EN** — One paragraph. What this document decides or describes, and who needs to read it.
```

This is a summary, not a translation. It carries enough for an English reader to decide whether they need the Korean body, and no more. If summary and body disagree, the body wins.

- `PRD.md`, `docs/prd/*`
- `ARCHITECTURE.md`
- `docs/adr/*`

**T3 — whatever language it was written in.** No obligation either way.

- `docs/research/*`, `docs/ux/*`, `docs/phase0-plan.md`, `docs/data-model.md`, `web-ui/README.md`

## Agent-facing docs stay English-only

`AGENTS.md` and everything under `docs/agents/` are outside the tiers. Their readers are agents and two collaborators, all of whom read English. A Korean pair here adds maintenance without adding a reader.

## Picking a tier for a new document

Ask who has to act on it.

- **An outside reader, or someone deciding whether to use this project** → T1.
- **A contributor who needs the reasoning behind a decision** → T2.
- **You, or a future session, reconstructing a piece of work** → T3.

If you don't decide, it's T3. The default has to be the cheapest option or the rule stops being followed.

## Checking T1 pairs

```bash
node scripts/check-bilingual-sync.mjs
```

Compares heading structure across each T1 pair and reports drift. Not wired into CI, on purpose — the same convention as `check-arch-sync.mjs`. Run it before opening a PR that touches a T1 document.

## Which language does a term live in

Domain vocabulary is defined in [`CONTEXT.md`](../../CONTEXT.md), which carries both languages per term. Use the term as written there. Don't invent an English equivalent for a Korean term that already has one, and don't leave a new term Korean-only — a term without an English form is a term an English-speaking collaborator cannot use in an issue title.
