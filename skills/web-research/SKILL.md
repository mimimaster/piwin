---
name: web-research
description: "Answer with current, cited facts using web_search then web_fetch. Use when the answer depends on recent or external information (news, releases, versions, prices, third-party docs, 查一下 / 最新) or when the user asks for sources."
version: 3
---

# Web Research

## Goal
A user answer grounded in current sources, with concrete URLs the reader can open.

## Done means
- `web_search` used for discovery when the question needs the live web (host may multi-source merge; do not invent extra search tools).
- 1–5 promising hits read with `web_fetch` before strong claims.
- Answer cites specific URLs; only evidence that addresses the question is kept.

## Stop when
- Search disabled / empty hits / warning — rephrase, use a known official URL with `web_fetch`, or tell the user to enable sources in Settings → Web.
- Insufficient sources for a claim — say what is unknown.

## Constraints
- Do not dump every hit. Ranking may be crude; selection is your job.

## Verify
- Claims that depend on the web are traceable to fetched or clearly snipped sources.
