# ADR 0098: Community capability search (skills.sh, MCP registry, Pi packages) and single-confirmation installs

- **Status**: Accepted
- **Date**: 2026-10-21
- **Scope**: `@piwin/marketplace` (`search-skills-sh`, `search-marketplace`, `mcp-official-registry`, `skill-detail`, skill catalog), `@piwin/skills` (`locate-skill-directory`, `install-skill`, `skill-origin`, `update-skill`), `@piwin/host-runtime` (`capability-tools`, `capability-community*`, `capability-mcp-connect`, `skill-update-commands`, inventory projection), `@piwin/contracts` (`MarketplaceSearchHit`, `marketplace/search` `sources`, `marketplace/package-detail` `skill`, `skills/update`, `SkillInstallOrigin`, `withMcpEnvPlaceholders`, `parseSkillFrontmatter`), Desktop marketplace, CLI `piwin skill`
- **Consults**: ADR 0077 (GitHub extension registry), `docs/guides/extension-registry.md`

## Context

Skill discovery only covered the five curated anthropics/skills entries.
When a user asked the agent for any other skill, `capability_search` found
nothing and the agent fell back to asking whether the skill was "in the
curated catalog". Even for curated hits, the `capability_install` description
told the agent to confirm in chat first, so every install was confirmed twice
(chat, then the permission prompt).

Separately, the Desktop live-search install for a skill hit sent only the
repository URL and display name; for a multi-skill repo the installer copied
the whole repository into `~/.piwin/skills/<name>`.

## Decision

1. **skills.sh is the community skill index.** `searchSkillsSh` queries
   `https://skills.sh/api/search` (installs-ranked, no auth). Only GitHub
   `owner/repo` sources are kept; hits carry `curated: false`, `installs`,
   and an exact `skillSource` (`git` URL of the repo). Entry ids are
   `skills.sh:<owner>/<repo>/<skill>`.
2. **One search, curated first.** `searchMarketplaceSources` and the agent's
   `capability_search` return curated skills first (`curated: true`, pinned
   commit + subdir in `skillSource`), then community skills, dropping
   community copies of curated ones. skills.sh failures degrade to curated
   results plus a reported error. Empty queries never call skills.sh.
3. **The permission prompt is the only confirmation.** `capability_install`
   accepts curated ids and `skills.sh:` ids and tells the agent to call it
   directly once the user asked, without confirming in chat or asking whether
   the entry is curated. The per-install prompt (`rememberable: false`) stays
   — community skills are unreviewed code and the prompt is the user's gate.
4. **Install locates the skill folder by name.** For git sources,
   `locateSkillDirectory` uses `subdir` (or the repo root) when it holds
   `SKILL.md`; otherwise it searches up to four levels (skipping dot folders
   and `node_modules`) for a folder or SKILL.md `name:` matching the requested
   name, falling back to the only skill in the tree. Ambiguity is an error
   listing available skills. Only that folder is copied, and the recorded
   source includes the located `subdir`.
5. **No silent overwrite from community installs.** A `skills.sh:` install
   whose skill name is already installed returns "already installed" instead
   of replacing the user's skill.
6. **Skill details show the skill, not the repo.** `marketplace/package-detail`
   takes `skill: { name, subdir?, ref? }`; the Host reads that skill's
   SKILL.md (exact path when known, else located through the GitHub tree
   listing) and returns its body plus the frontmatter `description`, falling
   back to the repository README.
7. **Official MCP registry, parsed for what piwin can run.** The registry
   (`/v0/servers`, schema 2025-12-11) nests entries under `server` and lists
   every published version. Cards keep one entry per name (`isLatest` wins)
   and build a stdio draft only from npm (`npx -y <pkg>@<ver>`) or PyPI
   (`uvx <pkg>==<ver>`) packages with stdio transport; required env vars
   without defaults become `requiredEnv`; remote-only servers are listed with
   `requiresSse` and are not installable. A server with `requiredEnv` is saved
   with empty placeholders and **not started** — the user fills the values in
   Settings → MCP (secrets never pass through chat). The old code guessed
   `npx -y <registry name>`, which is not an npm package name.
8. **The slow registry search runs apart.** The registry's search is a full
   scan (20–40 s observed; ~20k servers, >17 MB, so no local index).
   `marketplace/search` takes `sources` (`packages` | `mcp` | `skills`);
   Desktop sends fast sources and MCP as two requests, shows the fast results
   at once and appends MCP hits when they arrive. Registry searches time out at
   45 s (Desktop allows `marketplace/search` 60 s), are cached in memory for 10 minutes, and their failures are reported
   (`remoteError` / agent output) instead of looking like "no results".
9. **Agent community installs beyond skills.** `capability_search` with a
   query also returns official-registry MCP servers (`mcp-registry:<name>`)
   and npm/GitHub Pi packages (`npm:<name>`, `github:<owner>/<repo>`).
   MCP installs accept only cards this tool set returned from a search, so the
   saved command is always the registry's own draft. Pi packages install
   through the same validated resolver as Desktop and activate after the turn;
   packages piwin already covers natively (`pi-mcp-adapter`, `pi-subagents`)
   are refused. `extension_install` points npm packages at
   `capability_install` instead of handing the user a shell command.
10. **Git skill installs record their origin; unpinned ones can update.**
    `installSkill` writes `.piwin-origin.json` (url, subdir, ref, installed
    commit) and drops a cloned `.git`. The scanner exposes it as
    `SkillSummary.origin`; inventory items for non-catalog, unpinned origins
    carry `sourceUpdate: { command: 'skills/update' }`, shown as "Check for
    update" in Desktop and `piwin skill update <id>` in the CLI. Pinned
    (curated) installs are refused there and keep updating through the catalog.
11. **Curated catalog adds Anthropic's pdf/docx/xlsx/pptx skills** at the same
    pinned commit. skills.sh has no browse/leaderboard API (an empty query is
    rejected), so the empty-query view stays the curated catalog.
12. **CLI parity.** `piwin skill install skills.sh:<owner>/<repo>/<skill>`
    installs a community skill by the id `piwin market search` prints.

## Consequences

- Community skills install from the repository default branch (not pinned);
  the Desktop dialog and agent output say they are not reviewed by piwin.
- Desktop hides curated skill hits from the community section (their catalog
  card already shows) and shows install counts for community skills.
- CLI `piwin skill install --git <url> --name <skill>` benefits from the same
  folder location, so the `installCommand` shown for skill hits now works.
- MCP results on Desktop can arrive up to ~45 s after the rest; the community
  caption says the registry is still searching, and the grid never reflows
  for that notice.
- Skills installed before this change have no origin record and show no
  update action until reinstalled.
