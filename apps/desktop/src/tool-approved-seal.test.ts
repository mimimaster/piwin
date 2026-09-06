import { describe, expect, it } from 'vitest';
import { shouldShowApprovedSeal } from './tool-approved-seal.js';

describe('shouldShowApprovedSeal', () => {
  it('stamps completed writes and shell commands', () => {
    expect(
      shouldShowApprovedSeal({
        status: 'done',
        toolName: 'write_file',
        presentation: { kind: 'filesystem', title: 'write_file' },
      }),
    ).toBe(true);
    expect(
      shouldShowApprovedSeal({
        status: 'done',
        toolName: 'bash',
        presentation: { kind: 'shell', title: 'bash', command: 'pnpm typecheck' },
      }),
    ).toBe(true);
  });

  it('does not stamp reads, searches, or unfinished work', () => {
    expect(
      shouldShowApprovedSeal({
        status: 'done',
        toolName: 'read',
        presentation: { kind: 'filesystem', title: 'read' },
      }),
    ).toBe(false);
    expect(
      shouldShowApprovedSeal({
        status: 'done',
        toolName: 'grep',
        presentation: { kind: 'filesystem', title: 'grep' },
      }),
    ).toBe(false);
    expect(shouldShowApprovedSeal({ status: 'running', toolName: 'write_file' })).toBe(false);
    expect(shouldShowApprovedSeal({ status: 'error', toolName: 'bash' })).toBe(false);
  });
});
