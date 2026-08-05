/** Wire-neutral types for Pi extension confirm/select/input interactions. */

export type ExtensionUiKind = 'confirm' | 'select' | 'input';

export type ExtensionUiRequest = {
  requestId: string;
  kind: ExtensionUiKind;
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
};

export type ExtensionUiResponse =
  | { kind: 'confirm'; confirmed: boolean }
  | { kind: 'select'; value?: string; cancelled?: boolean }
  | { kind: 'input'; value?: string; cancelled?: boolean };

/** Transport-neutral acknowledgement returned by the Host IPC resolver. */
export type ExtensionUiResolveData = {
  requestId: string;
  ok: boolean;
};

/** In-process port used by an agent backend to request extension UI. */
export interface ExtensionUiPort {
  request(input: ExtensionUiRequest, signal: AbortSignal): Promise<ExtensionUiResponse>;
}
