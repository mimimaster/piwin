---
name: optimize-prompt
description: "Rewrite system prompts, tool descriptions, and agent instructions into dense, contract-style, XML-bounded specs with a before/after comparison. Use when the user asks to optimize, tighten, or review a prompt, system prompt, tool descriptor, or skill text (优化提示词), or runs /optimize-prompt."
version: 2
---

# Optimize Prompt

## Goal
Transform conversational, bloated, or unstructured prompts into high-density, contract-driven production specifications with zero persona fluff, zero strawman arguments, and strict XML/bullet boundaries.

## Done means
- **4-Point Diagnostic Audit** executed on the original prompt:
  1. *Persona & Filler Bloat*: Strip fluff like "You are a world-class...", "Take a deep breath...", "Please be smart/helpful".
  2. *Strawman Lecturing*: Eliminate "why not" preambles, comparisons with non-existent competitors, or defensive justifications; state target architecture affirmatively.
  3. *Attention Dilution*: Convert dense prose paragraphs (wall-of-text) into structured, scannable bullet points.
  4. *Missing Data Envelopes*: Wrap dynamic inputs, tool results, and output schemas in standard `<tag>` boundaries.
- **Production-Grade Rewrite Delivered**:
  - **English Runtime Core**: Ultra-lean, high Token-density English instructions for model execution.
  - **Structured Architecture**: Clear breakdown across `Scope / Trigger`, `Data Contracts`, `Hard Negative Boundaries`, and `Output Format`.
  - **Colocated Chinese Translation**: 1:1 Chinese explanatory translation placed directly underneath for engineering review.
- **1:1 Side-by-Side Comparison**:
  - Direct before vs after diff clearly identifying pruned implementation leaks and token savings.
- **Verification Probe**:
  - Concrete test/probe case or edge scenario demonstrating that the optimized prompt eliminates failure modes (e.g. anti-hallucination, anti-deadlink, double-rendering).

## Stop when
- Prompt is already at peak density (<100 tokens, XML-isolated, bullet-point contracts) — report that no change is necessary.
- Operational intent or domain boundaries are ambiguous — clarify the intended behavior; do not invent domain invariants.

## Constraints
- **Zero Persona / Emotional Fluff**: Models execute operational rules, not roleplay.
- **Zero Negative Strawmen**: Never write "Unlike other bad frameworks..." or "We do this because X is stupid". Only declare what this system *is* and *does*.
- **No Implementation Leaks**: Never expose host internals (e.g. database schema, UI CSS animations, scheduler algorithms) to model-facing tool descriptors.
- **Dual-Language Colocation**: English for production runtime; Chinese for review and documentation.

## Verify
- Re-check the rewritten prompt against:
  1. Token count reduction (typically 30%–60% savings).
  2. Strict XML tag closure and markdown syntax validity.
  3. Presence of explicit negative boundaries (what NOT to do) alongside positive capabilities.
