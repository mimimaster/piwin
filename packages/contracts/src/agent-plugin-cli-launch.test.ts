import { describe, expect, it } from 'vitest';
import {
  AGENT_PLUGIN_CLI_LAUNCH_MAX_ARGS,
  AGENT_PLUGIN_CLI_LAUNCH_MAX_ARG_CHARS,
  parseAgentPluginCliLaunchResult,
} from './agent-plugin-cli-launch.js';

describe('session/cli-launch descriptor', () => {
  const nativeId = 'native-session-1';
  const valid = {
    backendSessionId: nativeId,
    args: ['--fullscreen', '--resume', nativeId],
  };

  it('accepts a descriptor whose args include the native id as its own element', () => {
    expect(parseAgentPluginCliLaunchResult(valid)).toEqual(valid);
    expect(parseAgentPluginCliLaunchResult(valid, nativeId)).toEqual(valid);
  });

  it('rejects unknown keys, spawn overrides, missing native id token and trusted-id mismatch', () => {
    for (const hostile of [
      { ...valid, executable: '/usr/bin/grok' },
      { ...valid, cwd: '/tmp' },
      { ...valid, env: {} },
      { backendSessionId: nativeId, args: ['--resume=native-session-1'] },
      { backendSessionId: '', args: [nativeId] },
      { backendSessionId: nativeId, args: [] },
      { backendSessionId: 'other-id', args: ['--resume', 'other-id'] },
      { backendSessionId: `id\n`, args: ['id\n'] },
      { backendSessionId: nativeId, args: ['--resume', `${nativeId}\0`] },
      null,
    ]) {
      expect(parseAgentPluginCliLaunchResult(hostile, nativeId)).toBeUndefined();
    }
    expect(parseAgentPluginCliLaunchResult(valid, 'different-trusted-id')).toBeUndefined();
  });

  it('enforces argv count and string bounds without spawning', () => {
    expect(parseAgentPluginCliLaunchResult({
      backendSessionId: nativeId,
      args: Array.from({ length: AGENT_PLUGIN_CLI_LAUNCH_MAX_ARGS + 1 }, (_, index) =>
        index === 0 ? nativeId : `a${index}`),
    })).toBeUndefined();
    expect(parseAgentPluginCliLaunchResult({
      backendSessionId: nativeId,
      args: [nativeId, 'x'.repeat(AGENT_PLUGIN_CLI_LAUNCH_MAX_ARG_CHARS + 1)],
    })).toBeUndefined();
  });
});
