// @vitest-environment happy-dom
import { act, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { createSessionTranscriptPage } from '@piwin/session';
import {
  SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
  SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
} from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens.js';
import type { ComposerDockProps } from '../composer/composer-dock.js';
import { globalMemoryGovernor, type MemoryPressureLevel } from '../notes/memory-governor.js';
import {
  buildSessionStartupSnapshot,
  readSessionStartupSnapshot,
  writeSessionStartupSnapshot,
} from '../session/session-startup-cache.js';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer.js';
import { ChatThread } from './chat-thread.js';
import { TranscriptScrollProvider } from './transcript-scroll-port.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function noop(): void {}

const COMPOSER_CARD: ComposerDockProps = {
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
};

function makePelicanSizedSession(): SessionTranscriptMessage[] {
  const thinkingSizes = [118_814, 119_868, 128_882, 87_034, 81_875, 97_486];
  const toolSizes = [400, 3_000, 13_000, 350, 15_500, 600];
  const messages: SessionTranscriptMessage[] = [
    {
      id: 'user-1',
      role: 'user',
      text: '画一个2D的鹈鹕骑自行车的html动画',
      createdAt: '2026-11-21T03:30:49.000Z',
      status: 'done',
    },
  ];
  for (let i = 0; i < thinkingSizes.length; i += 1) {
    messages.push({
      id: `assistant-step-${i + 1}`,
      role: 'assistant',
      text: '',
      thinking: 't'.repeat(thinkingSizes[i]!),
      tools: [
        {
          toolCallId: `tc-${i + 1}`,
          toolName: 'read',
          status: 'done',
          output: 'o'.repeat(toolSizes[i]!),
          runId: 'run-1',
        },
      ],
      createdAt: `2026-11-21T03:31:0${i}.000Z`,
      runId: 'run-1',
      status: 'done',
    });
  }
  messages.push({
    id: 'assistant-final',
    role: 'assistant',
    text: `Here is the animation:\n\n\`\`\`artifact-html title="pelican"\n${'<div>p</div>'.repeat(2300)}\n\`\`\``,
    thinking: 't'.repeat(126_250),
    tools: [],
    createdAt: '2026-11-21T03:41:15.000Z',
    runId: 'run-1',
    status: 'done',
  });
  return messages;
}

describe('old session blank repro', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalMemoryGovernor.reset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalMemoryGovernor.reset();
  });

  it.each<MemoryPressureLevel>(['normal', 'moderate', 'critical'])(
    'renders old heavy-thinking session under %s memory pressure',
    (level) => {
      const sourceMessages = makePelicanSizedSession();
      const pageResult = createSessionTranscriptPage(sourceMessages, {
        sessionId: 'pelican-session',
        limit: SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
        maximumBytes: SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
      });
      expect(pageResult.status).toBe('page');
      if (pageResult.status !== 'page') return;

      console.log(`[repro ${level}] host page messages:`, pageResult.messages.map((m) => ({
        id: m.id,
        role: m.role,
        textLen: m.text.length,
        thinkingLen: m.thinking?.length ?? 0,
      })), 'pageBytes:', pageResult.page.messageBytes);

      expect(pageResult.messages.length).toBeGreaterThan(0);

      globalMemoryGovernor.setLevel(level);

      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'pelican-session' });
      state = chatUiReducer(state, {
        type: 'session/load-messages',
        sessionId: 'pelican-session',
        messages: pageResult.messages,
        transcriptPage: pageResult.page,
      });

      console.log(`[repro ${level}] reducer messages:`, state.messages.map((m) => ({
        id: m.id,
        role: m.role,
        textLen: m.text.length,
        thinkingLen: m.thinking.length,
      })));

      expect(state.messages.length).toBeGreaterThan(0);

      function Harness(): ReactElement {
        const scrollRef = useRef<HTMLDivElement | null>(container);
        return (
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <TranscriptScrollProvider sessionId="pelican-session" scrollElementRef={scrollRef}>
              <ChatThread
                messages={state.messages}
                sessionId="pelican-session"
                streaming={false}
                editingMessageId={null}
                lastUserMessageId={null}
                activeTheme={PIWIN_APPEARANCE_DARK}
                artifactThemeKey={1}
                composerCard={COMPOSER_CARD}
                onInspectSubagent={undefined}
                artifactInlineEnabled
                locale="zh-CN"
                canLoadOlder={Boolean(state.transcriptWindow?.olderCursor)}
              />
            </TranscriptScrollProvider>
          </PiwinUiProvider>
        );
      }

      act(() => {
        root.render(<Harness />);
      });

      const turns = container.querySelectorAll('.chat-turn-group');
      console.log(`[repro ${level}] rendered turns:`, turns.length, 'textLen:', container.textContent?.length);
      expect(turns.length).toBeGreaterThan(0);
      expect(container.querySelector('#msg-assistant-final')).not.toBeNull();
    },
  );

  it('roundtrips startup snapshot with heavy-thinking session', () => {
    const sourceMessages = makePelicanSizedSession();
    const pageResult = createSessionTranscriptPage(sourceMessages, {
      sessionId: 'pelican-session',
      limit: SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
      maximumBytes: SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
    });
    if (pageResult.status !== 'page') throw new Error('unexpected stale cursor');

    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'pelican-session' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'pelican-session',
      messages: pageResult.messages,
      transcriptPage: pageResult.page,
    });

    const snapshot = buildSessionStartupSnapshot(state);
    console.log('[repro startup] snapshot:', snapshot ? snapshot.messages.map((m) => m.id) : null);
    expect(snapshot).not.toBeNull();
    if (!snapshot) return;

    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v); },
      removeItem: (k: string) => { map.delete(k); },
    };
    writeSessionStartupSnapshot('local', snapshot, storage);
    const readBack = readSessionStartupSnapshot('local', storage);
    console.log('[repro startup] readBack:', readBack ? readBack.messages.map((m) => m.id) : null);
    expect(readBack).toBeDefined();
    expect(readBack?.messages.length).toBeGreaterThan(0);
  });
});
