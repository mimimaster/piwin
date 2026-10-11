import { useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { emit } from '@tauri-apps/api/event';
import { mockIPC } from '@tauri-apps/api/mocks';
import { Button, PiwinUiProvider } from '@piwin/ui-kit';
import {
  applyAppearanceToDocument, PIWIN_APPEARANCE_DARK, PIWIN_APPEARANCE_LIGHT,
} from '../../src/appearance-tokens.js';
import type { AgentCliHost } from '../../src/agent-cli-pty.js';
import type { HostServerMessage } from '@piwin/contracts';
import { ContextBar } from '../../src/context-bar.js';
import { ConversationShellSwitch } from '../../src/conversation-shell-switch.js';
import { WorkbenchTuiStage, useWorkbenchTui } from '../../src/workbench-tui.js';
import { WorkspaceShell } from '../../src/workspace-shell.js';
import '../../src/styles.css';

const parameters = new URLSearchParams(location.search);
const manifest = parameters.get('theme') === 'paper' ? PIWIN_APPEARANCE_LIGHT : PIWIN_APPEARANCE_DARK;
applyAppearanceToDocument(manifest);
const agentId = parameters.get('agent') === 'grok' ? 'grok' : 'pi';
let ptySequence = 0;
let activePtyId: string | undefined;
const openDelay = parameters.has('delayed') ? 300 : 0;
// Invoke events are real Tauri JS events; xterm rendering and resize are real.
// Only the native child process is replaced with a predictable initial frame.
mockIPC(async (command, payload) => {
  if (command === 'pty_open_remote_tui' || command === 'pty_open_tui') {
    ptySequence += 1;
    activePtyId = `layout-pty-${ptySequence}`;
    document.documentElement.dataset.ptyOpens = String(ptySequence);
    document.documentElement.dataset.ptyCols = String(payload?.cols);
    if (openDelay > 0) await new Promise((resolve) => setTimeout(resolve, openDelay));
    await emit('pty_data', { pty_id: activePtyId, data: '输入消息开始对话...\r\n────────────────────────\r\n' });
    return { pty_id: activePtyId };
  }
  if (command === 'pty_resize' && payload !== undefined && 'cols' in payload) {
    document.documentElement.dataset.ptyCols = String(payload.cols);
  }
  return undefined;
}, { shouldMockEvents: true });

const hostListeners = new Set<(message: HostServerMessage) => void>();
const host: AgentCliHost = {
  request: async (command) => {
    if (command.type === 'agents/cli-open') {
      ptySequence += 1; activePtyId = `grok-pty-${ptySequence}`;
      document.documentElement.dataset.ptyOpens = String(ptySequence);
      document.documentElement.dataset.ptyCols = String(command.input.cols);
      document.documentElement.dataset.ptyRows = String(command.input.rows);
      document.documentElement.dataset.cliAgent = 'grok';
      for (const listener of hostListeners) listener({ type: 'pty/output', ptyId: activePtyId, data: '\u001b[?1000h\u001b[?1006hGrok Build native CLI\r\n/Users/me/.grok/sessions/demo/images/1.jpg\r\n\r\n    [Open Image]\r\n', at: '' });
      return { type: 'response', command: command.type, success: true, data: { ptyId: activePtyId, sessionId: 'session-layout' } };
    }
    if (command.type === 'pty/resize') { document.documentElement.dataset.ptyCols = String(command.cols); document.documentElement.dataset.ptyRows = String(command.rows); }
    if (command.type === 'pty/write') document.documentElement.dataset.ptyWrites = String(Number(document.documentElement.dataset.ptyWrites ?? 0) + 1);
    return { type: 'response', command: command.type, success: true, data: {} };
  },
  subscribe: (listener) => { hostListeners.add(listener); return () => { hostListeners.delete(listener); }; },
};

function LayoutFixture() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const projectPath = agentId === 'grok' && sessionId !== null ? 'project-'+'a'.repeat(24) : null;
  const tui = useWorkbenchTui({ available: true, sessionId, scopeKey: projectPath ?? 'general', hostKey: 'host-fixture' });
  const selected = tui.active;
  const centered = parameters.get('centered') !== 'false' && sessionId === null;
  return (
    <PiwinUiProvider manifest={manifest}>
      <div className="app-shell workbench" data-layout="desktop" style={{ '--sidebar-width': '240px' } as CSSProperties}>
        <WorkspaceShell
          titlebar={<ContextBar session={{ title: '素笺', scopeLabel: '项目' }} locale="zh-CN"
            appearanceMode={manifest.mode === 'light' ? 'light' : 'dark'}
            runState={{ kind: 'idle', label: 'Idle', summary: '', completedToolCount: 0, runningJobCount: 0, canStop: false }}
            onStop={() => undefined} onViewActivity={() => undefined} onReviewPermission={() => undefined}
            onViewPlan={() => undefined} onCancelCompact={() => undefined} onToggleAppearance={() => undefined}
            conversationShellControl={<ConversationShellSwitch cli={selected} locale="zh-CN"
              appearanceMode={manifest.mode === 'light' ? 'light' : 'dark'} onCli={tui.open} onDesktop={tui.close} />}
          />}
          sidebar={<aside className="sidebar" />}
          rightPanel={null}
          chatColumnClassName={centered ? 'chat-column-empty' : undefined}
          transcript={<div>研墨起笔</div>}
          composerDock={<textarea data-testid="composer-input" placeholder="输入消息" />}
          conversationOverrideActive={selected}
          conversationOverride={tui.mounted ? <WorkbenchTuiStage visible={selected}
            sessionId={sessionId} projectPath={projectPath} locale="zh-CN" agentId={agentId} hostClient={host}
            remoteTarget={{ endpoint: 'wss://layout.example' }}
            onSessionChange={(id) => { tui.adopt(id); setSessionId(id); }}
            onOpenImage={(fileName) => { document.documentElement.dataset.openedImage = fileName; }}
          /> : undefined}
        />
        {selected ? <Button style={{ position: 'fixed', bottom: 4, left: 4, zIndex: 100 }} data-testid="fixture-adopt-session"
          onClick={() => {
            if (activePtyId === undefined) throw new Error('PTY not open');
            void emit('pty_data', { pty_id: activePtyId, data: '\x1b]777;piwin;session;session-layout\x07' });
          }}>Adopt session</Button> : null}
      </div>
    </PiwinUiProvider>
  );
}
const root = document.getElementById('root');
if (root === null) throw new Error('fixture root missing');
createRoot(root).render(<LayoutFixture />);
