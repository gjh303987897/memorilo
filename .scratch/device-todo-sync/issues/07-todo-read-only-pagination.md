# 07: Render the TODO page as read-only pagination

**What to build:** The TODO page displays a bounded list with page navigation only; it never presents a current row or task action.

**Blocked by:** 06; fourcolor-firmware-integration #04, #05

**Status:** completed

- [x] Render at most six rows per page and clamp the page index after snapshot changes.
- [x] Up/Down short presses change pages: page 1 is items 1–6, page 2 is items 7–12, and so on.
- [x] Do not render row highlights, current-item state, activation affordances, or completion controls.
- [x] Keep top-level feature-page navigation distinct from the TODO list page index.
