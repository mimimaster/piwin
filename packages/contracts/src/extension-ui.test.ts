import { describe, expect, it } from 'vitest';
import type {
  ExtensionUiPort,
  ExtensionUiRequest,
  ExtensionUiResponse,
} from './extension-ui.js';

describe('Extension UI contracts', () => {
  it('keeps request and response shapes wire-neutral', async () => {
    const request: ExtensionUiRequest = {
      requestId: 'request-1',
      kind: 'select',
      title: 'Choose a mode',
      options: ['safe', 'fast'],
    };
    const response: ExtensionUiResponse = { kind: 'select', value: 'safe' };
    const port: ExtensionUiPort = {
      request: async (input, signal) => {
        expect(input).toEqual(request);
        expect(signal.aborted).toBe(false);
        return response;
      },
    };

    await expect(port.request(request, new AbortController().signal)).resolves.toEqual(response);
  });
});
