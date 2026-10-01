// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import type { ChatMessageUi, CompactionActivityUi, RunRecordUi } from './chat-reducer.js';
import { ChatThread } from './chat-thread.js';
import type { ComposerDockProps } from './composer-dock.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

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

function message(id: string, overrides: Partial<ChatMessageUi>): ChatMessageUi {
  return {
    id,
    role: 'assistant',
    text: '',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
    ...overrides,
  };
}

function renderThread(
  messages: ChatMessageUi[],
  extras: {
    streaming?: boolean;
    activeRunId?: string | null;
    runRecordsById?: Record<string, RunRecordUi>;
    isConversationSession?: boolean;
    compactionActivity?: CompactionActivityUi | null;
  } = {},
): ReactElement {
  return (
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <ChatThread
        messages={messages}
        {...(extras.compactionActivity !== undefined
          ? { compactionActivity: extras.compactionActivity }
          : {})}
        sessionId="disclosure-session"
        streaming={extras.streaming === true}
        editingMessageId={null}
        lastUserMessageId="user-1"
        activeTheme={null}
        artifactThemeKey={0}
        runRecordsById={
          extras.runRecordsById ?? {
            'run-1': {
              runId: 'run-1',
              phaseHistory: [],
              startedAt: 1_000,
              endedAt: 95_000,
              outcome: 'completed',
            },
          }
        }
        activeRunId={extras.activeRunId === undefined ? null : extras.activeRunId}
        onEdit={noop}
        onCancelEdit={noop}
        onEditResend={noop}
        onRetry={noop}
        onInspectSubagent={undefined}
        artifactInlineEnabled
        composerCard={composerCard}
        locale="en"
        {...(extras.isConversationSession === true
          ? { isConversationSession: true }
          : {})}
      />
    </PiwinUiProvider>
  );
}

describe('ChatThread compaction seam', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function activity(
    overrides: Partial<CompactionActivityUi> = {},
  ): CompactionActivityUi {
    return {
      operationId: 'compact-1',
      phase: 'succeeded',
      reason: 'overflow',
      anchorMessageId: 'assistant-before',
      startedAt: 10_000,
      endedAt: 45_000,
      tokensBefore: 571_000,
      tokensAfter: 21_000,
      durationMs: 35_000,
      ...overrides,
    };
  }

  const liveRun = {
    streaming: true,
    activeRunId: 'run-1',
    runRecordsById: {
      'run-1': { runId: 'run-1', phaseHistory: [], startedAt: 1_000, endedAt: null },
    } satisfies Record<string, RunRecordUi>,
  };

  const transcript = [
    message('user-1', { role: 'user', text: 'keep going' }),
    message('assistant-before', { text: 'BEFORE-COMPACTION', runId: 'run-1' }),
    message('assistant-after', { text: 'AFTER-COMPACTION', runId: 'run-1', status: 'streaming' }),
  ];

  it('keeps the run status footer once a compaction has settled', () => {
    act(() => {
      root.render(renderThread(transcript, { ...liveRun, compactionActivity: activity() }));
    });
    expect(container.querySelector('[data-testid="compaction-activity"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="run-status-footer"]')).not.toBeNull();
  });

  it('hands the foot of the turn to a compaction that is still running', () => {
    act(() => {
      root.render(
        renderThread(transcript, {
          ...liveRun,
          compactionActivity: activity({ phase: 'running' }),
        }),
      );
    });
    expect(container.querySelector('[data-testid="compaction-spinner"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="run-status-footer"]')).toBeNull();
  });

  it('draws the seam between the anchor and the rows generated after it', () => {
    act(() => {
      root.render(renderThread(transcript, { ...liveRun, compactionActivity: activity() }));
    });
    const text = container.textContent ?? '';
    const before = text.indexOf('BEFORE-COMPACTION');
    const seam = text.indexOf('Context compacted');
    const after = text.indexOf('AFTER-COMPACTION');
    expect(before).toBeGreaterThanOrEqual(0);
    expect(seam).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(seam);
  });

  it('follows the anchor down the turn instead of sticking to its foot', () => {
    act(() => {
      root.render(
        renderThread(transcript, {
          ...liveRun,
          compactionActivity: activity({ anchorMessageId: 'assistant-after' }),
        }),
      );
    });
    const text = container.textContent ?? '';
    expect(text.indexOf('Context compacted')).toBeGreaterThan(text.indexOf('AFTER-COMPACTION'));
  });
});
