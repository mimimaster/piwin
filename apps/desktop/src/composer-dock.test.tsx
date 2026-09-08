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

/** Send, Pause, Continue, and the banned extra Stop/Discard circles. */
const COMPOSER_CIRCULAR_ACTIONS =
  '[data-testid="send-btn"], [data-testid="pause-btn"], [data-testid="resume-run-btn"], [data-testid="discard-pause-btn"], [data-testid="stop-btn"]';

function circularActionCount(container: HTMLElement): number {
  return container.querySelectorAll(COMPOSER_CIRCULAR_ACTIONS).length;
}

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
  onPause: vi.fn(),
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

  it('disables Send while Host admission is not ready', () => {
    const rendered = renderDock(
      <ComposerDock {...baseProps} composer="hello" mutationsEnabled={false} />,
    );
    root = rendered.root;
    container = rendered.container;
    const send = container.querySelector('[data-testid="send-btn"]') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  it('disables Pause while Host admission is not ready', () => {
    const rendered = renderDock(
      <ComposerDock {...baseProps} streaming runPhase="streaming" mutationsEnabled={false} />,
    );
    root = rendered.root;
    container = rendered.container;
    const pause = container.querySelector('[data-testid="pause-btn"]') as HTMLButtonElement;
    expect(pause).not.toBeNull();
    expect(pause.disabled).toBe(true);
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

  it('places Live as an icon-only control after the model chip, not beside Send', () => {
    const rendered = renderDock(<ComposerDock {...baseProps} />);
    root = rendered.root;
    container = rendered.container;

    const live = container.querySelector('[data-testid="composer-live-btn"]');
    const plus = container.querySelector('[data-testid="composer-plus-btn"]');
    const send = container.querySelector('[data-testid="send-btn"]');
    const left = container.querySelector('.composer-v2-toolbar-left');
    const right = container.querySelector('.composer-v2-toolbar-right');

    expect(live).not.toBeNull();
    expect(left?.contains(live)).toBe(true);
    expect(right?.contains(live)).toBe(false);
    expect(right?.contains(send)).toBe(true);
    expect(live?.classList.contains('composer-v2-icon-btn')).toBe(true);
    expect(live?.textContent ?? '').not.toMatch(/Live|Retry/);

    const leftButtons = [...(left?.querySelectorAll('button') ?? [])];
    expect(leftButtons.indexOf(plus as HTMLButtonElement)).toBeGreaterThanOrEqual(0);
    expect(leftButtons.indexOf(live as HTMLButtonElement)).toBeGreaterThan(
      leftButtons.indexOf(plus as HTMLButtonElement),
    );
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

  it('renders Pause when streaming with empty input and sends the pause gesture', () => {
    const handleSteer = vi.fn();
    const handlePause = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        streaming={true}
        runPhase="streaming"
        composer=""
        onSteer={handleSteer}
        onPause={handlePause}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="steer-btn"]')).toBeNull();
    const pauseBtn = container.querySelector('[data-testid="pause-btn"]') as HTMLButtonElement;
    expect(pauseBtn).not.toBeNull();
    expect(container.querySelector('[data-testid="send-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="stop-btn"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid="pause-btn"]').length).toBe(1);
    expect(circularActionCount(container)).toBe(1);

    act(() => {
      pauseBtn.click();
    });
    expect(handlePause).toHaveBeenCalledTimes(1);
  });

  it('greys Pause only while pause is in flight', () => {
    const handlePause = vi.fn();
    const rendered = renderDock(
      <ComposerDock {...baseProps} streaming={true} runPhase="pausing" onPause={handlePause} />,
    );
    root = rendered.root;
    container = rendered.container;

    const pauseBtn = container.querySelector('[data-testid="pause-btn"]') as HTMLButtonElement;
    expect(pauseBtn).not.toBeNull();
    expect(pauseBtn.disabled).toBe(true);
    expect(pauseBtn.getAttribute('aria-label')).toBe('Pausing…');

    act(() => {
      pauseBtn.click();
    });
    expect(handlePause).not.toHaveBeenCalled();
  });

  it('keeps one primary Pause control while streaming', () => {
    const handlePause = vi.fn();
    const rendered = renderDock(
      <ComposerDock {...baseProps} streaming={true} runPhase="streaming" onPause={handlePause} />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="resume-run-btn"]')).toBeNull();
    const pauseBtn = container.querySelector('[data-testid="pause-btn"]') as HTMLButtonElement;
    expect(pauseBtn).not.toBeNull();
    expect(container.querySelector('[data-testid="stop-btn"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid="pause-btn"]').length).toBe(1);
    expect(circularActionCount(container)).toBe(1);

    act(() => {
      pauseBtn.click();
    });
    expect(handlePause).toHaveBeenCalledTimes(1);
  });

  it('renders Send while streaming with text', () => {
    const handleSteer = vi.fn();
    const handleFollowUp = vi.fn();
    const handleSend = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        streaming={true}
        runPhase="streaming"
        composer="change direction"
        onSteer={handleSteer}
        onFollowUp={handleFollowUp}
        onSend={handleSend}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const sendBtn = container.querySelector('[data-testid="send-btn"]') as HTMLButtonElement;
    expect(sendBtn).not.toBeNull();
    expect(sendBtn.getAttribute('aria-label')).toBe('Queue follow-up');
    expect(container.querySelector('[data-testid="steer-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="pause-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="stop-btn"]')).toBeNull();
    expect(circularActionCount(container)).toBe(1);

    act(() => {
      sendBtn.click();
    });
    expect(handleSend).toHaveBeenCalledTimes(1);
    expect(handleSteer).not.toHaveBeenCalled();
    expect(handleFollowUp).not.toHaveBeenCalled();
  });

  it('turns Pause into Send while drafting a follow-up during a live run', () => {
    const handleFollowUp = vi.fn();
    const handlePause = vi.fn();
    const handleSend = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        streaming={true}
        runPhase="streaming"
        composer="keep going"
        onFollowUp={handleFollowUp}
        onPause={handlePause}
        onSend={handleSend}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="send-btn"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pause-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="steer-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="stop-btn"]')).toBeNull();
    expect(circularActionCount(container)).toBe(1);
  });

  it('does not render pause or resume controls when idle', () => {
    const rendered = renderDock(<ComposerDock {...baseProps} />);
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="pause-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="resume-run-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="discard-pause-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="send-btn"]')).not.toBeNull();
    expect(circularActionCount(container)).toBe(1);
  });

  it('shows Continue in the same slot after a pause checkpoint, without a second circular button', () => {
    const handleResume = vi.fn();
    const handleAbort = vi.fn();
    const rendered = renderDock(
      <ComposerDock {...baseProps} paused onResume={handleResume} onAbort={handleAbort} />,
    );
    root = rendered.root;
    container = rendered.container;

    const resume = container.querySelector('[data-testid="resume-run-btn"]') as HTMLButtonElement;
    expect(resume).not.toBeNull();
    expect(resume.getAttribute('aria-label')).toBe('Continue run');
    expect(container.querySelector('[data-testid="discard-pause-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="stop-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="pause-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="send-btn"]')).toBeNull();
    expect(circularActionCount(container)).toBe(1);

    act(() => {
      resume.click();
    });
    expect(handleResume).toHaveBeenCalledOnce();
    expect(handleAbort).not.toHaveBeenCalled();
  });

  it('turns the paused Continue slot back into Send when the user drafts a new prompt', () => {
    const handleSend = vi.fn();
    const handleResume = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        paused
        composer="new prompt"
        onSend={handleSend}
        onResume={handleResume}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const send = container.querySelector('[data-testid="send-btn"]') as HTMLButtonElement;
    expect(send).not.toBeNull();
    expect(container.querySelector('[data-testid="resume-run-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="discard-pause-btn"]')).toBeNull();
    expect(circularActionCount(container)).toBe(1);

    act(() => {
      send.click();
    });
    expect(handleSend).toHaveBeenCalledOnce();
    expect(handleResume).not.toHaveBeenCalled();
  });

  it('hints that typed 继续 is a new send and can resume the checkpoint instead', () => {
    const handleSend = vi.fn();
    const handleResume = vi.fn();
    const handleComposerChange = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        paused
        composer="继续"
        onComposerChange={handleComposerChange}
        onSend={handleSend}
        onResume={handleResume}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="composer-pause-continue-hint"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="send-btn"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="resume-run-btn"]')).toBeNull();
    expect(circularActionCount(container)).toBe(1);

    const hintResume = container.querySelector(
      '[data-testid="composer-pause-continue-hint-resume"]',
    ) as HTMLButtonElement;
    act(() => {
      hintResume.click();
    });
    expect(handleComposerChange).toHaveBeenCalledWith('');
    expect(handleResume).toHaveBeenCalledOnce();
    expect(handleSend).not.toHaveBeenCalled();
  });

  it('reuses the Composer textarea for Other input and keeps Pause instead of Steer', () => {
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
    expect(container.querySelector('[data-testid="pause-btn"]')).not.toBeNull();
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

  it('queues Enter and steers Command+Enter while streaming', () => {
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
    expect(container.querySelector('[data-testid="pause-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="send-btn"]')).not.toBeNull();
    expect(circularActionCount(container)).toBe(1);

    act(() => {
      const textarea = container?.querySelector<HTMLTextAreaElement>(
        '[data-testid="composer-input"]',
      );
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(handleSend).toHaveBeenCalledTimes(1);
    expect(handleSteer).not.toHaveBeenCalled();
    expect(handleFollowUp).not.toHaveBeenCalled();

    act(() => {
      const textarea = container?.querySelector<HTMLTextAreaElement>(
        '[data-testid="composer-input"]',
      );
      textarea?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }),
      );
    });
    expect(handleSteer).toHaveBeenCalledTimes(1);
    expect(handleSend).toHaveBeenCalledTimes(1);
    expect(handleFollowUp).not.toHaveBeenCalled();
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

  it('edits a queued turn in the composer input, including images', () => {
    const handleSend = vi.fn();
    const handleSteer = vi.fn();
    const handleCancel = vi.fn();
    const handleAttachImage = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        streaming={true}
        runPhase="streaming"
        composer="Rewrite this queued follow-up"
        pendingAttachments={[
          {
            localId: 'queued-img',
            previewUrl: 'blob:queued',
            uploadStatus: 'ready',
            attachment: {
              id: 'asset-queued',
              kind: 'media',
              path: '/tmp/.piwin/media/s/shot.png',
              mimeType: 'image/png',
              byteSize: 80,
              source: 'paste',
            },
          },
        ]}
        steerQueueMessages={[
          {
            id: 'one',
            text: 'First queued task',
            createdAt: '2026-08-09T00:00:00.000Z',
            attachmentCount: 1,
          },
        ]}
        queuedEdit={{ messageId: 'one', position: 1 }}
        onQueuedEditCancel={handleCancel}
        onSteer={handleSteer}
        onSend={handleSend}
        onAttachImage={handleAttachImage}
        plusMenuOpen={true}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const dock = container.querySelector('[data-testid="composer-dock"]');
    expect(dock?.classList.contains('is-queued-edit')).toBe(true);
    expect(container.querySelector('[data-testid="composer-queued-edit-banner"]')).not.toBeNull();
    expect(container.textContent).toContain('Editing queued message');
    expect(container.textContent).toContain('Change text, add images');

    const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');
    expect(textarea?.placeholder).toContain('paste an image');
    expect(textarea?.value).toBe('Rewrite this queued follow-up');
    expect(container.querySelector('[data-testid="composer-plus-btn"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="plus-menu-image"]')).not.toBeNull();
    expect(container.querySelector('[data-shelf-chip]')).not.toBeNull();

    const send = container.querySelector<HTMLButtonElement>('[data-testid="send-btn"]');
    expect(send?.getAttribute('aria-label')).toBe('Save changes');
    expect(send?.getAttribute('title')).toBe('Save back to the queue (Enter)');

    act(() => {
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(handleSend).toHaveBeenCalledTimes(1);
    expect(handleSteer).not.toHaveBeenCalled();

    act(() => {
      textarea?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }),
      );
    });
    expect(handleSend).toHaveBeenCalledTimes(2);
    expect(handleSteer).not.toHaveBeenCalled();

    act(() => {
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(handleCancel).toHaveBeenCalledTimes(1);
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

  it('hides the attachment shelf when composer has no diverted cards', () => {
    const rendered = renderDock(<ComposerDock {...baseProps} pendingAttachments={[]} />);
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="composer-attachment-shelf"]')).toBeNull();
  });

  it('does not pop shelf cards with Backspace when the textarea is empty', () => {
    const onRemoveAttachment = vi.fn();
    const onRemoveContextRef = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer=""
        onRemoveAttachment={onRemoveAttachment}
        onRemoveContextRef={onRemoveContextRef}
        pendingContextRefs={[
          {
            token: 'tok-1',
            key: 'file:/p:src/a.ts::',
            ref: { kind: 'file', projectPath: '/p', relativePath: 'src/a.ts', label: 'src/a.ts' },
            label: 'src/a.ts',
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

    expect(container.querySelector('[data-testid="composer-attachment-shelf"]')).not.toBeNull();

    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
      );
    });
    expect(onRemoveAttachment).not.toHaveBeenCalled();
    expect(onRemoveContextRef).not.toHaveBeenCalled();
  });

  it('does not send on Enter when textarea is empty even if attachments or context refs are present', () => {
    const onSend = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer=""
        onSend={onSend}
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
        pendingContextRefs={[
          {
            token: 'tok-1',
            key: 'file:/p:src/a.ts::',
            ref: { kind: 'file', projectPath: '/p', relativePath: 'src/a.ts', label: 'src/a.ts' },
            label: 'src/a.ts',
          },
        ]}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends /compact on Enter even while the slash menu is open', () => {
    const onSend = vi.fn();
    const rendered = renderDock(
      <ComposerDock {...baseProps} composer="/compact" onSend={onSend} />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="composer-slash-menu"]')).not.toBeNull();
    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('/compact');
  });

  it('completes a partial slash skill on Enter without sending', () => {
    const onSend = vi.fn();
    const onComposerChange = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer="/cre"
        onComposerChange={onComposerChange}
        onSend={onSend}
        menuSkills={[{ id: 'create-skill', name: 'create-skill', enabled: true }]}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="composer-slash-menu"]')).not.toBeNull();
    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(onComposerChange).toHaveBeenCalledWith('/create-skill ');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends a slash skill on Enter when args already follow the token', () => {
    const onSend = vi.fn();
    const onComposerChange = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer="/cre write a search skill"
        onComposerChange={onComposerChange}
        onSend={onSend}
        menuSkills={[{ id: 'create-skill', name: 'create-skill', enabled: true }]}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="composer-slash-menu"]')).not.toBeNull();
    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(onComposerChange).toHaveBeenCalledWith('/create-skill write a search skill');
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('/create-skill write a search skill');
  });

  it('does not send on Tab after selecting a partial slash token', () => {
    const onSend = vi.fn();
    const onComposerChange = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer="/cre"
        onComposerChange={onComposerChange}
        onSend={onSend}
        menuSkills={[{ id: 'create-skill', name: 'create-skill', enabled: true }]}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );
    });
    expect(onComposerChange).toHaveBeenCalledWith('/create-skill ');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('executes a mode on Enter without args and keeps args for send', () => {
    const onSend = vi.fn();
    const onAgentModeChange = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer="/goal"
        onSend={onSend}
        onAgentModeChange={onAgentModeChange}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(onAgentModeChange).toHaveBeenCalledWith('goal');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends mode args on one Enter', () => {
    const onSend = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer="/goal fix the bug"
        onSend={onSend}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('/goal fix the bug');
  });

  it('sends /compact on Enter while a run is paused', () => {
    const onSend = vi.fn();
    const onResume = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        paused
        composer="/compact"
        onSend={onSend}
        onResume={onResume}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onResume).not.toHaveBeenCalled();
  });

  it('sends a drafted prompt on Enter while paused instead of swallowing the key', () => {
    const onSend = vi.fn();
    const onResume = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        paused
        composer="先别继续，解释刚才的错误"
        onSend={onSend}
        onResume={onResume}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onResume).not.toHaveBeenCalled();
  });

  it('keeps Send enabled for /compact while Host admission is reconciling', () => {
    const onSend = vi.fn();
    const rendered = renderDock(
      <ComposerDock {...baseProps} composer="/compact" mutationsEnabled={false} onSend={onSend} />,
    );
    root = rendered.root;
    container = rendered.container;
    const send = container.querySelector('[data-testid="send-btn"]') as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    act(() => {
      send.click();
    });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('executes /ultra-code from the slash menu without a second Enter', () => {
    const onSend = vi.fn();
    const onComposerChange = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer="/"
        onComposerChange={onComposerChange}
        onSend={onSend}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const ultraItem = container.querySelector(
      '[data-testid="slash-item-cmd:ultra-code"]',
    ) as HTMLButtonElement;
    expect(ultraItem).not.toBeNull();
    act(() => {
      ultraItem.click();
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('/ultra-code');
  });

  it('keeps the slash menu closed after applying a non-execute command', () => {
    const onComposerChange = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer="/"
        onComposerChange={onComposerChange}
        onSend={vi.fn()}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const flashcardsItem = container.querySelector(
      '[data-testid="slash-item-cmd:flashcards"]',
    ) as HTMLButtonElement;
    expect(flashcardsItem).not.toBeNull();
    act(() => {
      flashcardsItem.click();
    });
    expect(onComposerChange).toHaveBeenCalledWith('/flashcards');

    act(() => {
      rendered.root.render(
        <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <ComposerDock
              {...baseProps}
              composer="/flashcards"
              onComposerChange={onComposerChange}
              onSend={vi.fn()}
            />
          </PiwinUiProvider>
        </DesktopLocaleProvider>,
      );
    });
    expect(container.querySelector('[data-testid="composer-slash-menu"]')).toBeNull();
  });

  it('executes compact from the slash menu without a second Send', () => {
    const onSend = vi.fn();
    const onComposerChange = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer="/"
        onComposerChange={onComposerChange}
        onSend={onSend}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const compactItem = container.querySelector(
      '[data-testid="slash-item-cmd:compact"]',
    ) as HTMLButtonElement;
    expect(compactItem).not.toBeNull();
    act(() => {
      compactItem.click();
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('/compact');
    expect(onComposerChange).toHaveBeenCalledWith('/compact');
  });

  it('sends on Enter when textarea has non-empty text', () => {
    const onSend = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer="fix this bug"
        onSend={onSend}
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

    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('does not pop a shelf card when Backspace deletes composer text', () => {
    const onRemoveAttachment = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer="hello"
        onRemoveAttachment={onRemoveAttachment}
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

    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
      );
    });
    expect(onRemoveAttachment).not.toHaveBeenCalled();
  });

  it('moves focus from the textarea to the last shelf card with Shift+Tab', () => {
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer="hello"
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

    const input = container.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]');
    const chip = container.querySelector<HTMLElement>('[data-shelf-chip]');
    expect(chip).not.toBeNull();
    act(() => {
      input?.focus();
      input?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(chip);
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

  it('enables send when carry content is present even if the composer is empty', () => {
    const handleSend = vi.fn();
    const rendered = renderDock(
      <ComposerDock {...baseProps} composer="" hasCarryContent={true} onSend={handleSend} />,
    );
    root = rendered.root;
    container = rendered.container;

    const sendBtn = container.querySelector<HTMLButtonElement>('[data-testid="send-btn"]');
    expect(sendBtn?.disabled).toBe(false);
    act(() => {
      sendBtn?.click();
    });
    expect(handleSend).toHaveBeenCalledTimes(1);
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
    expect(document.querySelector('[data-testid="composer-attachment-failure-dialog"]')).toBeNull();
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
    expect(document.querySelector('[data-testid="composer-attachment-failure-dialog"]')).toBeNull();
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
    expect(document.querySelector('[data-testid="composer-attachment-failure-dialog"]')).toBeNull();
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
    expect(
      active.container.querySelector('[data-testid="orchestration-scheme-unpinned-hint"]'),
    ).toBeNull();
  });

  it('shows an unpinned-model hint only for a selected scheme without a pinned default role', () => {
    const options = [
      { id: 'off', name: 'Freehand', description: 'Freehand' },
      {
        id: 'ultra-code',
        name: 'Ultra Code',
        description: 'Scout pack',
        unpinnedDefaultRole: 'scout',
      },
    ];
    const off = renderDock(
      <ComposerDock
        {...baseProps}
        orchestrationSchemeId="off"
        orchestrationSchemeOptions={options}
        onOrchestrationSchemeChange={vi.fn()}
      />,
    );
    expect(
      off.container.querySelector('[data-testid="orchestration-scheme-unpinned-hint"]'),
    ).toBeNull();

    const active = renderDock(
      <ComposerDock
        {...baseProps}
        orchestrationSchemeId="ultra-code"
        orchestrationSchemeOptions={options}
        onOrchestrationSchemeChange={vi.fn()}
        onOpenOrchestrationSchemeSettings={vi.fn()}
      />,
    );
    root = active.root;
    container = active.container;
    const toolbar = active.container.querySelector('.composer-v2-toolbar');
    expect(toolbar?.textContent ?? '').not.toMatch(/未指定模型|no pinned model/);
    const trigger = active.container.querySelector(
      '[data-testid="orchestration-scheme-trigger"]',
    );
    expect(trigger?.getAttribute('title')).toMatch(/scout/);
    expect(trigger?.getAttribute('title')).toMatch(/composer model|主模型/);
    expect(
      active.container.querySelector('[data-testid="orchestration-scheme-unpinned-hint"]'),
    ).toBeNull();

    act(() => {
      (trigger as HTMLButtonElement | null)?.click();
    });
    const hint = document.querySelector('[data-testid="orchestration-scheme-unpinned-hint"]');
    expect(hint?.textContent).toContain('scout');
    expect(hint?.textContent).toMatch(/composer model|主模型/);
    expect(toolbar?.contains(hint)).toBe(false);
  });

  it('hides Run Mode and Orchestration in Conversation, but keeps the Goal chip', () => {
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        isConversationSession
        agentMode="goal"
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

    expect(container.querySelector('[data-testid="composer-goal-chip"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="run-mode-trigger"]')).toBeNull();
    expect(container.querySelector('[data-testid="orchestration-scheme-trigger"]')).toBeNull();
    const textarea = container.querySelector(
      '[data-testid="composer-input"]',
    ) as HTMLTextAreaElement;
    expect(textarea.placeholder).toMatch(/objective|目标/i);
  });

  it('shows no mode control in Agent mode; Goal is entered through /goal', () => {
    const rendered = renderDock(<ComposerDock {...baseProps} />);
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="composer-goal-chip"]')).toBeNull();
  });

  it('Goal chip exits back to Agent', () => {
    const onAgentModeChange = vi.fn();
    const rendered = renderDock(
      <ComposerDock {...baseProps} agentMode="goal" onAgentModeChange={onAgentModeChange} />,
    );
    root = rendered.root;
    container = rendered.container;

    const chip = container.querySelector<HTMLButtonElement>('[data-testid="composer-goal-chip"]');
    expect(chip).not.toBeNull();
    act(() => {
      chip?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onAgentModeChange).toHaveBeenCalledWith('agent');
  });

  it('renders Inkstone .slab card structure and keyboard hint line', () => {
    const rendered = renderDock(<ComposerDock {...baseProps} />);
    root = rendered.root;
    container = rendered.container;

    const card = container.querySelector('[data-testid="composer-card"]');
    expect(card?.classList.contains('slab')).toBe(true);

    const textarea = container.querySelector('[data-testid="composer-input"]');
    expect(textarea?.classList.contains('ta')).toBe(true);

    const toolbar = container.querySelector('.composer-v2-toolbar');
    expect(toolbar?.classList.contains('bar')).toBe(true);

    const hint = container.querySelector('[data-testid="composer-hint"]');
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain('Enter');
  });
});
