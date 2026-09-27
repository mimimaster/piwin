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
  ExtensionUiSurfaceUpdate,
} from '@piwin/contracts';

export type { ExtensionUiKind, ExtensionUiRequest, ExtensionUiResponse } from '@piwin/contracts';

export type ExtensionUiBridge = {
  request: (request: ExtensionUiRequest) => Promise<ExtensionUiResponse>;
  /** Surface updates (ADR 0078); absent means they stay no-ops. */
  publish?: (update: ExtensionUiSurfaceUpdate) => void;
};

/**
 * Minimal ExtensionUIContext-compatible object for Pi bindExtensions.
 * Dialogs route through the host; notify/status/text widgets/working message
 * publish surface updates; TUI component APIs are no-ops.
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

  // A surface update must never break the extension that sent it.
  const publish = (update: ExtensionUiSurfaceUpdate): void => {
    try {
      bridge.publish?.(update);
    } catch {
      // Delivery failures belong to the Host; the extension keeps running.
    }
  };

  const notify = (message: string, type?: 'info' | 'warning' | 'error'): void => {
    const level = type === 'warning' || type === 'error' ? type : 'info';
    publish({ kind: 'notify', message: stripTerminalStyling(String(message)), level });
  };

  const setStatus = (key: string, text: string | undefined): void => {
    publish(
      text === undefined
        ? { kind: 'status', key: String(key) }
        : { kind: 'status', key: String(key), text: stripTerminalStyling(String(text)) },
    );
  };

  const setWidget = (
    key: string,
    content: unknown,
    options?: { placement?: 'aboveEditor' | 'belowEditor' },
  ): void => {
    const placement = options?.placement === 'belowEditor' ? 'belowEditor' : 'aboveEditor';
    if (content === undefined) {
      publish({ kind: 'widget', key: String(key), placement });
      return;
    }
    // Component factories render TUI components; only text lines cross over.
    if (!Array.isArray(content)) return;
    publish({
      kind: 'widget',
      key: String(key),
      placement,
      lines: content.map((line) => stripTerminalStyling(String(line))),
    });
  };

  const setWorkingMessage = (message?: string): void => {
    publish(
      message === undefined
        ? { kind: 'working-message' }
        : { kind: 'working-message', message: stripTerminalStyling(String(message)) },
    );
  };

  return {
    select,
    confirm,
    input,
    notify,
    onTerminalInput: () => () => {},
    setStatus,
    setWorkingMessage,
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget,
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

/**
 * Pi Theme is large. Extensions mostly call its text-styling helpers before
 * `setStatus`/`setWidget`; in piwin those return the text unchanged so the
 * call succeeds and no terminal escapes reach clients.
 */
function createStubTheme(): Record<string, unknown> {
  const passthrough = (...args: unknown[]): string => String(args[args.length - 1] ?? '');
  return {
    name: 'piwin-host',
    mode: 'dark',
    fg: passthrough,
    bg: passthrough,
    bold: passthrough,
    italic: passthrough,
    underline: passthrough,
    strikethrough: passthrough,
    dim: passthrough,
    inverse: passthrough,
  };
}

// CSI/OSC escape sequences; extensions style text for a terminal.
const TERMINAL_ESCAPE_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

export function stripTerminalStyling(text: string): string {
  return text.replace(TERMINAL_ESCAPE_PATTERN, '');
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
