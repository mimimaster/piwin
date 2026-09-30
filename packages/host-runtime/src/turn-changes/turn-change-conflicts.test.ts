import { describe, expect, it } from 'vitest';

import type { HostPush } from '@piwin/contracts';
import { createProgressPusher, PROGRESS_PUSH_INTERVAL_MS } from './turn-change-conflicts.js';

describe('createProgressPusher', () => {
  it('throttles intermediate files and always pushes the last one', () => {
    const pushes: HostPush[] = [];
    let clock = 1_000;
    const onProgress = createProgressPusher({
      push: (message) => pushes.push(message),
      workspaceId: 'ws',
      changeSetId: 'cs',
      now: () => clock,
    });
    onProgress('op', 1, 4);
    onProgress('op', 2, 4);
    clock += PROGRESS_PUSH_INTERVAL_MS;
    onProgress('op', 3, 4);
    onProgress('op', 4, 4);
    expect(
      pushes.map((push) => (push.type === 'turn-changes/operation-updated' ? push.progress : undefined)),
    ).toEqual([
      { done: 1, total: 4 },
      { done: 3, total: 4 },
      { done: 4, total: 4 },
    ]);
  });
});
