---
name: writing-plans
description: Turn a goal into a scoped, ordered implementation plan with exit criteria.
---

# Writing Plans

1. Restate the goal and non-goals in one short block.
2. List constraints (architecture boundaries, locks, packages).
3. Break work into **vertical slices** (each shippable: types → impl → tests).
4. For each slice: owner package, files likely touched, exit criteria, tests.
5. Call out risks and "do not do" items.
6. End with a recommended start order.

Prefer thin correct plans over speculative multi-week epics.
