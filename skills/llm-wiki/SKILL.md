---
name: llm-wiki
description: "Knowledge management, document synthesis, and concept graph maintenance following Andrej Karpathy's LLM-Wiki pattern. Use when ingesting articles/docs/papers, creating or querying wiki concepts, maintaining cross-links, or performing wiki health checks."
version: 1
---

# Andrej Karpathy LLM-Wiki Pattern

> "The central idea of LLM-Wiki is that the LLM acts as the encyclopedist and curator of a personal, compounding knowledge base formatted in plain Markdown with `[[wikilinks]]`."

A structured knowledge architecture where LLMs ingest raw information, distill it into interconnected concept pages, maintain a master index, record an append-only audit trail, and continuously verify graph health.

---

## Architecture Overview

```
~/.piwin/wiki/
├── INDEX.md          # Master catalog, domain taxonomy, concept lookup table
├── LOG.md            # Append-only chronological audit log of all updates & ingests
├── raw/              # Immutable raw sources (papers, notes, transcripts, clips)
└── concepts/         # Interconnected Markdown notes with YAML frontmatter + [[wikilinks]]
    ├── transformer-architecture.md
    ├── attention-mechanism.md
    └── ...
```

### The Three Layers
1. **Raw Sources (`raw/`)**: Read-only raw documents, articles, transcripts, or web clips.
2. **Distilled Wiki (`concepts/`)**: High-signal, synthesized encyclopedia pages in Markdown.
3. **Control & Audit (`INDEX.md` + `LOG.md`)**: Table of contents and journal of all changes.

---

## The 3 Core Operations

```
┌─────────────────────────────────────────────────────────────┐
│                      LLM-Wiki Lifecycle                     │
├──────────────────────────────┬──────────────────────────────┤
│ 1. Ingest (消化与提炼)       │ 2. Query (检索与概念联想)    │
│    • Read raw source         • Read INDEX.md first          │
│    • Cross-check INDEX.md    • Retrieve target concepts     │
│    • Update 1–5 concept notes│    • Follow [[wikilinks]]    │
│    • Append to LOG.md        • Synthesize cited answer      │
├──────────────────────────────┴──────────────────────────────┤
│ 3. Lint (巡检与维护)                                        │
│    • Scan for broken [[wikilinks]]                          │
│    • Identify orphan concepts with zero in/out links        │
│    • Ensure every concept is registered in INDEX.md         │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Ingest Workflow (消化提炼)

When given new documents, text, notes, or technical materials:

1. **Read `INDEX.md` First**:
   - Inspect the current catalog to see what concepts already exist.
   - Avoid creating duplicates or conflicting definitions.

2. **Decompose & Synthesize**:
   - Do not simply dump the entire raw file into a page.
   - Break down ideas into atomic, durable concepts (e.g. `[[Direct Preference Optimization]]`, not `Paper Summary March 2024`).
   - Create or update 1 to 5 interconnected concept pages.

3. **Format Each Concept Page**:
   ```markdown
   ---
   title: Concept Name
   aliases: [Acronym, Alt Name]
   tags: [domain, sub-domain]
   summary: One-sentence concise definition.
   updated: YYYY-MM-DD
   ---

   # Concept Name

   ## Definition & Core Intuition
   Clear, concise explanation of the concept.

   ## Key Mechanisms & Components
   Structured breakdown with cross-references like [[Related Concept]].

   ## Relationships & Connections
   - Extends: [[Prior Concept]]
   - Applied in: [[Application Concept]]
   - Contrasted with: [[Alternative Concept]]
   ```

4. **Maintain Cross-links (`[[wikilinks]]`)**:
   - Use `[[Concept Name]]` or `[[Target Slug|Display Label]]`.
   - Every concept page must link to at least 1 parent or related concept.

5. **Update Index & Log**:
   - Use tool `wiki_write` to save concepts, which automatically records entries into `INDEX.md` and `LOG.md`.

---

## 2. Query Workflow (检索与联想)

When answering questions using the knowledge base:

1. **Check `INDEX.md`**:
   - Call `wiki_read(name: "INDEX")` to locate matching concepts.
2. **Read Target Concepts**:
   - Call `wiki_read(name: "...")` for the most relevant concepts.
3. **Traverse Connected Outlinks**:
   - If deeper context is required, read the outlinks discovered in the target concept.
4. **Synthesize & Cite**:
   - Formulate the response incorporating explicit `[[wikilinks]]` so the user can explore the concept network.

---

## 3. Lint Workflow (巡检与健康维护)

Periodically or after bulk ingestions:

1. Run `wiki_lint`:
   - Inspects `~/.piwin/wiki/concepts/`.
   - Identifies broken links (`[[Target]]` pointing to non-existent concept files).
   - Identifies orphan concepts (zero backlinks and omitted from `INDEX.md`).
2. Fix detected issues:
   - For broken links: create the stub concept or correct the typo.
   - For orphans: link them from `INDEX.md` and related parent concepts.

---

## Tools Reference

- `wiki_read`: Read a concept page, `INDEX`, or `LOG`.
- `wiki_write`: Create or update a concept page with automatic `INDEX.md` and `LOG.md` sync.
- `wiki_lint`: Run comprehensive graph health check.
- `/wiki`: Slash command for terminal / chat operations (`/wiki lint`, `/wiki log`).
