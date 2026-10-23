import { describe, expect, it } from 'vitest';
import type { ProviderConnectionTestResult } from '@piwin/contracts';
import { describeProviderConnectionResult } from './provider-connection-verdict.js';

function result(overrides: Partial<ProviderConnectionTestResult>): ProviderConnectionTestResult {
  return {
    providerId: 'ark',
    protocol: 'openai-compatible',
    outcome: 'chat-ok',
    method: 'model-test',
    durationMs: 30,
    ...overrides,
  };
}

describe('describeProviderConnectionResult', () => {
  it.each([
    ['chat-ok', 'ok', 'success'],
    ['catalog-ok', 'ok', 'success'],
    ['catalog-unavailable', 'warn', 'info'],
    ['auth-failed', 'err', 'error'],
    ['model-rejected', 'err', 'error'],
    ['unreachable', 'err', 'error'],
    ['invalid-config', 'err', 'error'],
  ] as const)('%s → tone %s via %s', (outcome, tone, notify) => {
    const verdict = describeProviderConnectionResult(result({ outcome }), false);
    expect(verdict.status.tone).toBe(tone);
    expect(verdict.notify).toBe(notify);
  });

  it('names the model and transport on success', () => {
    const verdict = describeProviderConnectionResult(
      result({ modelId: 'glm-5.2', chatApi: 'openai-responses' }),
      true,
    );
    expect(verdict.status.message).toBe('已连通 · glm-5.2 · Responses · 30ms');
  });

  it('tells the user to add models manually when there is no catalog', () => {
    const verdict = describeProviderConnectionResult(
      result({ outcome: 'catalog-unavailable', method: 'discovery', httpStatus: 404 }),
      true,
    );
    expect(verdict.status.message).toContain('HTTP 404');
    expect(verdict.status.message).toContain('手动添加模型 ID');
    expect(verdict.status.message).not.toContain('连接失败');
  });

  it('suggests the other transport on a chat 404', () => {
    const verdict = describeProviderConnectionResult(
      result({
        outcome: 'model-rejected',
        httpStatus: 404,
        modelId: 'doubao-seed-2.0-pro',
        chatApi: 'openai-completions',
        endpoint: 'https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions',
      }),
      false,
    );
    expect(verdict.status.message).toContain('/api/plan/v3/chat/completions');
    expect(verdict.status.message).toContain('Responses');
  });
});
