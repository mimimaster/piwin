import { describe, expect, it } from 'vitest';
import type { ModelRef } from './host.js';
import type {
  WalkthroughArtifact,
  WalkthroughCancelData,
  WalkthroughErrorCode,
  WalkthroughGenerateData,
  WalkthroughListData,
} from './walkthrough-artifact.js';

const MODEL: ModelRef = {
  protocol: 'openai-compatible',
  providerId: 'p1',
  modelId: 'gpt-4o',
};

const BASE_FIELDS = {
  version: 1 as const,
  id: 'art-1',
  sessionId: 's1',
  messageId: 'm1',
  mode: 'default' as const,
  sourceHash: 'abc123',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('WalkthroughArtifact status variants', () => {
  it('generating variant requires generationId and allows missing model', () => {
    const artifact: WalkthroughArtifact = {
      ...BASE_FIELDS,
      status: 'generating',
      generationId: 'gen-1',
    };
    expect(artifact.status).toBe('generating');
    expect(artifact.model).toBeUndefined();
    if (artifact.status === 'generating') {
      expect(artifact.generationId).toBe('gen-1');
    }
  });

  it('ready variant requires markdown, generatedAt, and model', () => {
    const artifact: WalkthroughArtifact = {
      ...BASE_FIELDS,
      model: MODEL,
      status: 'ready',
      markdown: '# Walkthrough\n...',
      generatedAt: '2026-08-01T00:01:00.000Z',
    };
    expect(artifact.status).toBe('ready');
    if (artifact.status === 'ready') {
      expect(artifact.markdown).toBe('# Walkthrough\n...');
      expect(artifact.generatedAt).toBe('2026-08-01T00:01:00.000Z');
      expect(artifact.truncated).toBeUndefined();
    }
  });

  it('ready variant supports truncated flag', () => {
    const artifact: WalkthroughArtifact = {
      ...BASE_FIELDS,
      model: MODEL,
      status: 'ready',
      markdown: '...',
      truncated: true,
      generatedAt: '2026-08-01T00:01:00.000Z',
    };
    if (artifact.status === 'ready') {
      expect(artifact.truncated).toBe(true);
    }
  });

  it('error variant requires error and generatedAt; model can be missing', () => {
    const artifact: WalkthroughArtifact = {
      ...BASE_FIELDS,
      status: 'error',
      error: { code: 'provider-timeout', message: 'timed out' },
      generatedAt: '2026-08-01T00:01:00.000Z',
    };
    expect(artifact.model).toBeUndefined();
    if (artifact.status === 'error') {
      expect(artifact.error.code).toBe('provider-timeout');
      expect(artifact.error.message).toBe('timed out');
    }
  });

  it('discriminated union narrows by status', () => {
    const generating: WalkthroughArtifact = {
      ...BASE_FIELDS,
      status: 'generating',
      generationId: 'g',
    };
    const ready: WalkthroughArtifact = {
      ...BASE_FIELDS,
      model: MODEL,
      status: 'ready',
      markdown: 'm',
      generatedAt: 't',
    };
    const error: WalkthroughArtifact = {
      ...BASE_FIELDS,
      status: 'error',
      error: { code: 'cancelled', message: 'user cancelled' },
      generatedAt: 't',
    };
    if (generating.status === 'generating') {
      expect(typeof generating.generationId).toBe('string');
    }
    if (ready.status === 'ready') {
      expect(typeof ready.markdown).toBe('string');
    }
    if (error.status === 'error') {
      expect(error.error.code).toBe('cancelled');
    }
  });

  it('all 14 error codes are assignable', () => {
    const codes: WalkthroughErrorCode[] = [
      'disabled',
      'not-eligible',
      'session-not-found',
      'message-not-found',
      'model-unavailable',
      'provider-not-found',
      'model-not-configured',
      'missing-credentials',
      'unsupported-provider',
      'provider-request-failed',
      'provider-timeout',
      'empty-output',
      'invalid-config',
      'cancelled',
    ];
    expect(codes).toHaveLength(14);
    for (const code of codes) {
      const artifact: WalkthroughArtifact = {
        ...BASE_FIELDS,
        status: 'error',
        error: { code, message: 'msg' },
        generatedAt: 't',
      };
      expect(artifact.status).toBe('error');
    }
  });
});

describe('walkthrough IPC response data shapes', () => {
  it('WalkthroughListData carries artifacts', () => {
    const data: WalkthroughListData = {
      sessionId: 's1',
      artifacts: [
        { ...BASE_FIELDS, model: MODEL, status: 'ready', markdown: 'm', generatedAt: 't' },
      ],
    };
    expect(data.artifacts).toHaveLength(1);
  });

  it('WalkthroughGenerateData generating variant', () => {
    const data: WalkthroughGenerateData = {
      sessionId: 's1',
      messageId: 'm1',
      generationId: 'g1',
      status: 'generating',
    };
    if (data.status === 'generating') {
      expect(data.generationId).toBe('g1');
    }
  });

  it('WalkthroughGenerateData ready variant', () => {
    const data: WalkthroughGenerateData = {
      sessionId: 's1',
      messageId: 'm1',
      status: 'ready',
      artifact: { ...BASE_FIELDS, model: MODEL, status: 'ready', markdown: 'm', generatedAt: 't' },
    };
    if (data.status === 'ready') {
      expect(data.artifact.status).toBe('ready');
    }
  });

  it('WalkthroughCancelData shape', () => {
    const data: WalkthroughCancelData = {
      sessionId: 's1',
      messageId: 'm1',
      status: 'cancelled',
    };
    expect(data.status).toBe('cancelled');
    expect(data.generationId).toBeUndefined();
  });
});
