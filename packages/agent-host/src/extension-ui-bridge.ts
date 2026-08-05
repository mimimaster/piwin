/**
 * Bridges Pi ExtensionUIContext dialogs to piwin host UI (Desktop permission/extension modals).
 * Bind via AgentSession.bindExtensions({ uiContext, mode: 'rpc' }) after createAgentSession.
 *
 * @see docs/adr/0011-rpc-sdk-fallback-and-prompts.md
 * @see D-EXT-04
 */

import type {
  ExtensionUiKind,
  ExtensionUiRequest,
  ExtensionUiResponse,
} from '@piwin/contracts';

export type { ExtensionUiKind, ExtensionUiRequest, ExtensionUiResponse } from '@piwin/contracts';

export type ExtensionUiBridge = {
  request: (request: ExtensionUiRequest) => Promise<ExtensionUiResponse>;
  notify?: (message: string, level: 'info' | 'warning' | 'error') => void;
};

/**
 * Minimal ExtensionUIContext-compatible object for Pi bindExtensions.
 * Dialog methods route through the host; TUI-only methods are no-ops.
 */
export function createExtensionUiContext(
  sessionId: string,
  bridge: ExtensionUiBridge,
  createRequestId: () => string,
): Record<string, unknown> {
  void sessionId;

  const confirm = async (
    title: string,
    message: string,
  ): Promise<boolean> => {
    const requestId = createRequestId();
    const response = await bridge.request({
      requestId,
      kind: 'confirm',
      title,
      message,
    });
    return response.kind === 'confirm' ? response.confirmed : false;
  };

  const select = async (
    title: string,
    options: string[],
  ): Promise<string | undefined> => {
    const requestId = createRequestId();
    const response = await bridge.request({
      requestId,
      kind: 'select',
      title,
      options,
    });
    if (response.kind !== 'select' || response.cancelled) {
      return undefined;
    }
    return response.value;
  };

  const input = async (
    title: string,
    placeholder?: string,
  ): Promise<string | undefined> => {
    const requestId = createRequestId();
    const request: ExtensionUiRequest = {
      requestId,
      kind: 'input',
      title,
    };
    if (placeholder !== undefined) {
      request.placeholder = placeholder;
    }
    const response = await bridge.request(request);
    if (response.kind !== 'input' || response.cancelled) {
      return undefined;
    }
    return response.value;
  };

  const notify = (
    message: string,
    type?: 'info' | 'warning' | 'error',
  ): void => {
    const level = type === 'warning' || type === 'error' ? type : 'info';
    bridge.notify?.(message, level);
  };

  return {
    select,
    confirm,
    input,
    notify,
    onTerminalInput: () => () => {},
    setStatus: () => {},
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    custom: async () => {
      throw new Error('extension custom UI is not supported in piwin desktop host');
    },
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => '',
    editor: async () => undefined,
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    theme: createStubTheme(),
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: 'theme switching via extension UI not supported' }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  };
}

function createStubTheme(): Record<string, unknown> {
  // Pi Theme is large; extensions rarely need full styling in host mode.
  return {
    name: 'piwin-host',
    mode: 'dark',
  };
}

export async function bindExtensionUiToPiSession(
  piSession: { bindExtensions?: (bindings: Record<string, unknown>) => Promise<void> },
  uiContext: Record<string, unknown>,
): Promise<boolean> {
  if (typeof piSession.bindExtensions !== 'function') {
    return false;
  }
  await piSession.bindExtensions({
    uiContext,
    // rpc mode: hasUI=true so extensions use confirm/select instead of silent no-op
    mode: 'rpc',
  });
  return true;
}
