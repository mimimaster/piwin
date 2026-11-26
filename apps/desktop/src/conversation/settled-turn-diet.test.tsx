// @vitest-environment happy-dom
import { act, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens.js';
import type { ComposerDockProps } from '../composer/composer-dock.js';
import { globalMemoryGovernor } from '../notes/memory-governor.js';
import { ArtifactFenceController } from '../artifact/artifact-fence-controller.js';
import { SourceCodeBlock } from '../markdown/markdown-code-block.js';
import type { ChatMessageUi } from './chat-reducer.js';
import { ChatThread } from './chat-thread.js';
import { TranscriptScrollProvider } from './transcript-scroll-port.js';
import { TranscriptViewport } from './transcript-viewport.js';
import {
  SettledTurnDietProvider,
  resolveLiveStaticTurnTailCap,
} from './settled-turn-diet.js';

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

function makeTurnMessages(turnCount: number): ChatMessageUi[] {
  const messages: ChatMessageUi[] = [];
  for (let turn = 0; turn < turnCount; turn += 1) {
    messages.push({
      id: `user-${turn}`,
      role: 'user',
      text: `Prompt turn ${turn}`,
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      createdAt: `2026-11-18T10:${String(turn).padStart(2, '0')}:00.000Z`,
    });
    messages.push({
      id: `assistant-${turn}`,
      role: 'assistant',
      text: `Reply turn ${turn}`,
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      createdAt: `2026-11-18T10:${String(turn).padStart(2, '0')}:01.000Z`,
    });
  }
  return messages;
}

describe('settled-turn diet & bounded static tail', () => {
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

  it('caps live static turns at 8 across normal, moderate, and critical pressure and avoids virtual window', () => {
    expect(resolveLiveStaticTurnTailCap('normal')).toBe(8);
    expect(resolveLiveStaticTurnTailCap('moderate')).toBe(8);
    expect(resolveLiveStaticTurnTailCap('critical')).toBe(8);

    function Harness({ messages }: { messages: ChatMessageUi[] }): ReactElement {
      const scrollRef = useRef<HTMLDivElement | null>(container);
      return (
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TranscriptScrollProvider sessionId="tail-test" scrollElementRef={scrollRef}>
            <ChatThread
              messages={messages}
              sessionId="tail-test"
              streaming={false}
              editingMessageId={null}
              lastUserMessageId="user-11"
              activeTheme={PIWIN_APPEARANCE_DARK}
              artifactThemeKey={1}
              composerCard={COMPOSER_CARD}
              onInspectSubagent={undefined}
              artifactInlineEnabled
              locale="zh-CN"
            />
          </TranscriptScrollProvider>
        </PiwinUiProvider>
      );
    }

    const messages = makeTurnMessages(12);
    act(() => {
      root.render(<Harness messages={messages} />);
    });

    // Normal pressure mounts only newest 8 turns in static flow (turns 4..11), no virtualizer wrapper.
    expect(container.querySelector('[data-testid="transcript-turn-window"]')).toBeNull();
    expect(container.querySelector('#msg-user-0')).toBeNull();
    expect(container.querySelector('#msg-user-4')).not.toBeNull();
    expect(container.querySelector('#msg-user-11')).not.toBeNull();

    const expandButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="transcript-bounded-tail-button"]',
    );
    expect(expandButton?.textContent).toContain('已收起 4 轮');

    act(() => {
      expandButton?.click();
    });
    expect(container.querySelector('#msg-user-0')).not.toBeNull();
    expect(container.querySelector('[data-testid="transcript-bounded-tail-bar"]')).toBeNull();

    // Critical pressure keeps the static tail cap at 8 while preserving expanded turns.
    act(() => {
      globalMemoryGovernor.setLevel('critical');
    });
    expect(container.querySelectorAll('.chat-turn-group')).toHaveLength(12);

    const nextMessages = [...messages, ...makeTurnMessages(1).map((m, idx) => ({
      ...m,
      id: idx === 0 ? 'user-12' : 'assistant-12',
    }))];
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TranscriptScrollProvider sessionId="tail-test" scrollElementRef={{ current: container }}>
            <ChatThread
              messages={nextMessages}
              sessionId="tail-test"
              streaming={false}
              editingMessageId={null}
              lastUserMessageId="user-12"
              activeTheme={PIWIN_APPEARANCE_DARK}
              artifactThemeKey={1}
              composerCard={COMPOSER_CARD}
              onInspectSubagent={undefined}
              artifactInlineEnabled
              locale="zh-CN"
            />
          </TranscriptScrollProvider>
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelectorAll('.chat-turn-group')).toHaveLength(8);
  });

  it('triggers Host onLoadOlder when all resident turns are visible', () => {
    const onLoadOlder = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TranscriptScrollProvider sessionId="older-test" scrollElementRef={{ current: container }}>
            <ChatThread
              messages={makeTurnMessages(4)}
              sessionId="older-test"
              streaming={false}
              editingMessageId={null}
              lastUserMessageId="user-3"
              activeTheme={PIWIN_APPEARANCE_DARK}
              artifactThemeKey={1}
              composerCard={COMPOSER_CARD}
              onInspectSubagent={undefined}
              artifactInlineEnabled
              canLoadOlder
              onLoadOlder={onLoadOlder}
              locale="zh-CN"
            />
          </TranscriptScrollProvider>
        </PiwinUiProvider>,
      );
    });

    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="transcript-bounded-tail-button"]',
    );
    expect(button?.textContent).toBe('加载更早历史对话');
    act(() => {
      button?.click();
    });
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it('auto-collapses settled live-written code blocks and skips syntax highlighting in collapsed preview', () => {
    const tallCode = Array.from({ length: 20 }, (_, i) => `const x${i} = ${i};`).join('\n');

    // First mounted while streaming -> writtenLiveRef becomes true and stays open.
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SettledTurnDietProvider compactSettled={false}>
            <SourceCodeBlock language="typescript" source={tallCode} isShell={false} streaming />
          </SettledTurnDietProvider>
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('.collapsible-content-block.is-expanded')).not.toBeNull();

    // Streaming settles -> still in recent tail -> stays expanded so the page doesn't jump.
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SettledTurnDietProvider compactSettled={false}>
            <SourceCodeBlock language="typescript" source={tallCode} isShell={false} streaming={false} />
          </SettledTurnDietProvider>
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('.collapsible-content-block.is-expanded')).not.toBeNull();

    // Turn ages past recent tail -> compactSettled=true -> folds to plain-text collapsed preview.
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SettledTurnDietProvider compactSettled={true}>
            <SourceCodeBlock language="typescript" source={tallCode} isShell={false} streaming={false} />
          </SettledTurnDietProvider>
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('.collapsible-content-block.is-collapsed')).not.toBeNull();
    expect(
      container.querySelector('.md-code-content')?.getAttribute('data-syntax-highlight'),
    ).toBe('deferred');

    // Artifact previews inside compactSettled turns stay open rather than collapsing to source.
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SettledTurnDietProvider compactSettled={true}>
            <ArtifactFenceController
              language="html"
              fenceInfo="artifact-html"
              source="<div><h1>Hi</h1></div>"
              htmlUiModeEnabled
              fenceIndex={0}
              fenceOpen={false}
              renderingPhase="completed"
              initPriority={0}
              artifactInlineEnabled
              locale="zh-CN"
            />
          </SettledTurnDietProvider>
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('.artifact-with-source--preview')).not.toBeNull();
    expect(container.querySelector('[data-testid="artifact-preview-toggle"]')).toBeNull();
  });

  it('reveals folded resident turns via scroll port before calling Host and supports wheel paging', () => {
    const onLoadOlder = vi.fn(async () => undefined);

    function ViewportHarness({ messages }: { messages: ChatMessageUi[] }): ReactElement {
      return (
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TranscriptViewport
            sessionId="reveal-port"
            awaitingTranscript={false}
            offline={false}
            messageCount={messages.length}
            activitySignal="idle"
            messages={messages}
            canLoadOlder
            onLoadOlder={onLoadOlder}
            locale="zh-CN"
          >
            <ChatThread
              messages={messages}
              sessionId="reveal-port"
              streaming={false}
              editingMessageId={null}
              lastUserMessageId="user-11"
              activeTheme={PIWIN_APPEARANCE_DARK}
              artifactThemeKey={1}
              composerCard={COMPOSER_CARD}
              onInspectSubagent={undefined}
              artifactInlineEnabled
              canLoadOlder
              onLoadOlder={onLoadOlder}
              locale="zh-CN"
            />
          </TranscriptViewport>
        </PiwinUiProvider>
      );
    }

    const messages = makeTurnMessages(12);
    act(() => {
      root.render(<ViewportHarness messages={messages} />);
    });

    // Initially only turns 4..11 mounted.
    expect(container.querySelector('#msg-user-1')).toBeNull();
    const scroller = container.querySelector<HTMLDivElement>('[data-testid="chat-stream"]');
    expect(scroller).not.toBeNull();
    Object.defineProperty(scroller!, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(scroller!, 'clientHeight', { configurable: true, value: 600 });
    Object.defineProperty(scroller!, 'scrollTop', { configurable: true, writable: true, value: 0 });

    // Scrolling up at top triggers wheel paging -> must reveal folded resident turns first, NOT Host onLoadOlder.
    act(() => {
      scroller!.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
    });
    expect(onLoadOlder).not.toHaveBeenCalled();
    expect(container.querySelector('#msg-user-0')).not.toBeNull();
  });
});
