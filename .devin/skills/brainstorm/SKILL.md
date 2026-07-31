---
name: brainstorm
description: Brainstorm product or engineering ideas for piwin with constraints from PRD and architecture.
allowed-tools:
  - read
  - grep
  - ask_user_question
  - web_search
---

Help the user brainstorm an idea, feature, or implementation approach for piwin.

1. If a topic was provided (e.g. `/brainstorm offline-first sync`), focus on that topic.
   If no topic is clear, ask the user one focused clarifying question.
2. Read the relevant background first:
   - `docs/prd.md` for product goals
   - `docs/architecture.md` for system boundaries
   - `docs/adr/*` for decisions that constrain the idea
   - `AGENTS.md` for non-negotiable rules
3. Generate 3-7 concrete options. For each option include:
   - One-line summary
   - What changes (packages, contracts, host, apps)
   - Pros / cons / risks
   - How it respects piwin architecture rules (host boundary, contracts-first, dual-mode host, etc.)
4. Recommend the best default and explain why.
5. If the user wants to go deeper, ask which option to explore.
