# Task 2 Report: Highlight commented lines

## Status: DONE

## Summary

Implemented soft blue background highlight for document lines that have comments, with deeper tint on hover/popover-open. Empty lines keep a lighter hover-only tint.

## Changes

### `apps/desktop/src/EnhancedMarkdownView.tsx` (LineCommentWrapper ~L472–483)
- Wrapper `className` now includes `has-comment` when `hasComment` is true
- Switched to array + `.filter(Boolean).join(' ')` per plan

### `apps/desktop/src/styles/region-inspector.css` (~L2819–2857)
- Replaced transparent hover rules with:
  - Soft hover (6% accent) for any commentable line
  - Always-tinted (10% accent) for `.has-comment`
  - Deepen (16% accent) for `.has-comment:hover` / `.has-comment.popover-open`
  - Light-theme rgba fallbacks (0.06 / 0.09 / 0.14)
- `border-radius: 6px`, `padding-right: 34px` for comment button room

## Commit

- `3df0d4e` feat(desktop): soft highlight for commented document lines
- Staged only the two Task 2 files (other dirty tree left unstaged)

## Typecheck

- `pnpm --filter @piwin/desktop typecheck` — **pass** (exit 0)

## Self-review

- Matches plan Steps 1–2 exactly
- No Task 3 (composer chip) or Task 4 (markdown parser) work
- Minimal diff; no Pi imports; no emoji
- Manual smoke (add comment → tint; hover deepen; delete → tint gone) not run in this agent session

## Concerns

- None for implementation. Manual UI smoke still recommended by parent/user.
