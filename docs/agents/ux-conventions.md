# UX conventions

Baseline interaction rules for `web-ui/`. These are **defaults an agent applies without being asked** — the operator should not have to re-explain them per feature. Deviating from one is a design decision that belongs in the PR body.

Each rule exists because it was missed at least once. The "why" column records the failure, so the rule reads as a lesson rather than a preference.

## Dismissal

| Rule | Why |
|---|---|
| Every transient surface (popover, sheet, inline editor) has **three** ways out: an explicit button, `Esc`, and a click outside. | #66: the correction popover shipped with only an explicit Cancel. The operator got stuck in it. One exit is not an exit. |
| Outside-click on a **chooser** cancels. Outside-click on an **editor with unsaved text** commits. | Cancelling an editor silently throws away a sentence the user just typed. Committing a chooser does something the user never confirmed. |
| Register outside-click listeners in the **capture** phase. | Otherwise the underlying content's own click handler runs first and re-opens what you are closing. |

## Proximity

| Rule | Why |
|---|---|
| The action happens **next to its target**, not in a panel elsewhere on the page. | #66: the first correction UI put the input at the bottom of the card. The user could not see what they were fixing while typing. |
| Mode choices (which *kind* of action) also belong next to the target — not one panel away from where the action lands. | Same round of #66. Choosing "AI or manual" far from the text breaks the same link. |
| Anchored surfaces clamp to the viewport and flip when space runs out; they never render clipped or off-screen. | A clipped popover is unusable, and the user cannot tell it is clipped. |
| Floating surfaces are `position: fixed`, positioned in **viewport** coordinates — never `absolute` inside the content they annotate. | #66: an absolutely-positioned popover on a bottom item extended the document's scroll area, so a click alone moved the page. Floating UI must not participate in document layout. |
| Never render a floating surface before its coordinates are measured — keep it `invisible` for that frame. | Drawing it at (0,0) first makes the view jump, and focusing it there drags the scroll position with it. |
| Focus programmatically with `preventScroll: true`. | Without it the browser scrolls to reveal the field, which is exactly the jump the user did not ask for. |
| A fixed surface **re-measures its anchor** on scroll and resize. Do not close it instead. | First tried closing: any scroll — including the browser's own nudge when the popover opened — made it vanish instantly at the bottom of the document. Measure the anchor element live rather than trusting a stored rect. |
| After programmatic focus, **restore the scroll position** if it moved. `preventScroll` alone is not enough. | Browsers ignore `preventScroll` in some cases, and the resulting jump is indistinguishable from a bug to the user. |

## Editing text

| Rule | Why |
|---|---|
| Text is edited **in place** — the element becomes editable. Do not lift text into a modal or a side panel to change it. | #66: editing inside the popover meant reading in one place and typing in another. |
| An editor opens with the **current value**, cursor at the end. Never an empty box the user has to retype. | Retyping a sentence to change three words is work the product should absorb. |
| Editors grow with their content and carry `overflow-hidden`. No inner scrollbar on a field the user is composing in. | Scope items run several lines; a one-line box hides what is being edited. A scrollbar that is never needed reads as unfinished work. |
| Size a field **before paint** (`useLayoutEffect`), not after. | Measuring after paint draws one frame at the collapsed height — long enough to flash a scrollbar that then disappears. |
| An editing surface covers the unit the user **selected**, not the unit that was easy to implement. | #66: direct editing was capped at one block because multi-block editing needs text→array re-mapping. Line-per-item mapping was the answer — and it made add/remove fall out for free. |

## Gestures

| Rule | Why |
|---|---|
| One gesture per intent. If a gesture already reaches an action, do not also offer that action as a choice elsewhere. | #66: double-tap already opened the in-place editor, yet the popover still asked "instruct or edit" — a step that cost a click and explained nothing. The popover became instruction-only, with in-place editing as a hint on it. |
| A range selection outranks a click inside it. | Clicking to confirm a drag selection must not collapse it into a single-element pick. |

## Keyboard

| Rule | Why |
|---|---|
| `Enter` commits, `Shift+Enter` inserts a newline, `Esc` cancels. | Consistency beats per-surface cleverness. If a surface needs `Cmd+Enter` instead, that surface is probably a form, not an inline edit. |
| When a mode is chosen or a surface opens for input, **focus moves there**. | Otherwise every interaction costs an extra click that the user has to discover. |

## Making state legible

| Rule | Why |
|---|---|
| A finished state still shows what can be done next. "Done" is not a dead end. | #66: the completed session showed a large "confirmed" notice and the only way to change the document was a small button inside a slot card — the operator concluded there was no way at all. |
| If data exists, there is a path to see it. Do not render a branch that hides content the session still holds. | #66: an approved mockup stayed in the database — served by the API — with no route to view it, because the panel only existed in the `mockup` status branch. Fixed with a read-only archive card in the `documented` branch. |
| Content that is no longer being acted on is shown **read-only and collapsed**, not removed. | The approved mockup keeps no comment box, theme picker, or approve button: that work is finished and the document is what gets built. But it must still be findable. |
| Show the unit of change the user is choosing (selection count, quoted text, target version) before they commit. | Users should not have to guess the blast radius of a correction. |
| When the **acted-on unit differs from the selected range**, highlight the real unit and say so. | #66: the smallest editable unit is a block, so dragging half a paragraph still rewrites the whole item. Nothing showed that, so the operator reasonably expected only the dragged words to change. The affected blocks now get a ring, and a note points to in-place editing for word-level changes. |

## Destructive and irreversible

| Rule | Why |
|---|---|
| Confirm only what cannot be undone. Everything else executes immediately and offers a way back. | Confirmation dialogs on reversible actions train users to click through them. |
| Deletion is never a side effect of an empty value. | `src/document/path.ts` rejects empty replacement text for this reason: an accidentally cleared field must not delete a requirement. |

## How to extend this file

When the operator corrects an interaction, add the rule **and the failure that produced it** here in the same change. A rule without its failure gets argued with; a rule with a scar does not.
