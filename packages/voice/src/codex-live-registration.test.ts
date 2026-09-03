import { describe, expect, it } from 'vitest';
import { renderLiveStartupContext } from '@piwin/contracts';
import { CodexLiveAdapter } from './codex-live-adapter.js';
import { createCodexLiveRegistration } from './codex-live-registration.js';

describe('createCodexLiveRegistration', () => {
  it('forwards voice and omits intelligence from the Codex call-create body', async () => {
    let body: unknown;
    const registration = createCodexLiveRegistration({
      authReady: async () => true,
      resolveAuth: async () => ({ accessToken: 't', accountId: 'a' }),
      createAdapter: () =>
        new CodexLiveAdapter({
          fetchImpl: async (_url, init) => {
            body = JSON.parse(String(init?.body));
            return new Response('v=0\no=- 1 1 IN IP4 0.0.0.0\ns=-\nt=0 0\n', { status: 201 });
          },
        }),
    });
    await registration.start({
      callId: 'c1',
      sessionId: 's1',
      settings: { voice: 'maple' },
      clientBootstrap: { mediaDriverId: 'codex-webrtc-v1', offerSdp: 'v=0\n' },
      signal: new AbortController().signal,
    });
    expect(body).toMatchObject({
      session: { audio: { output: { voice: 'maple' } } },
    });
    const posted = body as { session: { instructions?: string; intelligence?: string } };
    expect(posted.session).not.toHaveProperty('intelligence');
    expect(posted.session.instructions).toContain('speaking face of this work session');
    expect(posted.session.instructions).not.toContain('<');
  });

  it('wraps startup context as Codex developer initial_items', async () => {
    let body: unknown;
    const registration = createCodexLiveRegistration({
      authReady: async () => true,
      resolveAuth: async () => ({ accessToken: 't', accountId: 'a' }),
      createAdapter: () =>
        new CodexLiveAdapter({
          fetchImpl: async (_url, init) => {
            body = JSON.parse(String(init?.body));
            return new Response('v=0\no=- 1 1 IN IP4 0.0.0.0\ns=-\nt=0 0\n', { status: 201 });
          },
        }),
    });
    await registration.start({
      callId: 'c1',
      sessionId: 's1',
      settings: { voice: 'cove' },
      clientBootstrap: { mediaDriverId: 'codex-webrtc-v1', offerSdp: 'v=0\n' },
      signal: new AbortController().signal,
      startupContext: 'User is fixing Live voice.',
    });
    const posted = body as {
      session: { initial_items?: Array<{ role: string; content: Array<{ text: string }> }> };
    };
    expect(posted.session.initial_items?.[0]?.role).toBe('developer');
    expect(posted.session.initial_items?.[0]?.content[0]?.text).toBe(
      renderLiveStartupContext('User is fixing Live voice.'),
    );
  });
});
