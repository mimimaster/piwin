import type { HostCommand, HostResponse, SubscriptionAccount, SubscriptionAccountQuota } from '@piwin/contracts';
import { V1_SUBSCRIPTION_PROVIDER_IDS } from '@piwin/contracts';

type MockAuthState = {
  accounts: Map<string, SubscriptionAccount['state']>;
};

const states = new WeakMap<object, MockAuthState>();

function stateFor(owner: object): MockAuthState {
  const existing = states.get(owner);
  if (existing) {
    return existing;
  }
  const created: MockAuthState = { accounts: new Map() };
  states.set(owner, created);
  return created;
}

function v1Accounts(state: MockAuthState): SubscriptionAccount[] {
  return V1_SUBSCRIPTION_PROVIDER_IDS.map((providerId) => ({
    providerId,
    surface: 'v1',
    state: state.accounts.get(providerId) ?? 'logged-out',
  }));
}

function mockQuota(providerId: string): SubscriptionAccountQuota {
  return {
    providerId,
    planType: 'Mock',
    groups: [
      {
        windows: [
          {
            id: 'weekly',
            label: '周限额',
            type: 'used',
            percentage: 12,
            valueText: '已用 12%',
            colorTone: 'mint',
          },
        ],
      },
    ],
    lastUpdated: new Date().toISOString(),
  };
}

export function handleMockAuthCommand(
  owner: object,
  command: HostCommand,
  id: string,
): HostResponse | null {
  if (
    command.type !== 'auth/status' &&
    command.type !== 'auth/login' &&
    command.type !== 'auth/respond' &&
    command.type !== 'auth/cancel' &&
    command.type !== 'auth/claim' &&
    command.type !== 'auth/logout' &&
    command.type !== 'auth/quota' &&
    command.type !== 'auth/reset-quota'
  ) {
    return null;
  }
  const state = stateFor(owner);
  if (command.type === 'auth/status') {
    return { id, type: 'response', command: command.type, success: true, data: { accounts: v1Accounts(state) } };
  }
  if (command.type === 'auth/login') {
    state.accounts.set(command.input.providerId, 'logged-in');
    return { id, type: 'response', command: command.type, success: true, data: { loginId: `mock-${command.input.providerId}` } };
  }
  if (command.type === 'auth/logout') {
    state.accounts.set(command.input.providerId, 'logged-out');
    return { id, type: 'response', command: command.type, success: true, data: {} };
  }
  if (command.type === 'auth/quota') {
    return {
      id,
      type: 'response',
      command: command.type,
      success: true,
      data: { quota: mockQuota(command.input.providerId) },
    };
  }
  if (command.type === 'auth/reset-quota') {
    const quota = mockQuota(command.input.providerId);
    return {
      id,
      type: 'response',
      command: command.type,
      success: true,
      data: { ok: true, quota, message: '额度已重置成功' },
    };
  }
  return { id, type: 'response', command: command.type, success: true, data: {} };
}
