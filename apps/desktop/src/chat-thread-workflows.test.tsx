// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { ChatThread } from './chat-thread.js';
import type { ComposerDockProps } from './composer-dock.js';
import type { ChatMessageUi } from './chat-reducer.js';
function noop(): void {
  /* test callback */
}

const composerCard: ComposerDockProps = {
  layoutMode: 'docked',
  projectPath: null,
  projectTrusted: true,
  activeSessionId: null,
  streaming: false,
  runPhase: 'idle',
  compacting: false,
  composer: '',
  onComposerChange: noop,
  agentMode: 'agent',
  onAgentModeChange: noop,
  pendingAttachments: [],
  onRemoveAttachment: noop,
  dropActive: false,
  onDropActiveChange: noop,
  plusMenuOpen: false,
  onPlusMenuOpenChange: noop,
  plusSubmenu: 'none',
  onPlusSubmenuChange: noop,
  modelOptions: [],
  selectedModelKey: '',
  onSelectModel: noop,
  menuSkills: [],
  menuMcp: [],
  onRefreshComposerMenus: noop,
  onOpenSkillsPanel: noop,
  onOpenMcpPanel: noop,
  onAttachFile: noop,
  onAttachImage: noop,
  onPaste: noop,
  onDrop: noop,
  onSend: noop,
  onPause: noop,
  onAbort: noop,
  onCompact: noop,
  contextUsage: null,
  onSteer: noop,
  onFollowUp: noop,
};


it('renders a native background workflow inside the initiating assistant turn after prompt completion', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const messages: ChatMessageUi[] = [
    { id: 'u1', role: 'user', text: '/deep-research 鲸鱼形象', createdAt: '2026-10-02T14:32:00Z', thinking: '', tools: [], attachments: [], status: 'done' },
    { id: 'a1', role: 'assistant', text: 'Research started', thinking: '', tools: [], attachments: [], status: 'done' },
    { id: 'u2', role: 'user', text: '第二个问题', createdAt: '2026-10-02T14:32:01Z', thinking: '', tools: [], attachments: [], status: 'done' },
    { id: 'a2', role: 'assistant', text: 'Second answer', thinking: '', tools: [], attachments: [], status: 'done' },
  ];
  const request = vi.fn().mockResolvedValue({ success: true, data: { sessionId: 's1', workflows: [{
    workflowId: 'wf_test', sessionId: 's1', agentId: 'grok', name: 'deep-research', objective: '鲸鱼形象',
    status: 'active', revision: 1, phases: [{ title: 'Plan', status: 'active' }], agents: [], reportAvailable: false,
    history: [{ event: 'workflow_started', at: '2026-10-02T14:20:01Z' }],
  }] } });
  try {
    await act(async () => root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <ChatThread messages={messages} sessionId="s1" workflowRequest={request} streaming={false}
        editingMessageId={null} lastUserMessageId="u2" activeTheme={null} artifactThemeKey={0}
        onEdit={noop} onCancelEdit={noop} onEditResend={noop} onRetry={noop}
        onInspectSubagent={undefined} composerCard={composerCard} locale="zh-CN" artifactInlineEnabled />
    </PiwinUiProvider>));
    const workflow = container.querySelector('[data-testid="backend-workflow-card"]');
    const owner = workflow?.closest('.chat-turn-group');
    expect(workflow?.closest('.chat-turn-assistant')).not.toBeNull();
    expect(owner?.querySelector('#msg-u1')).not.toBeNull();
    expect(owner?.querySelector('#msg-u2')).toBeNull();
    expect(workflow?.textContent).toContain('规划');
    expect(owner?.textContent).toContain('运行中');
    expect(container.querySelector('[data-testid="run-status-footer"]')).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  } finally { act(() => root.unmount()); container.remove(); }
});
