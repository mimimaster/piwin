import { describe, expect, it } from 'vitest';
import { buildGrokCliLaunch } from './grok-cli-launch.js';

describe('Grok native CLI launch', () => {
  it('resumes the vendor id, preserving spaces as arguments and enabling fullscreen', () => {
    expect(buildGrokCliLaunch({ executable: '/tools/grok', cwd: '/work/My Repo', cols: 80, rows: 24,
      binding: { agentId: 'grok', backendSessionId: 'native-session' } })).toEqual({
      executable: '/tools/grok', args: ['--fullscreen', '--cwd', '/work/My Repo', '--resume', 'native-session'],
      cwd: '/work/My Repo', cols: 80, rows: 24,
    });
  });
  it('refuses an unbound or different agent session', () => {
    for (const binding of [{ agentId: 'grok' }, { agentId: 'pi', backendSessionId: 'native' }]) {
      expect(() => buildGrokCliLaunch({ binding, executable: '/tools/grok', cwd: '/work', cols: 80, rows: 24 })).toThrow('grok-native-session-required');
    }
  });
});
