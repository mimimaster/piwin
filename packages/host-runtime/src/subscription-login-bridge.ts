import { randomUUID } from 'node:crypto';
import type { AuthPromptPayload, HostPush } from '@piwin/contracts';
import type { HostAuthEvent, HostAuthPrompt } from '@piwin/agent-host';
import type { ActiveLogin } from './subscription-auth-state.js';
import { eventToPayload, promptToPayload } from './subscription-auth-prompt-payload.js';
import { selectSubscriptionLoginMethod } from './select-subscription-login-method.js';

type EmitPush = (message: HostPush) => void;

/**
 * Answers a provider prompt for the login in flight: auto-answers the choices
 * the Host can decide itself, otherwise publishes the prompt and waits for the
 * owning shell. Resolves with the answer, rejects when the prompt is cancelled.
 */
export function answerLoginPrompt(input: {
  active: ActiveLogin;
  prompt: HostAuthPrompt;
  isExtensionProvider: boolean;
  emit: EmitPush;
}): Promise<string> {
  const { active, prompt, emit } = input;
  if (prompt.type === 'select') {
    const method = selectSubscriptionLoginMethod(prompt.options);
    if (method) {
      return Promise.resolve(method);
    }
  }
  if (
    prompt.message?.includes('press Enter for browser login') ||
    // Extension OAuth flows commonly offer "browser login or paste a key";
    // shells drive the browser path, so accept it before any URL arrives.
    (input.isExtensionProvider &&
      prompt.type === 'text' &&
      !active.authUrl &&
      prompt.message?.includes('browser login'))
  ) {
    return Promise.resolve('');
  }
  const promptId = randomUUID();
  const payload = promptToPayload(active, promptId, prompt);
  active.currentPrompt = payload;
  emit({ type: 'auth/prompt', prompt: payload });
  return new Promise<string>((resolve, reject) => {
    active.pending = { promptId, resolve, reject };
    const signal = prompt.signal;
    if (!signal) {
      return;
    }
    const onAbort = (): void => {
      if (active.pending?.promptId !== promptId) {
        return;
      }
      delete active.pending;
      const cancelled: AuthPromptPayload = {
        ...payload,
        kind: 'prompt-cancelled',
        expectsResponse: false,
      };
      active.currentPrompt = cancelled;
      emit({ type: 'auth/prompt', prompt: cancelled });
      reject(new Error('prompt-cancelled'));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Relays a provider notification (auth URL, device code) to the shells, and
 * opens the URL on the Host when the login asked for that.
 */
export function relayLoginEvent(input: {
  active: ActiveLogin;
  event: HostAuthEvent;
  emit: EmitPush;
  openAuthUrl: ((url: string) => void) | undefined;
}): void {
  const { active, event, emit } = input;
  const payload = eventToPayload(active, randomUUID(), event);
  active.currentPrompt = payload;
  if (payload.kind === 'auth_url') {
    active.authUrl = payload;
  }
  const openUrl =
    payload.kind === 'auth_url'
      ? payload.url
      : payload.kind === 'device_code'
        ? payload.verificationUri
        : undefined;
  if (openUrl && active.openAuthUrlOnHost) {
    console.log(`[piwin-host] auth/prompt ${payload.kind} opening ${openUrl}`);
    input.openAuthUrl?.(openUrl);
  }
  emit({ type: 'auth/prompt', prompt: payload });
}
