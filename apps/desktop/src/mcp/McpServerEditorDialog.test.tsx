// @vitest-environment happy-dom
/**
 * MCP server editor: the Remote URL transport saves a url server, and a
 * remote server opens with its own fields.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { McpServerConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens';
import { McpServerEditorDialog, type McpServerEditorDialogProps } from './McpServerEditorDialog';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function setFieldValue(testId: string, value: string): void {
  const host = document.querySelector(`[data-testid="${testId}"]`);
  const field =
    host instanceof HTMLInputElement || host instanceof HTMLTextAreaElement
      ? host
      : host?.querySelector('input, textarea');
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
    throw new Error(`no field for ${testId}`);
  }
  const prototype =
    field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

function clickByText(container: ParentNode, text: string): void {
  const target = [...container.querySelectorAll('label, button')].find(
    (element) => element.textContent?.trim() === text,
  );
  if (!(target instanceof HTMLElement)) throw new Error(`no control labelled ${text}`);
  target.click();
}

describe('McpServerEditorDialog remote transport', () => {
  let root: Root | undefined;
  let container: HTMLElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
  });

  function render(overrides: Partial<McpServerEditorDialogProps> = {}) {
    const onSave = vi.fn<McpServerEditorDialogProps['onSave']>(async () => true);
    const props: McpServerEditorDialogProps = {
      open: true,
      onOpenChange: () => undefined,
      serverId: '',
      server: undefined,
      document: { mcpServers: {}, pinnedSelectors: [] },
      isChinese: false,
      onSave,
      onValidateRaw: async () => ({ valid: true }),
      onSaveRaw: async () => true,
      onPreviewTools: async () => [],
      onTestConnection: async () => ({ ok: true, message: 'ok' }),
      onTogglePinned: async () => true,
      ...overrides,
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <McpServerEditorDialog {...props} />
        </PiwinUiProvider>,
      ),
    );
    return { onSave };
  }

  it('saves a remote url server with headers', async () => {
    const { onSave } = render();
    act(() => setFieldValue('mcp-editor-id', 'linear'));
    act(() => clickByText(document.body, 'Remote URL'));
    expect(document.querySelector('[data-testid="mcp-editor-command"]')).toBeNull();
    act(() => setFieldValue('mcp-editor-url', 'https://mcp.linear.app/mcp'));
    act(() => setFieldValue('mcp-editor-headers', 'Authorization: Bearer ${LINEAR}'));
    await act(async () => clickByText(document.body, 'Save'));
    expect(onSave).toHaveBeenCalledWith(
      'linear',
      { url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer ${LINEAR}' } },
      '',
    );
  });

  it('blocks saving a remote server without a valid url', async () => {
    const { onSave } = render();
    act(() => setFieldValue('mcp-editor-id', 'broken'));
    act(() => clickByText(document.body, 'Remote URL'));
    act(() => setFieldValue('mcp-editor-url', 'not a url'));
    await act(async () => clickByText(document.body, 'Save'));
    expect(onSave).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Enter an http:// or https:// URL.');
  });

  it('opens an existing remote server on the Remote URL fields', () => {
    const server: McpServerConfig = { type: 'sse', url: 'https://legacy.example/sse' };
    render({ serverId: 'legacy', server });
    const url = document.querySelector('[data-testid="mcp-editor-url"]');
    const input = url instanceof HTMLInputElement ? url : url?.querySelector('input');
    expect(input?.value).toBe('https://legacy.example/sse');
  });
});
