import { describe, expect, it } from 'vitest';
import type { MarketplaceRequirement } from '@piwin/contracts';
import { checkMarketplaceRequirements, type RequirementsProbe } from './requirements-check.js';

function requirement(kind: MarketplaceRequirement['kind'], value: string): MarketplaceRequirement {
  return { kind, value, required: true, description: { en: '', zhCN: '' } };
}

const probe: RequirementsProbe = {
  platform: 'darwin',
  env: { PATH: '/usr/bin:/opt/bin', API_KEY: 'set', EMPTY_KEY: '  ' },
  isExecutable: (path) => path === '/opt/bin/uvx',
};

describe('checkMarketplaceRequirements', () => {
  it('reports observable requirements as met or missing', () => {
    const results = checkMarketplaceRequirements(
      {
        requirements: [
          requirement('host-os', 'macos'),
          requirement('host-os', 'linux'),
          requirement('command', 'uvx'),
          requirement('command', 'docker'),
          requirement('environment', 'API_KEY'),
          requirement('environment', 'EMPTY_KEY'),
        ],
      },
      probe,
    );
    expect(results.map((result) => result.status)).toEqual([
      'met',
      'missing',
      'met',
      'missing',
      'met',
      'missing',
    ]);
  });

  it('never guesses accounts, subscriptions, or path-like commands', () => {
    const results = checkMarketplaceRequirements(
      {
        requirements: [
          requirement('account', 'GitHub'),
          requirement('subscription', 'Pro'),
          requirement('command', '../bin/uvx'),
          requirement('host-os', 'beos'),
        ],
      },
      probe,
    );
    expect(results.every((result) => result.status === 'unknown')).toBe(true);
  });

  it('checks compound command values without false negatives', () => {
    const results = checkMarketplaceRequirements(
      {
        requirements: [
          requirement('command', 'uv / uvx'),
          requirement('command', 'uvx + playwright'),
          requirement('command', 'node / npx'),
        ],
      },
      { ...probe, isExecutable: (path) => path === '/opt/bin/uvx' || path === '/opt/bin/uv' },
    );
    expect(results.map((result) => result.status)).toEqual(['met', 'unknown', 'missing']);
  });

  it('honours PATHEXT on Windows', () => {
    const results = checkMarketplaceRequirements(
      { requirements: [requirement('command', 'node')] },
      {
        platform: 'win32',
        env: { Path: 'C:\\node', PATHEXT: '.EXE;.CMD' },
        isExecutable: (path) => path.endsWith('node.EXE'),
      },
    );
    expect(results[0]?.status).toBe('met');
  });
});
