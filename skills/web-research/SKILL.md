---
name: web-research
description: Use web_search and web_fetch for current docs and facts. Prefer web_search first; it may aggregate multiple host-configured sources into one hit list.
---

# Web Research

Host-configured multi-source search is **transparent** to you: call `web_search` once. Do not invent extra search tools or assume a single vendor.

## Workflow

1. Call **web_search** with a focused query.
2. Read the returned `hits` (title, url, snippet, optional `source` tag). Ranking may be simple host-side merge; **you** select which links matter.
3. Call **web_fetch** on 1–5 promising URLs for page text before making claims.
4. Cite concrete URLs in the answer.

## Notes

- Empty `hits` or a `warning` field means no usable results — rephrase the query or fetch a known official URL.
- If web_search is disabled (no enabled sources in Settings → Web), say so and ask the user to enable sources, or use a known documentation URL with web_fetch only.
- Do not dump every hit; pick evidence that answers the user question.
