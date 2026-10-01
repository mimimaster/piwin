// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse, TurnChangeOperationEntry, TurnChangeSummary } from '@piwin/contracts';
import { TurnChangeRecordDialog } from './turn-change-record-dialog';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function summary(overrides: Partial<TurnChangeSummary> = {}): TurnChangeSummary {
  return {
    changeSetId: 'cs-1',
    attemptId: 'at-1',
    sessionId: 's-1',
    workspaceId: 'ws-1',
    userMessageId: null,
    runIds: ['run-1'],
    revision: 1,
    captureState: 'ready',
    disposition: 'undone',
    fileCount: 1,
    additions: 1,
    deletions: 1,
    binaryFileCount: 0,
    coverageComplete: true,
    undo: { allowed: false, reason: 'direction-unavailable' },
    redo: { allowed: true },
    expiresAt: '2026-10-30T00:00:00.000Z',
    latestOperationId: 'op-1',
    ...overrides,
  };
}

function entry(overrides: Partial<TurnChangeOperationEntry> = {}): TurnChangeOperationEntry {
  return {
    operationId: 'op-1',
    changeSetId: 'cs-1',
    sessionId: 's-1',
    workspaceId: 'ws-1',
    direction: 'undo',
    status: 'succeeded',
    revision: 1,
    fileCount: 1,
    createdAt: '2026-09-30T10:00:00.000Z',
    updatedAt: '2026-09-30T10:00:01.000Z',
    superseded: false,
    summary: summary(),
    ...overrides,
  };
}

const ok = (command: HostCommand, data: unknown): HostResponse => ({
  type: 'response',
  command: command.type,
  success: true,
  data,
});

let container: HTMLDivElement;
let root: Root;

const q = (id: string): HTMLElement | null => document.querySelector(`[data-testid="${id}"]`);
const all = (id: string): NodeListOf<HTMLElement> => document.querySelectorAll(`[data-testid="${id}"]`);

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderDialog(
  request: (command: HostCommand, options?: { idempotencyKey?: string }) => Promise<HostResponse>,
): Promise<void> {
  await act(async () => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <TurnChangeRecordDialog
          open
          onOpenChange={() => undefined}
          projectPath="/repo"
          request={request}
          subscribePush={() => () => undefined}
          locale="zh-CN"
        />
      </PiwinUiProvider>,
    );
  });
  await settle();
}

describe('TurnChangeRecordDialog', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('lists the workspace operations and restores the latest undo from its detail', async () => {
    const request = vi.fn(async (command: HostCommand) => {
      if (command.type === 'turn-changes/operations') {
        return ok(command, {
          workspaceId: 'ws-1',
          nextCursor: null,
          operations: [entry(), entry({ operationId: 'op-0', superseded: true })],
        });
      }
      if (command.type === 'turn-changes/redo') return ok(command, { operationId: 'op-2', status: 'succeeded' });
      return ok(command, {});
    });
    await renderDialog(request);

    expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: 'turn-changes/operations', projectPath: '/repo' }));
    expect(all('turn-change-record-row')).toHaveLength(2);

    await act(async () => all('turn-change-record-row')[0]?.click());
    expect(q('turn-change-record-detail')).not.toBeNull();
    await act(async () => q('turn-change-record-restore')?.click());
    await settle();
    expect(request).toHaveBeenCalledWith(
      { type: 'turn-changes/redo', changeSetId: 'cs-1', expectedRevision: 1 },
      { idempotencyKey: expect.any(String) },
    );

    await act(async () => q('turn-change-record-back')?.click());
    await act(async () => all('turn-change-record-row')[1]?.click());
    // A superseded operation is read only.
    expect(q('turn-change-record-restore')).toBeNull();
  });

  it('walks a stuck operation through preview, repair and verify', async () => {
    const stuck = entry({
      status: 'needs-repair',
      summary: summary({ disposition: 'applied', undo: { allowed: false, reason: 'needs-repair' }, redo: { allowed: false, reason: 'needs-repair' } }),
    });
    const request = vi.fn(async (command: HostCommand) => {
      switch (command.type) {
        case 'turn-changes/operations':
          return ok(command, { workspaceId: 'ws-1', nextCursor: null, operations: [stuck] });
        case 'turn-changes/recovery-preview':
          return ok(command, {
            operationId: 'op-1',
            changeSetId: 'cs-1',
            revision: 1,
            status: 'needs-repair',
            files: [{ relativePath: 'a.ts', state: 'operation-content' }],
            confirmationToken: 'tok-1',
          });
        case 'turn-changes/recovery-run':
          return ok(command, { outcome: 'restored', files: [] });
        case 'turn-changes/recovery-verify':
          return ok(command, { verified: true, files: [] });
        default:
          return ok(command, {});
      }
    });
    await renderDialog(request);
    await act(async () => all('turn-change-record-row')[0]?.click());
    await settle();

    expect(q('turn-change-record-repair')?.textContent).toContain('a.ts');
    await act(async () => q('turn-change-record-repair-run')?.click());
    await settle();

    expect(request).toHaveBeenCalledWith(
      { type: 'turn-changes/recovery-run', operationId: 'op-1', expectedRevision: 1, confirmationToken: 'tok-1' },
      { idempotencyKey: expect.any(String) },
    );
    expect(request).toHaveBeenCalledWith({ type: 'turn-changes/recovery-verify', operationId: 'op-1', expectedRevision: 1 });
    expect(q('turn-change-record-repair')?.textContent).toContain('已修复');
  });

  it('exports the backup of a stuck operation to a Host directory and explains a refusal', async () => {
    const stuck = entry({
      status: 'needs-repair',
      summary: summary({ disposition: 'applied', undo: { allowed: false, reason: 'needs-repair' }, redo: { allowed: false, reason: 'needs-repair' } }),
    });
    let exports = 0;
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      switch (command.type) {
        case 'turn-changes/operations':
          return ok(command, { workspaceId: 'ws-1', nextCursor: null, operations: [stuck] });
        case 'turn-changes/recovery-preview':
          return ok(command, { operationId: 'op-1', changeSetId: 'cs-1', revision: 1, status: 'needs-repair', files: [], confirmationToken: 'preview-token' });
        case 'turn-changes/export-backup':
          exports += 1;
          return exports === 1
            ? ok(command, { operationId: 'op-1', destination: '/backups/piwin-undo-backup-op-1', exportedPaths: ['a.ts'] })
            : { type: 'response', command: command.type, success: false, error: 'exists', problem: { code: 'destination-exists', message: 'exists' } } as HostResponse;
        default:
          return ok(command, {});
      }
    });
    await renderDialog(request);
    await act(async () => all('turn-change-record-row')[0]?.click());
    await settle();
    const input = q('turn-change-record-export-path') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    await act(async () => {
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '/backups');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => q('turn-change-record-export-run')?.click());
    await settle();
    expect(request).toHaveBeenCalledWith(
      { type: 'turn-changes/export-backup', operationId: 'op-1', destination: '/backups' },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(q('turn-change-record-export')?.textContent).toContain('已导出 1 个文件到 /backups/piwin-undo-backup-op-1');
    await act(async () => q('turn-change-record-export-run')?.click());
    await settle();
    expect(q('turn-change-record-export')?.textContent).toContain('未覆盖');
  });

  it('says so when the workspace has no record', async () => {
    await renderDialog(async (command) => ok(command, { workspaceId: 'ws-1', nextCursor: null, operations: [] }));
    expect(q('turn-change-record-empty')?.textContent).toContain('还没有');
  });
});
