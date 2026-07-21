# M2 Spec — Agent Window MVP (design + task breakdown)

| Field | Value |
|-------|-------|
| Status | Implemented (MVP); deferred in docs/todo-deferred.md |
| Depends on | M1 host contracts stable |
| Packages | apps/desktop, ui-kit, session, project, agent-host, contracts |

## Goal

Tauri 2 desktop Agent Window:

1. Open/trust project
2. Session history
3. New/resume session
4. Markdown chat + tool cards
5. Model picker from dual protocol configs

Same `@piwin/agent-host` as CLI. No Pi imports in UI.

## UI layout

```text
Left: Projects + Sessions
Center: Chat stream (markdown, tools, thinking) + Composer
Right (P1): Session tree
```

## Process architecture

```text
Tauri WebView (React)  --IPC-->  Node host sidecar (agent-host)
                                      |
                               PiSdk / PiRpc / Mock
```

**Choice:** Tauri commands for request/response; Tauri events for AgentEvent stream.
Sidecar: child process `piwin host serve` or equivalent.

### IPC draft

UI → Host: project/open, session/list|create|resume|prompt|abort|steer, config/get|set, permission/resolve  
Host → UI: event (AgentEvent), permission/request, host/status

## Task phases

### Phase A — Scaffold (M2.1)
| ID | Task | Exit |
|----|------|------|
| M2.1.1 | Tauri 2 + Vite + React + TS in apps/desktop | window opens |
| M2.1.2 | pnpm workspace scripts | pnpm dev:desktop |
| M2.1.3 | 3-pane chrome | static layout |
| M2.1.4 | Rust install docs | documented |

### Phase B — Host bridge (M2.2)
| ID | Task | Exit |
|----|------|------|
| M2.2.1 | HostCommand/HostPush in contracts | types |
| M2.2.2 | piwin host serve | process streams |
| M2.2.3 | Tauri spawn + forward | UI gets events |
| M2.2.4 | Frontend HostClient | fake client tests |
| M2.2.5 | dispose on window close | no zombies |

### Phase C — Project + sessions (M2.3–M2.4)
| ID | Task | Exit |
|----|------|------|
| M2.3.1 | project open + trust in ~/.piwin | persisted |
| M2.3.2 | folder dialog | path bound |
| M2.3.3 | trust modal | confirm |
| M2.4.1 | session list UI | renders |
| M2.4.2 | new/resume | works |

### Phase D — Chat UX (M2.5)
| ID | Task | Exit |
|----|------|------|
| M2.5.1 | AgentEvent → ChatUiState reducer | unit tests |
| M2.5.2 | Markdown (no raw HTML exec) | GFM-ish |
| M2.5.3 | Tool cards | visible |
| M2.5.4 | Thinking collapsible | optional |
| M2.5.5 | Composer send/abort | works |
| M2.5.7 | Permission modal | allow/deny |

### Phase E — Models (M2.6)
| ID | Task | Exit |
|----|------|------|
| M2.6.1 | Settings providers list | shows |
| M2.6.2 | OpenAI + Anthropic forms | saves config |
| M2.6.3 | Model picker in header | createSession uses it |

## UI state

```ts
type ChatUiState = {
  projectPath: string | null;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  messages: ChatMessageUi[];
  streaming: boolean;
  permissionPrompt: null | { requestId: string; action: string; detail: string };
  config: PiwinConfig | null;
  hostMode: HostMode;
  error: string | null;
};
```

Reducer only consumes AgentEvent (+ local user echo).

## Acceptance
1. pnpm dev:desktop launches
2. open project → trust → sessions
3. chat streams markdown (mock or real)
4. tool cards when tools fire
5. provider config save/load
6. no @earendil-works in apps/desktop
7. CLI regression still green

## Schedule (after M1)
D1–2 scaffold · D3–5 bridge · D6–8 project/sessions · D9–12 chat · D13–14 models/polish

## ADRs when implementing
- 0006 Desktop host transport
- 0007 Session index storage

## M1 → M2 gate
- AgentEvent stable
- createAgentHost + mock session works
- config load/save exists
- permission pure functions exist
