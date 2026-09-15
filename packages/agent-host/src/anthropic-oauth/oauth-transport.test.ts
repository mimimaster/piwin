import { describe, expect, it, vi } from 'vitest';
import {
  createAnthropicOAuthStreamSimple,
  isAnthropicOAuthToken,
} from './oauth-transport.js';
import { shapeAnthropicOAuthPayload } from './request-shaping.js';

describe('isAnthropicOAuthToken', () => {
  it('detects sk-ant-oat markers', () => {
    expect(isAnthropicOAuthToken('sk-ant-oat-abc')).toBe(true);
    expect(isAnthropicOAuthToken('sk-ant-api-key')).toBe(false);
    expect(isAnthropicOAuthToken(undefined)).toBe(false);
  });
});

describe('createAnthropicOAuthStreamSimple', () => {
  it('shapes OAuth payloads and leaves API-key payloads alone', async () => {
    const seen: unknown[] = [];
    const delegate = vi.fn((_model, _ctx, options) => {
      const payload = {
        model: 'claude-opus-4',
        stream: true,
        messages: [{ role: 'user', content: 'hello from test payload xx' }],
        system: 'You are an expert coding assistant operating inside pi, a coding agent harness.\n- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)',
      };
      void options?.onPayload?.(payload, { id: 'claude-opus-4' });
      seen.push(payload);
      return { [Symbol.asyncIterator]: async function* () {} };
    });

    const wrapped = createAnthropicOAuthStreamSimple(delegate as never);

    // API key path — no shape
    wrapped({} as never, {} as never, { apiKey: 'sk-ant-api03-plain' });
    await Promise.resolve();
    const apiKeyPayload = seen[0] as { system?: unknown };
    expect(JSON.stringify(apiKeyPayload.system ?? '')).not.toContain('x-anthropic-billing-header');

    // OAuth path — shape
    seen.length = 0;
    const oauthPayload = {
      model: 'claude-opus-4',
      stream: true,
      messages: [{ role: 'user', content: 'hello from test payload xx' }],
      system:
        'You are an expert coding assistant operating inside pi, a coding agent harness.\nline\n- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)',
    };
    const shaped = shapeAnthropicOAuthPayload(oauthPayload);
    expect(JSON.stringify(shaped)).toContain('x-anthropic-billing-header');
    expect(JSON.stringify(shaped)).toContain('cc_version=');

    wrapped({} as never, {} as never, { apiKey: 'sk-ant-oat-secret', onPayload: async (p) => p });
    expect(delegate).toHaveBeenCalled();
  });
});
