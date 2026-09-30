import { expect, it } from 'vitest';
import { projectGrokMcpStatus } from './grok-mcp-status.js';

it('projects only safe fields and replaces raw error reasons', () => {
  const secret = 'fixture-secret-never-expose';
  const projected = projectGrokMcpStatus({ name: 'notes', transport: 'stdio', status: 'failed', reason: `Authorization Bearer ${secret}`, env: { TOKEN: secret }, args: [secret], headers: { token: secret } });
  expect(projected).toMatchObject({ name: 'notes', transport: 'stdio', status: 'failed' });
  expect(JSON.stringify(projected)).not.toContain(secret);
});
it('matches the non-paid Grok 1.0.44 unavailable status fixture without raw reasons', () => {
  const projected = projectGrokMcpStatus({ name: 'fixture-server', status: 'unavailable', reason: 'fixture-secret', sessionId: 'fixture-session', source: 'global', tools: [], detail: { transport: 'stdio', env: { token: 'fixture-secret' } } });
  expect(projected).toMatchObject({ name: 'fixture-server', status: 'unavailable', transport: 'stdio' });
  expect(JSON.stringify(projected)).not.toContain('fixture-secret');
});
it('rejects malformed statuses instead of forwarding arbitrary values', () => {
  expect(projectGrokMcpStatus({ name: 'notes', status: 'secret-looking' })).toBeUndefined();
  expect(projectGrokMcpStatus({ name: '\nsecret', status: 'connected' })).toBeUndefined();
});
