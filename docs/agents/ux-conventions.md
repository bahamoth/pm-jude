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
| Anchored surfaces clamp to their container and flip when space runs out; they never render clipped or off-screen. | A clipped popover is unusable, and the user cannot tell it is clipped. |

## Editing text

| Rule | Why |
|---|---|
| Text is edited **in place** — the element becomes editable. Do not lift text into a modal or a side panel to change it. | #66: editing inside the popover meant reading in one place and typing in another. |
| An editor opens with the **current value**, cursor at the end. Never an empty box the user has to retype. | Retyping a sentence to change three words is work the product should absorb. |
| Editors grow with their content. No inner scrollbars on a field the user is composing in. | Scope items run several lines; a one-line box hides what is being edited. |
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
| If data exists, there is a path to see it. Do not render a branch that hides content the session still holds. | #66: an approved mockup stayed in the database with no route to view it, because the panel only existed in the `mockup` status branch. |
| Show the unit of change the user is choosing (selection count, quoted text, target version) before they commit. | Users should not have to guess the blast radius of a correction. |

## Destructive and irreversible

| Rule | Why |
|---|---|
| Confirm only what cannot be undone. Everything else executes immediately and offers a way back. | Confirmation dialogs on reversible actions train users to click through them. |
| Deletion is never a side effect of an empty value. | `src/document/path.ts` rejects empty replacement text for this reason: an accidentally cleared field must not delete a requirement. |

## How to extend this file

When the operator corrects an interaction, add the rule **and the failure that produced it** here in the same change. A rule without its failure gets argued with; a rule with a scar does not.
