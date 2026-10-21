import { describe, expect, it } from 'vitest';
import { withMcpEnvPlaceholders } from './mcp-draft-env.js';

describe('withMcpEnvPlaceholders', () => {
  it('adds empty required vars without overwriting known values', () => {
    expect(
      withMcpEnvPlaceholders({ command: 'npx', env: { TOKEN: 'set' } }, ['TOKEN', 'BUCKET']),
    ).toEqual({ command: 'npx', env: { TOKEN: 'set', BUCKET: '' } });
  });

  it('returns the draft untouched when nothing is required', () => {
    const draft = { command: 'uvx', args: ['x'] };
    expect(withMcpEnvPlaceholders(draft, [])).toBe(draft);
  });
});
