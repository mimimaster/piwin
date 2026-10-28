import { describe, expect, it } from 'vitest';
import {
  projectHostSessionForRemoteClient,
  projectSessionList,
  projectSessionResume,
} from './remote-session-projection.js';

const model = { providerId: 'openrouter', modelId: 'deepseek-v4', protocol: 'openai-compatible' };

describe('remote composer profile projection', () => {
  it('lists each session with its own model, as Desktop sees it', () => {
    const listed = projectSessionList({
      sessions: [
        { id: 's1', scope: 'general', model, thinkingLevel: 'high' },
        { id: 's2', scope: 'general', model: { providerId: 7 }, thinkingLevel: '' },
      ],
    });
    expect(listed.sessions[0]).toMatchObject({ sessionId: 's1', model: { providerId: 'openrouter', modelId: 'deepseek-v4' }, thinkingLevel: 'high' });
    expect(listed.sessions[1]).not.toHaveProperty('model');
    expect(listed.sessions[1]).not.toHaveProperty('thinkingLevel');
  });

  it('carries the model through index pushes', () => {
    expect(
      projectHostSessionForRemoteClient({ id: 's1', scope: 'general', model, thinkingLevel: 'low' }),
    ).toMatchObject({ id: 's1', model: { modelId: 'deepseek-v4' }, thinkingLevel: 'low' });
  });

  it('resumes with the conversation orchestration scheme and delegation switch', () => {
    const base = { sessionId: 's1', live: false, messages: [] };
    expect(
      projectSessionResume({ ...base, orchestrationSchemeId: 'fusion', delegationDisabled: true }, {}),
    ).toMatchObject({ orchestrationSchemeId: 'fusion', delegationDisabled: true });
    const freehand = projectSessionResume({ ...base, delegationDisabled: 'yes' }, {});
    expect(freehand).not.toHaveProperty('orchestrationSchemeId');
    expect(freehand).not.toHaveProperty('delegationDisabled');
  });
});

describe('remote transcript failures', () => {
  it('keeps the structured failure so a remote error card can name it', () => {
    const resumed = projectSessionResume(
      {
        sessionId: 's1',
        live: false,
        messages: [
          {
            id: 'a1',
            role: 'assistant',
            text: '',
            createdAt: '2026-10-28T00:00:00.000Z',
            status: 'error',
            outcome: 'failed',
            failure: {
              code: 'provider-rate-limit',
              origin: 'provider',
              retriable: true,
              message: '429: Rate limit exceeded',
              httpStatus: 429,
            },
          },
        ],
      },
      {},
    );
    expect(resumed.messages[0]?.failure).toEqual({
      code: 'provider-rate-limit',
      origin: 'provider',
      retriable: true,
      message: '429: Rate limit exceeded',
      httpStatus: 429,
    });
  });

  it('drops a failure that is not a known shape', () => {
    const resumed = projectSessionResume(
      {
        sessionId: 's1',
        live: false,
        messages: [
          { id: 'a1', role: 'assistant', text: '', createdAt: '2026-10-28T00:00:00.000Z', status: 'error', failure: { code: 'made-up' } },
        ],
      },
      {},
    );
    expect(resumed.messages[0]).not.toHaveProperty('failure');
  });
});
