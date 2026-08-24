// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { MobileTopBar } from './components/navigation/MobileTopBar.js';
import { MobileSidebarDrawer } from './components/navigation/MobileSidebarDrawer.js';
import { MobileMessageItem } from './components/chat/MobileMessageItem.js';
import { SettingsModal } from './components/modals/SettingsModal.js';
import { ModelPickerModal } from './components/modals/ModelPickerModal.js';
import { MobileShareModal } from './components/modals/MobileShareModal.js';
import { MobileArtifactSheet } from './components/modals/MobileArtifactSheet.js';
import { MobileQuickActionsBar } from './components/chat/MobileQuickActionsBar.js';
import { MobileDiffViewer } from './components/chat/MobileDiffViewer.js';
import { ConversationSurface } from './surfaces/conversation/ConversationSurface.js';
import { MOBILE_THEME } from './mobile-theme.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('Mobile Shell Navigation & Surfaces', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it('renders MobileTopBar with session title and triggers sidebar toggle', () => {
    const onToggleSidebar = vi.fn();
    const onNewChat = vi.fn();
    const onOpenSettings = vi.fn();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <MobileTopBar
            sessionTitle="Test Project Session"
            connectionState={{ kind: 'ready' }}
            onToggleSidebar={onToggleSidebar}
            onNewChat={onNewChat}
            onOpenSettings={onOpenSettings}
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.textContent).toContain('Test Project Session');
    const menuBtn = container.querySelector('.mobile-top-btn') as HTMLButtonElement;
    expect(menuBtn).not.toBeNull();
    act(() => {
      menuBtn.click();
    });
    expect(onToggleSidebar).toHaveBeenCalled();
  });

  it('renders MobileSidebarDrawer and filters sessions by search query', () => {
    const onSelectSession = vi.fn();
    const onClose = vi.fn();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <MobileSidebarDrawer
            isOpen={true}
            onClose={onClose}
            projects={[{ projectId: 'p1', displayName: 'Project 1', trust: 'trusted' }]}
            sessions={[
              { sessionId: 's1', name: 'Refactor Core', updatedAt: '2026-08-16T12:00:00Z', scope: 'project', projectId: 'p1', messageCount: 5 },
              { sessionId: 's2', name: 'Fix Bug', updatedAt: '2026-08-16T12:05:00Z', scope: 'project', messageCount: 2 },
            ]}
            activeSessionId="s1"
            onSelectSession={onSelectSession}
            onNewChat={vi.fn()}
            onOpenSettings={vi.fn()}
            onOpenInbox={vi.fn()}
            isConnected={true}
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.textContent).toContain('Host 已就绪');
    expect(container.textContent).toContain('Refactor Core');
    expect(container.textContent).toContain('Fix Bug');

    const sessionItems = container.querySelectorAll('.mobile-drawer-session-item-btn');
    expect(sessionItems.length).toBe(2);

    act(() => {
      (sessionItems[0] as HTMLButtonElement).click();
    });
    expect(onSelectSession).toHaveBeenCalledWith('s1');
  });

  it('renders SettingsModal and selects theme options', () => {
    const onSelectTheme = vi.fn();
    const onClose = vi.fn();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <SettingsModal
            isOpen={true}
            onClose={onClose}
            connectionState={{ kind: 'ready' }}
            endpoint="ws://127.0.0.1:8787"
            projectCount={3}
            sessionCount={8}
            themeMode="dark"
            onSelectTheme={onSelectTheme}
            onDisconnect={vi.fn()}
            onOpenConnection={vi.fn()}
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.textContent).toContain('设置与外观');
    expect(container.textContent).toContain('深色暗夜');
    expect(container.textContent).toContain('清爽宣白');
    expect(container.textContent).toContain('砚夜泼墨');

    const themeButtons = container.querySelectorAll('.mobile-theme-card-tile');
    expect(themeButtons.length).toBe(4);

    act(() => {
      (themeButtons[3] as HTMLButtonElement).click();
    });
    expect(onSelectTheme).toHaveBeenCalledWith('ink-wash');
  });

  it('renders ModelPickerModal and selects model and reasoning levels', () => {
    const onSelectModel = vi.fn();
    const onSelectThinkingLevel = vi.fn();
    const onClose = vi.fn();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <ModelPickerModal
            isOpen={true}
            onClose={onClose}
            models={[
              {
                providerId: 'custom-anthropic',
                protocol: 'openai-compatible',
                modelId: 'deepseek-v4-flash',
                label: 'DeepSeek V4 Flash',
                thinkingLevels: ['off', 'max'],
              },
              {
                providerId: 'custom-openai',
                protocol: 'openai-compatible',
                modelId: 'gpt-4o',
                label: 'GPT-4o',
              },
            ]}
            selectedProviderId="custom-anthropic"
            selectedModelId="deepseek-v4-flash"
            selectedThinkingLevel="max"
            onSelectModel={onSelectModel}
            onSelectThinkingLevel={onSelectThinkingLevel}
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.textContent).toContain('模型与推理配置');
    expect(container.textContent).toContain('DeepSeek V4 Flash');
    expect(container.textContent).toContain('GPT-4o');

    const modelCards = container.querySelectorAll('.mobile-model-card-item');
    expect(modelCards.length).toBe(2);

    act(() => {
      (modelCards[1] as HTMLButtonElement).click();
    });
    expect(onSelectModel).toHaveBeenCalledWith('gpt-4o', 'custom-openai');
  });

  it('renders MobileQuickActionsBar and triggers prompt fills', () => {
    const onSelectAction = vi.fn();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <MobileQuickActionsBar onSelectAction={onSelectAction} />
        </PiwinUiProvider>,
      );
    });

    expect(container.textContent).toContain('解释代码');
    expect(container.textContent).toContain('排查 Bug');
    expect(container.textContent).toContain('/goal 深度长任务');

    const buttons = container.querySelectorAll('.quick-action-pill');
    expect(buttons.length).toBeGreaterThanOrEqual(6);

    act(() => {
      (buttons[0] as HTMLButtonElement).click();
    });
    expect(onSelectAction).toHaveBeenCalledWith(expect.stringContaining('解释'));
  });

  it('renders MobileDiffViewer with additions and deletions', () => {
    const diffSample = `@@ -1,3 +1,3 @@\n-const a = 1;\n+const a = 2;\n const b = 3;`;

    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <MobileDiffViewer diffText={diffSample} />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('.mobile-diff-viewer')).not.toBeNull();
    expect(container.querySelector('.diff-line.delete')).not.toBeNull();
    expect(container.querySelector('.diff-line.add')).not.toBeNull();
    expect(container.textContent).toContain('const a = 1;');
    expect(container.textContent).toContain('const a = 2;');
  });

  it('renders MobileShareModal and formats markdown', () => {
    const onClose = vi.fn();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <MobileShareModal
            isOpen={true}
            onClose={onClose}
            sessionTitle="重构核心逻辑"
            messages={[
              { id: 'm1', role: 'user', text: '请优化代码', createdAt: '2026-08-16T12:00:00Z', status: 'done' },
              { id: 'm2', role: 'assistant', text: '好的，这是优化方案', createdAt: '2026-08-16T12:01:00Z', status: 'done' },
            ]}
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.textContent).toContain('导出与分享会话');
    expect(container.textContent).toContain('重构核心逻辑');
    expect(container.textContent).toContain('系统原生分享');
    expect(container.textContent).toContain('复制完整 Markdown');
  });

  it('renders MobileArtifactSheet with sandboxed iframe', () => {
    const onClose = vi.fn();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <MobileArtifactSheet
            isOpen={true}
            onClose={onClose}
            title="Landing Page Demo"
            srcdoc="<h1>Hello Artifact</h1>"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.textContent).toContain('Landing Page Demo');
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });

  it('renders assistant and user messages in MobileMessageItem', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <MobileMessageItem
            htmlUiModeEnabled
            message={{
              id: 'msg-1',
              role: 'assistant',
              text: 'Hello World',
              createdAt: '2026-08-16T12:00:00Z',
              status: 'done',
            }}
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('.modern-chat-turn')).not.toBeNull();
    expect(container.textContent).toContain('Piwin Agent');
    expect(container.textContent).toContain('Hello World');

    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <MobileMessageItem
            htmlUiModeEnabled
            message={{
              id: 'msg-2',
              role: 'user',
              text: '你好！',
              createdAt: '2026-08-16T12:01:00Z',
              status: 'done',
            }}
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('.modern-user-bubble-wrapper')).not.toBeNull();
    expect(container.textContent).toContain('你好！');
  });

  it('renders a chat-canvas send error and a replace-run action', () => {
    const onReplaceAndSend = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <ConversationSurface
            activeSessionId="s1"
            sessions={[{ sessionId: 's1', scope: 'general' }]}
            messages={[]}
            composerText="hello"
            setComposerText={() => undefined}
            attachments={[]}
            onRemoveAttachment={() => undefined}
            onFileSelected={() => undefined}
            onSend={() => undefined}
            onAbort={() => undefined}
            isSending={false}
            isUploadingMedia={false}
            isResolvingPermission={false}
            onResolvePermission={() => undefined}
            onNavigateToSessions={() => undefined}
            errorMessage="foreground-run-mismatch: session is busy"
            pendingReplaceRunId="run-a"
            onReplaceAndSend={onReplaceAndSend}
            htmlUiModeEnabled
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.textContent).toContain('foreground-run-mismatch: session is busy');
    const replace = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('中断并发送'),
    );
    expect(replace).toBeDefined();
    act(() => {
      replace?.click();
    });
    expect(onReplaceAndSend).toHaveBeenCalled();
  });
});
