import { describe, expect, it } from 'vitest';
import { CLAUDE_CODE_OAUTH_PROVIDER_ID } from '@piwin/contracts';
import { buildSubscriptionAccounts } from './subscription-account-status.js';

describe('buildSubscriptionAccounts', () => {
  it('keeps extension-path Claude independent from plain Claude', () => {
    const config = { providers: [] };
    const onlyExt = buildSubscriptionAccounts(
      [{ providerId: CLAUDE_CODE_OAUTH_PROVIDER_ID, type: 'oauth' }],
      config,
    );
    expect(onlyExt.find((a) => a.providerId === 'anthropic')?.state).toBe('logged-out');
    expect(onlyExt.find((a) => a.providerId === CLAUDE_CODE_OAUTH_PROVIDER_ID)?.state).toBe(
      'logged-in',
    );

    const onlyExtra = buildSubscriptionAccounts([{ providerId: 'anthropic', type: 'oauth' }], config);
    expect(onlyExtra.find((a) => a.providerId === 'anthropic')?.state).toBe('logged-in');
    expect(onlyExtra.find((a) => a.providerId === CLAUDE_CODE_OAUTH_PROVIDER_ID)?.state).toBe(
      'logged-out',
    );
  });

  it('treats Claude Code api_key as the plan-quota login', () => {
    const accounts = buildSubscriptionAccounts(
      [{ providerId: CLAUDE_CODE_OAUTH_PROVIDER_ID, type: 'api_key' }],
      { providers: [] },
    );
    expect(accounts.find((account) => account.providerId === CLAUDE_CODE_OAUTH_PROVIDER_ID)?.state).toBe(
      'logged-in',
    );
    expect(accounts.find((account) => account.providerId === 'anthropic')?.state).toBe('logged-out');
    expect(
      buildSubscriptionAccounts([{ providerId: 'xai', type: 'api_key' }], { providers: [] }).find(
        (account) => account.providerId === 'xai',
      )?.state,
    ).toBe('logged-out');
  });
});
