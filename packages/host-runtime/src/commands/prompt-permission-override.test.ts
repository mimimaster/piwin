import { describe, expect, it } from 'vitest';
import type { PermissionMode } from '@piwin/contracts';
import { applyPromptPermissionOverride } from './prompt-preparation.js';

function captureOverride() {
  const actions: Array<{ kind: 'set'; mode: PermissionMode } | { kind: 'clear' }> = [];
  return {
    actions,
    context: {
      setSessionPermissionOverride: (_sessionId: string, mode: PermissionMode): void => {
        actions.push({ kind: 'set', mode });
      },
      clearSessionPermissionOverride: (): void => {
        actions.push({ kind: 'clear' });
      },
    },
  };
}

describe('applyPromptPermissionOverride', () => {
  it('sets ask-all when the composer pill is Ask and config is still YOLO', () => {
    const { actions, context } = captureOverride();
    applyPromptPermissionOverride(context, {
      sessionId: 's1',
      permissionPreset: 'ask',
      agentMode: 'agent',
      configPreset: 'yolo',
    });
    expect(actions).toEqual([{ kind: 'set', mode: 'ask-all' }]);
  });

  it('clears the override on a plain agent turn so CLI/config apply', () => {
    const { actions, context } = captureOverride();
    applyPromptPermissionOverride(context, {
      sessionId: 's1',
      agentMode: 'agent',
      configPreset: 'yolo',
    });
    expect(actions).toEqual([{ kind: 'clear' }]);
  });

  it('still raises ask-all for Plan mode under Auto config', () => {
    const { actions, context } = captureOverride();
    applyPromptPermissionOverride(context, {
      sessionId: 's1',
      agentMode: 'plan',
      configPreset: 'auto',
    });
    expect(actions).toEqual([{ kind: 'set', mode: 'ask-all' }]);
  });
});
