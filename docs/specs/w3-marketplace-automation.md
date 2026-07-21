# Wave 3 Spec — Skills Hub · MCP Registry · Cron · Hooks · Session Todo

| Field | Value |
|-------|-------|
| Status | **Ready for implementation planning** |
| Date | 2026-07-21 |
| Program | [`program-capability-expansion.md`](./program-capability-expansion.md) |
| Prerequisite | W1 host tools solid; Skills/MCP panels; marketplace local/git |
| Packages | marketplace, skills, mcp, automation (new), agent-host, desktop, cli |

## 1. Goals
1. One-click **Skills Hub** + **MCP Registry** install (no private central store).
2. **Cron** (prompt first; bash/http next) and lifecycle **Hooks**.
3. Session **Todo** tool in Execution panel.
4. Install paths stay under `~/.piwin` + Pi ResourceLoader / mcp.json.

## 2. Non-goals
Hosted piwin registry; full ClawHub if API unstable; multi-tenant cron; hooks in renderer.

## 3. CE-HUB-SK Skills Hub
### UX
Settings → Skills: **Installed** | **Store** tabs; preview drawer; install progress/cancel.

### Sources
static-catalog (existing) | git-index URL | clawhub (flagged) | local-folder.

### Install
Reuse marketplace stage-then-swap into `~/.piwin/skills/<name>/` with `_meta.json` provenance.
Jobs: install_start / install_status / install_cancel.
Pi packages (`package.json` `pi.skills`) preferred when detected.

### Accept
Search+install with progress; cancel leaves no half skill; disabled not in ResourceLoader; CLI search/install.

## 4. CE-HUB-MCP MCP Registry
### UX
Configured | Registry tabs; card → install draft → form → save → optional Start.

### Adapters
official registry.modelcontextprotocol.io | Smithery | Glama (optional).
Normalize to McpRegistryCard with installDraft vs manualDraft.

### Transport
stdio first; HTTP/SSE links residual D-MCP-05 with badge.

### Accept
Fixture registry browse; draft creates valid mcp.json; tools/list after start.

## 5. CE-CRON
### Package `@piwin/automation`
CronJob types: prompt | bash | http; store `~/.piwin/automation/cron.json` + runs/.

### Scheduler
HostRuntime arms timers while desktop/host running. Document need for app-up for prompt jobs.
Optional residual: `piwin automation serve` headless.

### Ship order
W3.a prompt only → W3.b bash (hard-gate) → W3.c http (SSRF policy).

### Prompt job
Trusted project → automation session kind=cron → prompt → run log → automation/cron_finished.

### UI/CLI
Settings → System → Automation; `piwin cron list|add|run|disable`. Optional tool cron_manager.

### Accept
Test minute job fires with mock; disabled does not; bash denied without allow; history visible.

## 6. CE-HOOK
### Design default
HostRuntime runs hooks on normalized AgentEvent (testable). Extension bridge only if unmapped events needed.

### Model
events: agent_start/end, turn_start/end, tool_execution_end.
actions: shell (argv, timeout) | http (SSRF-guarded).
Env allowlist: PIWIN_SESSION_ID, PIWIN_PROJECT_PATH, PIWIN_EVENT_JSON (truncated).

### Security
Automation disabled by default; shell hooks need automation:hook-shell once/project; never pass API keys.

### Accept
turn_end shell appends test file; hook failure does not crash turn; timeout kills child.

## 7. CE-TODO
Tool `todo_write` replaces full session list; in-memory + optional session todos.json.
Execution panel checklist; not shared with sub-agent; chat scope only.

### Accept
Model updates reflect in panel; new session empty.

## 8. Config
```ts
automation?: { enabled?, cronEnabled?, hooksEnabled? }
marketplace?: { skillSources?, mcpRegistrySources? }
```

## 9. Slices
S1 Skills Hub+job → S2 MCP registry → S3 prompt cron → S4 bash/http cron → S5 hooks → S6 todo.

## 10. Coordination
Share marketplace staging with D-EXT-03 paths; single MCP save path; cron sessions respect customTools capability.

## 11. Open
ClawHub behind flag; automation serve W3 vs W4; hook payload versioning.
