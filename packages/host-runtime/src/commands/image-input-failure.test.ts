import { describe, expect, it } from 'vitest';
import type { AgentFailure, PromptInput } from '@piwin/contracts';
import { failedAgentPromptOutcome } from '@piwin/contracts';
import {
  promptSentNativeImages,
  relabelImageInputFailure,
  relabelImageInputOutcome,
} from './image-input-failure.js';

const glmRejection: AgentFailure = {
  code: 'provider-http-error',
  origin: 'provider',
  message: `400 {"error":{"message":"messages.content.type 参数非法，取值范围 ['text']"}}`,
  retriable: false,
  httpStatus: 400,
};

describe('image input failure relabel', () => {
  it('relabels a 400 on a turn that sent native images', () => {
    expect(relabelImageInputFailure(glmRejection, true)).toEqual({
      ...glmRejection,
      code: 'provider-image-input-rejected',
      retriable: false,
    });
  });

  it('keeps the failure when no image was sent', () => {
    expect(relabelImageInputFailure(glmRejection, false)).toBe(glmRejection);
  });

  it('keeps non-shape statuses and other codes', () => {
    const tooLarge = { ...glmRejection, httpStatus: 413 };
    expect(relabelImageInputFailure(tooLarge, true)).toBe(tooLarge);
    const auth: AgentFailure = { ...glmRejection, code: 'provider-authentication', httpStatus: 401 };
    expect(relabelImageInputFailure(auth, true)).toBe(auth);
  });

  it('only touches failed outcomes', () => {
    const outcome = relabelImageInputOutcome(failedAgentPromptOutcome(glmRejection), true);
    expect(outcome.status === 'failed' && outcome.failure.code).toBe('provider-image-input-rejected');
  });

  it('detects native image attachments but not documents', () => {
    const base: PromptInput = { text: 'hi' };
    expect(promptSentNativeImages(base)).toBe(false);
    expect(
      promptSentNativeImages({
        ...base,
        attachments: [{ id: 'a', kind: 'media', path: '/m/a.png', mimeType: 'image/png', byteSize: 1, source: 'paste' }],
      }),
    ).toBe(true);
    expect(
      promptSentNativeImages({
        ...base,
        attachments: [{ id: 'b', kind: 'media', path: '/m/a.md', mimeType: 'text/markdown', byteSize: 1, source: 'paste' }],
      }),
    ).toBe(false);
  });
});
