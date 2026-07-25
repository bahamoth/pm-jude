# Issue tracker: Local HTML board

Issues for this repo live in a single self-contained HTML file at `issues/index.html`. Opening that file in a browser renders a kanban board grouped by triage label — that's the human view. The machine view is a JSON array embedded in a data island inside the same file:

```html
<script type="application/json" id="issues-data">
[ ...issue objects... ]
</script>
```

**The JSON array is the single source of truth.** Agents edit ONLY the contents of that data island — never the HTML/CSS/JS shell around it. The shell renders whatever the JSON says on next page load.

## Issue schema

Required: `id`, `title`, `state`. Everything else optional.

```json
{
  "id": 1,
  "title": "Issue title",
  "state": "open",
  "labels": ["needs-triage"],
  "type": "task",
  "assignee": null,
  "parent": null,
  "blockedBy": [],
  "created": "2026-07-25",
  "updated": "2026-07-25",
  "body": "Markdown body",
  "comments": [{ "author": "jude", "date": "2026-07-25", "body": "Markdown comment" }]
}
```

- `state` is `"open"` or `"closed"`
- `labels` uses the strings in `triage-labels.md`; extra free-form labels are allowed
- `type` / `parent` / `blockedBy` exist for wayfinding (below)
- Dates are `YYYY-MM-DD`

## Conventions

- **Create an issue**: append an object to the array. `id` = current max + 1 (starting at 1). Default `state: "open"`, `labels: ["needs-triage"]` unless the caller specifies otherwise. Set `created` and `updated`.
- **Read an issue**: find the object with the matching `id` in the data island.
- **List issues**: filter the array (by `state`, `labels`, etc.).
- **Comment on an issue**: append to its `comments` array and bump `updated`.
- **Apply / remove labels**: edit the `labels` array.
- **Close**: set `state: "closed"` (append a closing comment when there's a reason worth recording).

After ANY edit, verify the JSON still parses — a broken data island blanks the board:

```bash
node -e "const s=require('fs').readFileSync('issues/index.html','utf8');JSON.parse(s.match(/<script type=\"application\/json\" id=\"issues-data\">([\s\S]*?)<\/script>/)[1]);console.log('issues-data ok')"
```

## When a skill says "publish to the issue tracker"

Append an issue object to the data island in `issues/index.html`.

## When a skill says "fetch the relevant ticket"

Read the object with the referenced `id` from the data island. The user will normally pass the issue number (`#3` → `id: 3`).

## Wayfinding operations

Used by `/wayfinder`. The **map** is an issue with **child** issues as tickets — all in the same data island.

- **Map**: an issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body.
- **Child ticket**: an issue with `parent` set to the map's `id` and `type` set to `research`/`prototype`/`grilling`/`task`. Once claimed, set `assignee`.
- **Blocking**: `blockedBy: [<id>, ...]`. A ticket is unblocked when every listed blocker has `state: "closed"`. The board shows a `⊘` chip on blocked cards.
- **Frontier query**: children of the map (`parent` matches) that are open, unblocked, and unassigned; lowest `id` wins.
- **Claim**: set `assignee` — the session's first write.
- **Resolve**: append the answer as a comment, set `state: "closed"`, then append a context pointer to the map issue's Decisions-so-far section in its `body`.
