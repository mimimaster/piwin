import { describe, expect, it } from 'vitest';
import { isBackendWorkflowActive } from './backend-workflow.js';
describe('backend workflow lifecycle', () => {
  it.each(['active', 'running', 'pending', 'starting', 'waiting', 'resuming'])('recognizes %s as ongoing', (status) => expect(isBackendWorkflowActive(status)).toBe(true));
  it.each(['completed', 'done', 'failed', 'paused', 'interrupted', 'cancelled'])('recognizes %s as settled', (status) => expect(isBackendWorkflowActive(status)).toBe(false));
});
