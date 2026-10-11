import type { HostCommand, HostResponse } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import type { TuiHostLink } from './tui-host-link.js';
import { readTuiSessionIndex } from './tui-session-index.js';

function link(data: unknown, success = true): TuiHostLink {
  const request = async (command: HostCommand): Promise<HostResponse> =>
    success
      ? { type: 'response', command: command.type, success: true, data }
      : { type: 'response', command: command.type, success: false, error: 'unavailable' };
  return { request } as unknown as TuiHostLink;
}

describe('TUI session metadata', () => {
  it('recovers an archived project session and its external backend', async () => {
    expect(
      await readTuiSessionIndex(
        link({
          sessions: [
            { sessionId: 's1', projectId: 'p1', archived: true, backend: { agentId: 'grok' } },
          ],
        }),
        's1',
      ),
    ).toEqual({ projectId: 'p1', agentId: 'grok', archived: true });
  });
  it('keeps general Pi sessions free of project/agent overrides', async () => {
    expect(
      await readTuiSessionIndex(
        link({ sessions: [{ sessionId: 's1', backend: { agentId: 'pi' } }] }),
        's1',
      ),
    ).toEqual({});
  });
  it('has no metadata for a side chat outside the main session index', async () => {
    expect(
      await readTuiSessionIndex(link({ sessions: [{ sessionId: 'other' }] }), 's1'),
    ).toBeUndefined();
  });
  it('keeps the existing best-effort behavior if the index is unavailable', async () => {
    expect(await readTuiSessionIndex(link(undefined, false), 's1')).toBeUndefined();
  });
});
