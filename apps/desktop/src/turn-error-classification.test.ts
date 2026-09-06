import { describe, expect, it } from 'vitest';
import { classifyAgentFailure } from './turn-error-classification.js';

describe('classifyAgentFailure', () => {
  it('maps structured codes to exact titles and actions', () => {
    expect(
      classifyAgentFailure({
        code: 'provider-authentication',
        origin: 'provider',
        message: '401',
        retriable: false,
      }),
    ).toMatchObject({
      category: 'auth',
      titleZh: '模型认证失败',
      primaryAction: 'settings',
    });
    expect(
      classifyAgentFailure({
        code: 'provider-rate-limit',
        origin: 'provider',
        message: '429',
        retriable: true,
      }),
    ).toMatchObject({ category: 'quota', titleZh: '模型调用受限' });
    expect(
      classifyAgentFailure({
        code: 'model-stream-stalled',
        origin: 'transport',
        message: 'stalled',
        retriable: true,
      }),
    ).toMatchObject({
      category: 'stream',
      titleZh: '模型输出中断',
      primaryAction: 'retry',
    });
    expect(
      classifyAgentFailure({
        code: 'model-request-timeout',
        origin: 'transport',
        message: 'timeout',
        retriable: true,
      }),
    ).toMatchObject({ category: 'timeout', titleZh: '模型请求超时' });
    expect(
      classifyAgentFailure({
        code: 'context-limit-exceeded',
        origin: 'provider',
        message: 'too long',
        retriable: false,
      }),
    ).toMatchObject({ category: 'context', titleZh: '上下文长度超限', primaryAction: 'retry' });
    expect(
      classifyAgentFailure({
        code: 'model-stream-missing-finish',
        origin: 'protocol',
        message: 'missing finish',
        retriable: true,
      }),
    ).toMatchObject({
      category: 'stream',
      titleZh: '模型流异常结束',
      primaryAction: 'retry',
    });
    expect(
      classifyAgentFailure({
        code: 'provider-http-error',
        origin: 'provider',
        message: '502',
        retriable: true,
        httpStatus: 502,
      }),
    ).toMatchObject({ category: 'http', titleZh: '模型服务返回错误', primaryAction: 'retry' });
    expect(
      classifyAgentFailure({
        code: 'provider-http-error',
        origin: 'provider',
        message: '400',
        retriable: false,
        httpStatus: 400,
      }),
    ).toMatchObject({ category: 'http', primaryAction: 'copy' });
  });

  it('does not classify a stream stall as network', () => {
    const classification = classifyAgentFailure({
      code: 'model-stream-stalled',
      origin: 'transport',
      message: 'fetch failed: ECONNREFUSED',
      retriable: true,
    });
    expect(classification.category).toBe('stream');
    expect(classification.category).not.toBe('unknown');
  });

  it('maps provider-unavailable to a reachability failure, not UNKNOWN', () => {
    expect(
      classifyAgentFailure({
        code: 'provider-unavailable',
        origin: 'provider',
        message: 'Connection error (custom-openai · http://127.0.0.1:8317/v1)',
        retriable: true,
      }),
    ).toMatchObject({
      category: 'http',
      titleZh: '无法连接模型服务',
      titleEn: 'Could not reach model service',
      primaryAction: 'retry',
    });
  });

  it('maps legacy message-only errors to a generic generation failure', () => {
    expect(classifyAgentFailure(undefined)).toMatchObject({
      category: 'unknown',
      titleZh: '生成失败',
      titleEn: 'Generation failed',
      primaryAction: 'retry',
    });
  });

  it('maps backend crashes and protocol errors to concrete titles', () => {
    expect(
      classifyAgentFailure({
        code: 'backend-worker-crash',
        origin: 'runtime',
        message: 'worker exited',
        retriable: true,
      }),
    ).toMatchObject({
      category: 'unknown',
      titleZh: '后端进程异常',
      primaryAction: 'retry',
    });
    expect(
      classifyAgentFailure({
        code: 'backend-protocol-error',
        origin: 'protocol',
        message: 'bad frame',
        retriable: false,
      }),
    ).toMatchObject({
      category: 'unknown',
      titleZh: '协议错误',
      primaryAction: 'retry',
    });
  });
});
