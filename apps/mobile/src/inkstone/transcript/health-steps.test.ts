import { describe, expect, it } from 'vitest';
import { partitionHealthSteps } from './health-steps.js';
import type { WorkStep } from './turn-model.js';

describe('partitionHealthSteps', () => {
  it('lifts Apple Health reads out of the work log and keeps the rest in order', () => {
    const steps: WorkStep[] = [
      { kind: 'thinking', id: 't', text: '看看数据', streaming: false },
      {
        kind: 'tool',
        id: 'h',
        messageId: 'm',
        tool: { id: 'h', name: 'apple_health_read', status: 'done', presentation: { kind: 'health', title: '读取 Apple Health', summary: '睡眠' } },
      },
      { kind: 'tool', id: 'l', messageId: 'm', tool: { id: 'l', name: 'ls', status: 'done' } },
    ];
    const { health, work } = partitionHealthSteps(steps);
    expect(health.map((step) => step.id)).toEqual(['h']);
    expect(work.map((step) => step.id)).toEqual(['t', 'l']);
  });
});
