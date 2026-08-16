// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { ComposerDock, type ComposerDockProps } from './composer-dock';
import { DesktopLocaleProvider } from './desktop-locale-context';
import type { DesktopLocale } from './desktop-locale';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseProps: ComposerDockProps = {
  layoutMode: 'docked',
  projectPath: null,
  projectTrusted: true,
  activeSessionId: 'session-1',
  streaming: false,
  runPhase: 'idle',
  compacting: false,
  composer: '',
  onComposerChange: vi.fn(),
  agentMode: 'agent',
  onAgentModeChange: vi.fn(),
  pendingAttachments: [],
  onRemoveAttachment: vi.fn(),
  dropActive: false,
  onDropActiveChange: vi.fn(),
  plusMenuOpen: false,
  onPlusMenuOpenChange: vi.fn(),
  plusSubmenu: 'none',
  onPlusSubmenuChange: vi.fn(),
  modelOptions: [],
  selectedModelKey: 'default',
  onSelectModel: vi.fn(),
  menuSkills: [],
  menuMcp: [],
  onRefreshComposerMenus: vi.fn(),
  onOpenSkillsPanel: vi.fn(),
  onOpenMcpPanel: vi.fn(),
  onAttachFile: vi.fn(),
  onAttachImage: vi.fn(),
  onPaste: vi.fn(),
  onDrop: vi.fn(),
  onSend: vi.fn(),
  onAbort: vi.fn(),
  onCompact: vi.fn(),
  contextUsage: null,
};

function failedAttachment(
  localId: string,
  uploadError: string,
): import('./media-utils').PendingComposerAttachment {
  return {
    localId,
    previewUrl: 'blob:test',
    uploadStatus: 'error',
    uploadError,
    attachment: {
      id: `asset-${localId}`,
      kind: 'media',
      path: `pending://${localId}`,
      mimeType: 'image/png',
      name: 'screenshot.png',
      byteSize: 100,
      source: 'paste',
    },
  };
}

function renderDock(
  node: ReactElement,
  locale: DesktopLocale = 'en',
): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <DesktopLocaleProvider locale={locale} onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
  });
  return { container, root };
}

