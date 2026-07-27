# ADR 0005: Markdown default + HTML artifact port + path-based images

## Status

Accepted (2026-07-19)

## Context

Need Claude-like artifacts and Codex-like image UX without unsafe ad-hoc iframes. Local `openwebui_m` already has a rigorous HTML artifact stack.

## Decision

1. Default chat rendering = **Markdown**
2. HTML artifact runtime = **port pure logic** from `openwebui_m` into `@piwin/artifact`
3. Images: preview in chat; paste saves under `~/.piwin/media/...`; text models receive **absolute path** by default
4. **Coding-agent phase policy (2026-07-25 amendment):**
   - While an assistant message is **streaming**, render safe Markdown only: incomplete fences stay source, Mermaid does not execute, and Artifact iframes are not mounted.
   - When a message is **completed**, normal code fences remain source-first with copy affordances.
   - An HTML/UI Artifact is **source-first** and only mounts an iframe after an explicit user **Preview artifact** action (or an explicit-artifact-review mode), and only when security classification allows it.
   - Thinking/tool work uses timeline/cards, not Artifacts.

## Consequences

- Extra package boundary (`artifact`, `media`)
- Must invest in tests for security classifier
- Vision multipart is optional later, not default
- Ordinary coding turns stay legible and cheap to stream; Artifacts remain deliberate interactive deliverables
