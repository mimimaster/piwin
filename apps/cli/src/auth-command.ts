import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { AuthPromptPayload, AuthStatusData, HostCommand, HostPush, HostResponse } from '@piwin/contracts';
import {
  AUTH_CLI_PROVIDER_IDS,
  getSubscriptionBillingNotice,
  isV1SubscriptionProviderId,
} from '@piwin/contracts';

function authCliLocale(): 'zh-CN' | 'en' {
  const lang = process.env.LANG ?? process.env.LC_ALL ?? '';
  return /^zh/i.test(lang) ? 'zh-CN' : 'en';
}

function printSubscriptionBillingNotice(providerId: string): void {
  const notice = getSubscriptionBillingNotice(providerId, authCliLocale());
  if (notice) {
    console.warn(`Warning: ${notice.compact} ${notice.manageUrl}`);
  }
}

export type AuthHostClient = {
  handleCommand: (
    command: HostCommand,
    options?: { idempotencyKey?: string },
  ) => Promise<HostResponse>;
  onPush: (handler: (message: HostPush) => void) => () => void;
};

export async function runAuthCommand(client: AuthHostClient, argv: string[]): Promise<void> {
  const action = argv[0] ?? 'status';
  if (action === 'status') {
    const response = await client.handleCommand({ type: 'auth/status' });
    if (!response.success) {
      throw new Error(response.error ?? 'auth/status failed');
    }
    const data = response.data as AuthStatusData;
    for (const account of data.accounts) {
      const collision = account.collidingChannelId ? ` collision=${account.collidingChannelId}` : '';
      console.log(`${account.providerId}\t${account.surface}\t${account.state}${collision}`);
      if (account.state === 'logged-in') {
        printSubscriptionBillingNotice(account.providerId);
      }
    }
    return;
  }
  if (action === 'logout') {
    const providerId = argv[1] ?? '';
    if (!isV1SubscriptionProviderId(providerId)) {
      throw new Error(`Usage: piwin auth logout <${AUTH_CLI_PROVIDER_IDS}>`);
    }
    const response = await client.handleCommand({ type: 'auth/logout', input: { providerId } });
    if (!response.success) {
      throw new Error(response.error ?? 'auth/logout failed');
    }
    return;
  }
  if (action === 'claim') {
    const loginId = argv[1] ?? '';
    const response = await client.handleCommand({ type: 'auth/claim', input: { loginId } });
    if (!response.success) {
      throw new Error(response.error ?? 'auth/claim failed');
    }
    return;
  }
  if (action === 'login') {
    const providerId = argv[1] ?? '';
    if (!isV1SubscriptionProviderId(providerId)) {
      throw new Error(`Usage: piwin auth login <${AUTH_CLI_PROVIDER_IDS}>`);
    }
    printSubscriptionBillingNotice(providerId);
    await loginInteractive(client, providerId);
    return;
  }
  throw new Error('Usage: piwin auth status | login <id> | logout <id> | claim <loginId>');
}

async function loginInteractive(client: AuthHostClient, providerId: string): Promise<void> {
  const rl = createInterface({ input, output });
  const finished = new Promise<void>((resolve, reject) => {
    const unsubscribe = client.onPush((message) => {
      if (message.type === 'auth/prompt') {
        void respondToPrompt(client, rl, message.prompt).catch(reject);
      }
      if (message.type === 'auth/login-finished') {
        unsubscribe();
        if (message.result.ok) {
          resolve();
        } else {
          reject(new Error(message.result.errorCode ?? 'login failed'));
        }
      }
    });
  });
  const loginIdHolder = { loginId: '' };
  const onSigint = (): void => {
    if (loginIdHolder.loginId) {
      void client.handleCommand({
        type: 'auth/cancel',
        loginId: loginIdHolder.loginId,
        ownerDeviceId: 'cli',
      });
    }
  };
  process.once('SIGINT', onSigint);
  const response = await client.handleCommand(
    {
      type: 'auth/login',
      input: { providerId, ownerDeviceId: 'cli', preferLoopback: true },
    },
    { idempotencyKey: randomUUID() },
  );
  if (!response.success) {
    process.off('SIGINT', onSigint);
    rl.close();
    throw new Error(response.error ?? 'auth/login failed');
  }
  const data = response.data as { loginId?: string } | undefined;
  if (typeof data?.loginId === 'string') {
    loginIdHolder.loginId = data.loginId;
  }
  try {
    await finished;
    printSubscriptionBillingNotice(providerId);
  } finally {
    process.off('SIGINT', onSigint);
    rl.close();
  }
}

async function respondToPrompt(
  client: AuthHostClient,
  rl: ReturnType<typeof createInterface>,
  prompt: AuthPromptPayload,
): Promise<void> {
  if (prompt.kind === 'device_code') {
    console.log(`${prompt.verificationUri}\n${prompt.userCode ?? ''}`);
    return;
  }
  if (prompt.kind === 'auth_url' && prompt.url) {
    console.log(prompt.instructions ?? prompt.url);
    console.log(prompt.url);
    return;
  }
  if (prompt.kind === 'info' || prompt.kind === 'progress') {
    if (prompt.message) {
      console.log(prompt.message);
    }
    return;
  }
  if (!prompt.expectsResponse) {
    return;
  }
  if (prompt.kind === 'select' && prompt.options) {
    for (const [index, option] of prompt.options.entries()) {
      console.log(`${index + 1}. ${option.label}`);
    }
    const answer = await rl.question('> ');
    const selected =
      prompt.options[Number.parseInt(answer, 10) - 1]?.id ?? prompt.options[0]?.id ?? answer;
    const respond = await client.handleCommand({
      type: 'auth/respond',
      input: {
        loginId: prompt.loginId,
        promptId: prompt.promptId,
        value: selected,
        ownerDeviceId: 'cli',
      },
    });
    if (!respond.success) {
      throw new Error(respond.error ?? 'auth/respond failed');
    }
    return;
  }
  const value = await rl.question(`${prompt.message}\n> `);
  const respond = await client.handleCommand({
    type: 'auth/respond',
    input: {
      loginId: prompt.loginId,
      promptId: prompt.promptId,
      value,
      ownerDeviceId: 'cli',
    },
  });
  if (!respond.success) {
    throw new Error(respond.error ?? 'auth/respond failed');
  }
}
