// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse, PiwinConfig } from '@piwin/contracts';
import type { HostClient } from '../host/host-client.js';
import { useWorkbenchSessionLifecycle } from './use-workbench-session-lifecycle.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('workbench startup scheduling', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  async function setup(config: PiwinConfig | null, activeSessionId: string | null = null) {
    const hostClient = {
      getTransport: () => 'live',
      request: vi.fn(async (command: HostCommand): Promise<HostResponse> => ({
        type: 'response',
        command: command.type,
        success: true,
        data: { projects: [], worktrees: [] },
      })),
    } as unknown as HostClient;
    // Deliberately leave the list pending: selecting a saved conversation must not wait for it.
    const hydrateSessions = vi.fn(() => new Promise<unknown>(() => undefined));
    const handleResumeSession = vi.fn(async () => undefined);
    const handleOpenProject = vi.fn(async () => undefined);
    const dispatch = vi.fn();
    function Harness() {
      useWorkbenchSessionLifecycle({
        hostClient,
        hostReady: true,
        projectPath: null,
        activeSessionId,
        config,
        setConfig: vi.fn(),
        dispatch,
        dispatchNotification: vi.fn(),
        hydrateSessions,
        handleOpenProject,
        handleResumeSession,
        showArchivedSessions: false,
        remoteCatchUpEpoch: 0,
        saveSettingsInOrder: vi.fn(async () => true),
      });
      return null;
    }
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<Harness />);
    });
    return { hydrateSessions, handleResumeSession, handleOpenProject, dispatch };
  }

  const saved = {
    providers: [],
    desktop: { lastSession: { sessionId: 'saved', scope: { kind: 'general' } } },
  } as unknown as PiwinConfig;

  it('loads the sidebar while initial config is pending', async () => {
    const hook = await setup(null);
    expect(hook.hydrateSessions).toHaveBeenCalledWith(
      { kind: 'general' },
      { includeArchived: false },
    );
    expect(hook.handleResumeSession).not.toHaveBeenCalled();
  });

  it('restores General directly while its list is still pending', async () => {
    const hook = await setup(saved);
    expect(hook.handleResumeSession).toHaveBeenCalledWith('saved', {
      scope: { kind: 'general' },
      quiet: true,
    });
    expect(hook.dispatch).not.toHaveBeenCalledWith({ type: 'project/clear' });
  });

  it('keeps a notification or user selection when startup config arrives late', async () => {
    const hook = await setup(saved, 'clicked');
    expect(hook.handleResumeSession).not.toHaveBeenCalled();
    expect(hook.handleOpenProject).not.toHaveBeenCalled();
  });
});
