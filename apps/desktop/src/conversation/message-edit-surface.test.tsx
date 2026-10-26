// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { MediaAttachmentRef } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens';
import { DesktopLocaleProvider } from '../i18n/desktop-locale-context';
import type { EditResendCarry } from './conversation-branch';
import { MessageEditSurface } from './message-edit-surface';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const screenshot: MediaAttachmentRef = {
  id: 'att-1',
  kind: 'media',
  path: '/home/user/.piwin/media/att-1.png',
  mimeType: 'image/png',
  name: '截屏2026-10-26 16.45.55.png',
  contentKind: 'image',
  byteSize: 1024,
  source: 'paste',
};

describe('MessageEditSurface carried attachments', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function mountSurface(
    props: {
      initialText?: string;
      onResend?: (text: string, carry: EditResendCarry) => void;
    } = {},
  ): HTMLElement {
    const element = document.createElement('div');
    document.body.appendChild(element);
    const mounted = createRoot(element);
    const node: ReactElement = (
      <MessageEditSurface
        messageId="message-1"
        initialText={props.initialText ?? '行吧，你改下试试'}
        attachments={[screenshot]}
        onCancel={() => undefined}
        onResend={props.onResend ?? (() => undefined)}
      />
    );
    act(() => {
      mounted.render(
        <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>
        </DesktopLocaleProvider>,
      );
    });
    root = mounted;
    container = element;
    return element;
  }

  it('offers a remove control on a carried attachment', () => {
    const element = mountSurface();
    const remove = element.querySelector('[data-testid="transcript-att-remove"]');
    expect(remove).not.toBeNull();
    expect(remove?.getAttribute('aria-label')).toBe('移除附件');
  });

  it('drops the attachment locally and sends the remaining set', () => {
    const onResend = vi.fn();
    const element = mountSurface({ onResend });

    act(() => {
      element.querySelector<HTMLButtonElement>('[data-testid="transcript-att-remove"]')?.click();
    });

    expect(element.querySelector('[data-testid="transcript-att-remove"]')).toBeNull();
    expect(element.textContent).not.toContain('16.45.55');

    act(() => {
      element.querySelector<HTMLButtonElement>('[data-testid="send-btn"]')?.click();
    });

    expect(onResend).toHaveBeenCalledOnce();
    expect(onResend.mock.calls[0]?.[1]).toEqual({ attachments: [], contextRefs: [] });
  });

  it('keeps the carried attachment in the payload until it is dropped', () => {
    const onResend = vi.fn();
    const element = mountSurface({ onResend });

    act(() => {
      element.querySelector<HTMLButtonElement>('[data-testid="send-btn"]')?.click();
    });

    expect(onResend.mock.calls[0]?.[1]).toEqual({
      attachments: [screenshot],
      contextRefs: [],
    });
  });

  it('disables sending once the text and the last attachment are both gone', () => {
    const element = mountSurface({ initialText: '' });
    expect(element.querySelector<HTMLButtonElement>('[data-testid="send-btn"]')?.disabled).toBe(
      false,
    );

    act(() => {
      element.querySelector<HTMLButtonElement>('[data-testid="transcript-att-remove"]')?.click();
    });

    expect(element.querySelector<HTMLButtonElement>('[data-testid="send-btn"]')?.disabled).toBe(
      true,
    );
  });
});