describe('ComposerDock host status', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    root = null;
    container = null;
  });

  it('does not render the bottom host status footer row in ComposerDock', () => {
    const rendered = renderDock(<ComposerDock {...baseProps} />);
    root = rendered.root;
    container = rendered.container;

    const hostStatusBtn = container.querySelector('[data-testid="composer-host-status"]');
    expect(hostStatusBtn).toBeNull();
  });

  it('hides voice input when ASR is not configured', () => {
    const rendered = renderDock(<ComposerDock {...baseProps} onOpenModelSettings={vi.fn()} />);
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="composer-speech-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="composer-speech-status"]')).toBeNull();
    expect(container.querySelector('[data-testid="composer-speech-error"]')).toBeNull();
  });

  it('shows voice input only when ASR is configured and a request is available', () => {
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        speechConfigured={true}
        speechRequest={async () => ({
          type: 'response',
          success: true,
          command: 'speech/transcribe',
          requestId: 'speech-test',
          data: { text: 'hello', model: { providerId: 'test', modelId: 'asr' }, durationMs: 1 },
        })}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="composer-speech-btn"]')).not.toBeNull();
  });

  it('resets textarea height when composer text is cleared or changed', async () => {
    const rendered = renderDock(<ComposerDock {...baseProps} composer="Hello world" />);
    root = rendered.root;
    container = rendered.container;

    const textarea = container.querySelector(
      '[data-testid="composer-input"]',
    ) as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();

    // Re-render with empty composer (e.g. after sending or clearing)
    await act(async () => {
      rendered.root.render(
        <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <ComposerDock {...baseProps} composer="" />
          </PiwinUiProvider>
        </DesktopLocaleProvider>,
      );
      await new Promise((r) => requestAnimationFrame(r));
    });

    expect(textarea.style.height).toBe('auto');
  });

  it('opens a list of up to 10 session prompts on ArrowUp from an empty composer', () => {
    const onComposerChange = vi.fn();
    const sessionUserPrompts = Array.from({ length: 12 }, (_, index) => `prompt ${index + 1}`);
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer=""
        onComposerChange={onComposerChange}
        sessionUserPrompts={sessionUserPrompts}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');
    expect(input).not.toBeNull();
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
      );
    });

    const menu = container.querySelector('[data-testid="composer-prompt-history-menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.querySelectorAll('[role="option"]').length).toBe(10);
    expect(onComposerChange).toHaveBeenCalledWith('prompt 1');
  });

  it('renders stop button when streaming and input is empty, and hides steer button', () => {
    const handleSteer = vi.fn();
    const handleAbort = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        streaming={true}
        runPhase="streaming"
        composer=""
        onSteer={handleSteer}
        onAbort={handleAbort}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="steer-btn"]')).toBeNull();
    const stopBtn = container.querySelector('[data-testid="stop-btn"]') as HTMLButtonElement;
    expect(stopBtn).not.toBeNull();
    expect(container.querySelector('[data-testid="send-btn"]')).toBeNull();

    act(() => {
      stopBtn.click();
    });
    expect(handleAbort).toHaveBeenCalledTimes(1);
  });

  it('keeps a single Stop control while streaming even if pause handlers exist elsewhere', () => {
    const handleAbort = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        streaming={true}
        runPhase="streaming"
        onAbort={handleAbort}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="pause-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="resume-run-btn"]')).toBeNull();
    const stopBtn = container.querySelector('[data-testid="stop-btn"]') as HTMLButtonElement;
    expect(stopBtn).not.toBeNull();

    act(() => {
      stopBtn.click();
    });
    expect(handleAbort).toHaveBeenCalledTimes(1);
  });

  it('reuses the Composer textarea for Other input and keeps Stop instead of Steer', () => {
    const handleResolve = vi.fn();
    const handleAbort = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        streaming={true}
        runPhase="streaming"
        extensionUiRequest={{
          sessionId: 'session-1',
          requestId: 'request-1',
          kind: 'input',
          title: 'Response for: What should I work on?',
          placeholder: 'Type your answer',
        }}
        extensionUiInput="Use the existing branch"
        onExtensionUiResolve={handleResolve}
        onAbort={handleAbort}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const textarea = container.querySelector(
      '[data-testid="composer-input"]',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Use the existing branch');
    expect(textarea.readOnly).toBe(false);
    expect(container.querySelector('[data-testid="steer-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="stop-btn"]')).not.toBeNull();
    // The question prompt is now rendered in the App-level interruption dock,
    // not inside the composer card. The composer textarea placeholder still
    // reflects the input mode.
    expect(textarea.placeholder).toBe('Type your answer');

    act(() => {
      rendered.root.render(
        <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <ComposerDock
              {...baseProps}
              streaming={true}
              runPhase="streaming"
              extensionUiRequest={{
                sessionId: 'session-1',
                requestId: 'request-1',
                kind: 'input',
                title: 'Response for: What should I work on?',
                placeholder: 'Type your answer',
              }}
              extensionUiInput="Use a new branch"
              onExtensionUiResolve={handleResolve}
              onAbort={handleAbort}
            />
          </PiwinUiProvider>
        </DesktopLocaleProvider>,
      );
    });

    act(() => {
      const updatedTextarea = container?.querySelector(
        '[data-testid="composer-input"]',
      ) as HTMLTextAreaElement;
      updatedTextarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(handleResolve).toHaveBeenCalledWith({ value: 'Use a new branch' });
  });

  it('queues Enter/send while streaming and reserves Command+Enter for a Run intervention', () => {
    const handleSteer = vi.fn();
    const handleFollowUp = vi.fn();
    const handleSend = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        streaming={true}
        runPhase="streaming"
        composer="Next instruction"
        onSteer={handleSteer}
        onFollowUp={handleFollowUp}
        onSend={handleSend}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="steer-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="stop-btn"]')).toBeNull();

    const sendBtn = container.querySelector('[data-testid="send-btn"]') as HTMLButtonElement;
    expect(sendBtn).not.toBeNull();
    expect(sendBtn.classList.contains('is-queue')).toBe(true);

    act(() => {
      sendBtn.click();
    });
    expect(handleFollowUp).toHaveBeenCalledTimes(1);
    expect(handleSteer).not.toHaveBeenCalled();

    act(() => {
      const textarea = container?.querySelector<HTMLTextAreaElement>(
        '[data-testid="composer-input"]',
      );
      textarea?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }),
      );
    });
    expect(handleSteer).toHaveBeenCalledTimes(1);
    expect(handleSend).not.toHaveBeenCalled();
  });

  it('attaches stacked queued messages directly above the composer', () => {
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        streaming={true}
        runPhase="streaming"
        steerQueueMessages={[
          { id: 'one', text: 'First queued task', createdAt: '2026-08-09T00:00:00.000Z' },
          { id: 'two', text: 'Second queued task', createdAt: '2026-08-09T00:00:01.000Z' },
        ]}
        onSteerQueueSendNow={vi.fn()}
        onSteerQueueEdit={vi.fn()}
        onSteerQueueRemove={vi.fn()}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const dock = container.querySelector('[data-testid="composer-dock"]');
    expect(dock?.classList.contains('has-steer-queue')).toBe(true);
    expect(dock?.children[0]?.getAttribute('data-testid')).toBe('steer-queue');
    expect(dock?.children[1]?.getAttribute('data-testid')).toBe('composer-card');
    expect(container.textContent).toContain('First queued task');
    expect(container.textContent).toContain('Second queued task');
  });

  it('shows text-only vision warning when media is attached without vision or delegation', () => {
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        selectedModelKey="custom-openai::deepseek-v4-flash"
        modelOptions={[
          {
            providerId: 'custom-openai',
            protocol: 'openai-compatible',
            modelId: 'deepseek-v4-flash',
            label: 'Cpa / DeepSeek',
            // no supportsImage
          },
        ]}
        visionDelegationEnabled={false}
        pendingAttachments={[
          {
            localId: 'local-1',
            previewUrl: 'blob:test',
            attachment: {
              id: 'a1',
              kind: 'media',
              path: '/tmp/.piwin/media/s/a.png',
              mimeType: 'image/png',
              byteSize: 100,
              source: 'paste',
            },
          },
        ]}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const warning = container.querySelector('[data-testid="composer-text-only-image-warning"]');
    expect(warning).not.toBeNull();
    expect(warning?.textContent).toContain('text-only model');
    expect(warning?.textContent).toContain('cannot analyze images');
  });

  it('hides text-only vision warning when model supports image', () => {
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        selectedModelKey="custom-openai::swe-1-7"
        modelOptions={[
          {
            providerId: 'custom-openai',
            protocol: 'openai-compatible',
            modelId: 'swe-1-7',
            label: 'Cpa / swe',
            supportsImage: true,
          },
        ]}
        pendingAttachments={[
          {
            localId: 'local-1',
            previewUrl: 'blob:test',
            attachment: {
              id: 'a1',
              kind: 'media',
              path: '/tmp/.piwin/media/s/a.png',
              mimeType: 'image/png',
              byteSize: 100,
              source: 'paste',
            },
          },
        ]}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="composer-text-only-image-warning"]')).toBeNull();
  });

  it('hides text-only vision warning when vision delegation is enabled', () => {
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        selectedModelKey="custom-openai::deepseek-v4-flash"
        modelOptions={[
          {
            providerId: 'custom-openai',
            protocol: 'openai-compatible',
            modelId: 'deepseek-v4-flash',
            label: 'Cpa / DeepSeek',
          },
        ]}
        visionDelegationEnabled={true}
        pendingAttachments={[
          {
            localId: 'local-1',
            previewUrl: 'blob:test',
            attachment: {
              id: 'a1',
              kind: 'media',
              path: '/tmp/.piwin/media/s/a.png',
              mimeType: 'image/png',
              byteSize: 100,
              source: 'paste',
            },
          },
        ]}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="composer-text-only-image-warning"]')).toBeNull();
  });

  it('hides text-only vision warning when no media is attached', () => {
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        selectedModelKey="custom-openai::deepseek-v4-flash"
        modelOptions={[
          {
            providerId: 'custom-openai',
            protocol: 'openai-compatible',
            modelId: 'deepseek-v4-flash',
            label: 'Cpa / DeepSeek',
          },
        ]}
        visionDelegationEnabled={false}
        pendingAttachments={[]}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="composer-text-only-image-warning"]')).toBeNull();
  });

  it('keeps send enabled while a media attachment is preparing (send will wait)', () => {
    const handleSend = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer="look at this"
        onSend={handleSend}
        pendingAttachments={[
          {
            localId: 'local-saving',
            previewUrl: 'blob:test',
            uploadStatus: 'saving',
            attachment: {
              id: 'a-saving',
              kind: 'media',
              path: 'pending://local-saving',
              mimeType: 'image/png',
              byteSize: 100,
              source: 'paste',
            },
          },
        ]}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const sendBtn = container.querySelector<HTMLButtonElement>('[data-testid="send-btn"]');
    // Preparing must not block the button — handleSend awaits saves.
    expect(sendBtn?.disabled).toBe(false);
    expect(container.querySelector('[data-testid="composer-attachment-saving"]')).not.toBeNull();

    act(() => {
      sendBtn?.click();
    });
    expect(handleSend).toHaveBeenCalledTimes(1);
  });

  it('keeps send enabled with a failed attachment and shows the reason outside the chip', () => {
    const handleSend = vi.fn();
    const handleRetry = vi.fn();
    const handleRemove = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer="look at this"
        onSend={handleSend}
        onRetryAttachment={handleRetry}
        onRemoveAttachment={handleRemove}
        pendingAttachments={[failedAttachment('local-error', 'media too large')]}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    // Phase 0: a failed attachment must not disable Send (ADR 0045 Decision 4).
    const sendBtn = container.querySelector<HTMLButtonElement>('[data-testid="send-btn"]');
    expect(sendBtn?.disabled).toBe(false);
    // No Retry overlay covering the thumbnail anymore.
    expect(container.querySelector('[data-testid="composer-attachment-error"]')).toBeNull();

    // The failure reason is plain visible text outside the chip, with actions.
    const failureRow = container.querySelector('[data-testid="composer-attachment-failure"]');
    expect(failureRow).not.toBeNull();
    expect(failureRow?.textContent).toContain('media too large');

    act(() => {
      failureRow
        ?.querySelector<HTMLButtonElement>('[data-testid="composer-attachment-failure-retry"]')
        ?.click();
    });
    expect(handleRetry).toHaveBeenCalledWith('local-error');

    act(() => {
      failureRow
        ?.querySelector<HTMLButtonElement>('[data-testid="composer-attachment-failure-remove"]')
        ?.click();
    });
    expect(handleRemove).toHaveBeenCalledWith('local-error');
  });

  it('confirms retry / send-rest / back before sending with failed attachments', () => {
    const handleSend = vi.fn();
    const discardFailed = vi.fn();
    const retryFailed = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer="look at this"
        onSend={handleSend}
        onRetryFailedAttachments={retryFailed}
        onDiscardFailedAttachments={discardFailed}
        pendingAttachments={[failedAttachment('local-error', 'media too large')]}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const sendBtn = container.querySelector<HTMLButtonElement>('[data-testid="send-btn"]');
    act(() => {
      sendBtn?.click();
    });
    // Send is intercepted by the three-way confirmation.
    expect(handleSend).not.toHaveBeenCalled();
    const dialog = document.querySelector('[data-testid="composer-attachment-failure-dialog"]');
    expect(dialog).not.toBeNull();

    // "Send without them" discards failed chips, then sends.
    act(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="attachment-failure-send-rest"]')
        ?.click();
    });
    expect(discardFailed).toHaveBeenCalledTimes(1);
    expect(handleSend).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector('[data-testid="composer-attachment-failure-dialog"]'),
    ).toBeNull();
  });

  it('retries failed attachments from the send confirmation before sending', () => {
    const handleSend = vi.fn();
    const retryFailed = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer="look at this"
        onSend={handleSend}
        onRetryFailedAttachments={retryFailed}
        onDiscardFailedAttachments={vi.fn()}
        pendingAttachments={[failedAttachment('local-error', 'media too large')]}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    act(() => {
      container?.querySelector<HTMLButtonElement>('[data-testid="send-btn"]')?.click();
    });
    act(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="attachment-failure-retry-send"]')
        ?.click();
    });
    expect(retryFailed).toHaveBeenCalledTimes(1);
    expect(handleSend).toHaveBeenCalledTimes(1);

    // "Back" leaves everything untouched.
    act(() => {
      container?.querySelector<HTMLButtonElement>('[data-testid="send-btn"]')?.click();
    });
    act(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="attachment-failure-cancel"]')
        ?.click();
    });
    expect(handleSend).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector('[data-testid="composer-attachment-failure-dialog"]'),
    ).toBeNull();
  });

  it('puts initial confirmation focus on retry so Enter does not discard attachments', () => {
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer="look at this"
        onSend={vi.fn()}
        onRetryFailedAttachments={vi.fn()}
        onDiscardFailedAttachments={vi.fn()}
        pendingAttachments={[failedAttachment('local-error', 'media too large')]}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    act(() => {
      container?.querySelector<HTMLButtonElement>('[data-testid="send-btn"]')?.click();
    });
    const retry = document.querySelector<HTMLButtonElement>(
      '[data-testid="attachment-failure-retry-send"]',
    );
    expect(retry).not.toBeNull();
    expect(retry?.hasAttribute('autoFocus') || document.activeElement === retry).toBe(true);
  });

  it('turns the main action into Retry when only failed attachments remain', () => {
    const handleSend = vi.fn();
    const retryFailed = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer=""
        onSend={handleSend}
        onRetryFailedAttachments={retryFailed}
        onDiscardFailedAttachments={vi.fn()}
        pendingAttachments={[failedAttachment('local-error', 'media too large')]}
      />,
      'zh-CN',
    );
    root = rendered.root;
    container = rendered.container;

    const sendBtn = container.querySelector<HTMLButtonElement>('[data-testid="send-btn"]');
    expect(sendBtn?.disabled).toBe(false);
    expect(sendBtn?.getAttribute('aria-label')).toBe('重试附件');

    act(() => {
      sendBtn?.click();
    });
    // No dialog needed: retry everything, then send retries the save.
    expect(
      document.querySelector('[data-testid="composer-attachment-failure-dialog"]'),
    ).toBeNull();
    expect(retryFailed).toHaveBeenCalledTimes(1);
    expect(handleSend).toHaveBeenCalledTimes(1);
  });

  it('localizes Composer controls and placeholders for Simplified Chinese', () => {
    const rendered = renderDock(<ComposerDock {...baseProps} />, 'zh-CN');
    root = rendered.root;
    container = rendered.container;

    const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');
    const attachButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="composer-plus-btn"]',
    );
    const sendButton = container.querySelector<HTMLButtonElement>('[data-testid="send-btn"]');

    expect(textarea?.placeholder).toBe('规划、搜索或构建任何内容');
    expect(attachButton?.getAttribute('aria-label')).toBe('添加文件和上下文');
    expect(sendButton?.getAttribute('aria-label')).toBe('发送');
  });

  it('always shows orchestration scheme trigger (mode picker, including freehand)', () => {
    const options = [
      { id: 'off', name: 'Freehand', description: 'Freehand — no scheme prompt injection' },
      { id: 'ultra-code', name: 'Ultra Code', description: 'Multi-step coding plan' },
    ];
    const onOrchestrationSchemeChange = vi.fn();

    const freehand = renderDock(
      <ComposerDock
        {...baseProps}
        orchestrationSchemeId="off"
        orchestrationSchemeOptions={options}
        onOrchestrationSchemeChange={onOrchestrationSchemeChange}
      />,
    );
    const freehandTrigger = freehand.container.querySelector(
      '[data-testid="orchestration-scheme-trigger"]',
    );
    expect(freehandTrigger).not.toBeNull();
    expect(freehandTrigger?.getAttribute('data-scheme')).toBe('off');
    expect(freehandTrigger?.textContent).toContain('Freehand');

    const active = renderDock(
      <ComposerDock
        {...baseProps}
        orchestrationSchemeId="ultra-code"
        orchestrationSchemeOptions={options}
        onOrchestrationSchemeChange={onOrchestrationSchemeChange}
      />,
    );
    const activeTrigger = active.container.querySelector(
      '[data-testid="orchestration-scheme-trigger"]',
    );
    expect(activeTrigger).not.toBeNull();
    expect(activeTrigger?.getAttribute('data-scheme')).toBe('ultra-code');
    expect(activeTrigger?.textContent).toContain('Ultra Code');
  });

  it('hides Agent Mode, Run Mode, and Orchestration in Conversation', () => {
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        isConversationSession
        agentMode="plan"
        runModePreset="auto"
        onRunModeChange={vi.fn()}
        orchestrationSchemeId="ultra-code"
        orchestrationSchemeOptions={[
          { id: 'off', name: 'Freehand', description: 'No scheme' },
          { id: 'ultra-code', name: 'Ultra Code', description: 'Orchestrated' },
        ]}
        onOrchestrationSchemeChange={vi.fn()}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="agent-mode-chip"]')).toBeNull();
    expect(container.querySelector('[data-testid="run-mode-trigger"]')).toBeNull();
    expect(container.querySelector('[data-testid="orchestration-scheme-trigger"]')).toBeNull();
    const textarea = container.querySelector(
      '[data-testid="composer-input"]',
    ) as HTMLTextAreaElement;
    expect(textarea.placeholder).toContain('Ask anything');
  });
});
