import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse, SessionBranchListData } from '@piwin/contracts';
import { runSessionBranches, runSessionContinue,
  runSessionRetry, runSessionSwitch } from './session-branch-command.js';

function ok(command: HostCommand['type'], data: unknown): HostResponse {
  return { type: 'response', command, success: true, data };
}

describe('session branch CLI', () => {
  it('prints an indented fork list with the active sibling marked', async () => {
    const data: SessionBranchListData = {
      sessionId: 's1',
      revision: 'rev',
      branchPoints: [
        {
          anchorMessageId: 'a1',
          activeIndex: 1,
          siblings: [
            {
              headMessageId: 'u2a',
              role: 'user',
              preview: 'original',
              leafPreview: 'original end',
              messageCount: 2,
              writesWorkspace: true,
              updatedAt: '2026-08-21T00:00:00.000Z',
            },
            {
              headMessageId: 'u2b',
              role: 'user',
              preview: 'alternative',
              leafPreview: 'alternative end',
              messageCount: 2,
              writesWorkspace: false,
              updatedAt: '2026-08-21T00:01:00.000Z',
            },
          ],
        },
      ],
    };
    const handleCommand = vi.fn(async () => ok('session/branch-list', data));
    const lines: string[] = [];
    await runSessionBranches({ handleCommand }, 's1', (line) => lines.push(line));
    expect(handleCommand).toHaveBeenCalledWith({ type: 'session/branch-list', sessionId: 's1' });
    expect(lines[0]).toContain('fork 1 at a1');
    expect(lines[1]).toContain('[1] u2a (write)');
    expect(lines[2]).toMatch(/^\s+\*\s+\[2\] u2b {2}alternative/);
  });

  it('prints answer versions separately from prompt forks', async () => {
    const data: SessionBranchListData = {
      sessionId: 's1',
      revision: 'rev',
      branchPoints: [
        {
          anchorMessageId: 'u1',
          activeIndex: 0,
          siblings: [
            {
              headMessageId: 'a1',
              role: 'assistant',
              preview: 'first answer',
              leafPreview: 'first answer',
              messageCount: 1,
              writesWorkspace: false,
              updatedAt: '2026-08-21T00:00:00.000Z',
            },
            {
              headMessageId: 'a1-alt',
              role: 'assistant',
              preview: 'second answer',
              leafPreview: 'second answer',
              messageCount: 1,
              writesWorkspace: false,
              updatedAt: '2026-08-21T00:01:00.000Z',
            },
          ],
        },
      ],
    };
    const lines: string[] = [];
    await runSessionBranches({ handleCommand: async () => ok('session/branch-list', data) }, 's1', (line) =>
      lines.push(line),
    );
    expect(lines[0]).toContain('answers at u1');
  });

  it('sends session/prompt with retryUserMessageId', async () => {
    const handleCommand = vi.fn(async () => ok('session/prompt', { runId: 'run-1' }));
    const lines: string[] = [];
    await runSessionRetry({ handleCommand }, 's1', 'u1', (line) => lines.push(line), {
      keepPrevious: true,
    });
    expect(handleCommand).toHaveBeenCalledWith({
      type: 'session/prompt',
      sessionId: 's1',
      input: { text: '', retryUserMessageId: 'u1', keepPreviousAttempt: true },
    });
    expect(lines[0]).toContain('run run-1');
  });

  it('sends session/prompt with source continuation', async () => {
    const handleCommand = vi.fn(async () => ok('session/prompt', { runId: 'run-2' }));
    const lines: string[] = [];
    await runSessionContinue({ handleCommand }, 's1', (line) => lines.push(line));
    expect(handleCommand).toHaveBeenCalledWith({
      type: 'session/prompt',
      sessionId: 's1',
      input: { text: '', source: 'continuation' },
    });
    expect(lines[0]).toContain('run run-2');
  });

  it('prints run-active and switched outcomes', async () => {
    const runActive = vi.fn(async () => ok('session/branch-switch', { status: 'run-active' }));
    const lines: string[] = [];
    await runSessionSwitch({ handleCommand: runActive }, 's1', 'u2a', (line) => lines.push(line));
    expect(lines[0]).toContain('run-active');

    const switched = vi.fn(async () =>
      ok('session/branch-switch', {
        status: 'switched',
        sessionId: 's1',
        activeLeafMessageId: 'a2',
        session: {
          id: 's1',
          scope: { kind: 'general' },
          workingDirectory: '/tmp',
          projectPath: '',
          updatedAt: '2026-08-21T00:00:00.000Z',
          messageCount: 4,
        },
      }),
    );
    lines.length = 0;
    await runSessionSwitch({ handleCommand: switched }, 's1', 'u2a', (line) => lines.push(line));
    expect(lines[0]).toContain('switched s1 → leaf a2');
  });

  it('prints needs-confirmation and sends --confirm', async () => {
    const needs = vi.fn(async () =>
      ok('session/branch-switch', {
        status: 'needs-confirmation',
        offPathWrites: { files: ['src/app.ts'], hasUnknownWrites: false },
      }),
    );
    const lines: string[] = [];
    await runSessionSwitch({ handleCommand: needs }, 's1', 'u2a', (line) => lines.push(line));
    expect(needs).toHaveBeenCalledWith({
      type: 'session/branch-switch',
      sessionId: 's1',
      targetMessageId: 'u2a',
      messageProjection: 'none',
    });
    expect(lines[0]).toContain('needs-confirmation');
    expect(lines.some((line) => line.includes('--confirm'))).toBe(true);

    const confirmed = vi.fn(async () =>
      ok('session/branch-switch', {
        status: 'switched',
        sessionId: 's1',
        activeLeafMessageId: 'a2',
        session: {
          id: 's1',
          scope: { kind: 'general' },
          workingDirectory: '/tmp',
          projectPath: '',
          updatedAt: '2026-08-21T00:00:00.000Z',
          messageCount: 4,
        },
      }),
    );
    await runSessionSwitch({ handleCommand: confirmed }, 's1', 'u2a', () => undefined, {
      confirm: true,
    });
    expect(confirmed).toHaveBeenCalledWith({
      type: 'session/branch-switch',
      sessionId: 's1',
      targetMessageId: 'u2a',
      messageProjection: 'none',
      confirm: true,
    });
  });
});
