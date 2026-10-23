import { describe, expect, it } from 'vitest';
import { shouldBindSessionToSecondaryPane } from './conversation-pane-bind';

describe('shouldBindSessionToSecondaryPane', () => {
  it('binds only when the session already belongs to the active scope', () => {
    expect(
      shouldBindSessionToSecondaryPane({
        sessionScope: { kind: 'project', projectPath: '/p' },
        activeScope: { kind: 'project', projectPath: '/p' },
      }),
    ).toBe(true);
    expect(
      shouldBindSessionToSecondaryPane({
        sessionScope: { kind: 'project', projectPath: '/q' },
        activeScope: { kind: 'project', projectPath: '/p' },
      }),
    ).toBe(false);
    expect(
      shouldBindSessionToSecondaryPane({
        sessionScope: { kind: 'general' },
        activeScope: { kind: 'project', projectPath: '/p' },
      }),
    ).toBe(false);
    expect(
      shouldBindSessionToSecondaryPane({
        sessionScope: null,
        activeScope: { kind: 'general' },
      }),
    ).toBe(false);
  });
});
