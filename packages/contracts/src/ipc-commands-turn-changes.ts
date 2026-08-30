import type { TurnChangeDirection } from './turn-change.js';

export type HostTurnChangeCommand =
  | { id?: string; type: 'turn-changes/get'; changeSetId: string }
  | { id?: string; type: 'turn-changes/list-by-runs'; sessionId: string; runIds: string[] }
  | {
      id?: string;
      type: 'turn-changes/files';
      changeSetId: string;
      revision: number;
      cursor?: string;
      limit?: number;
    }
  | { id?: string; type: 'turn-changes/diff'; changeSetId: string; revision: number; fileId: string }
  | {
      id?: string;
      type: 'turn-changes/check';
      changeSetId: string;
      revision: number;
      direction: TurnChangeDirection;
    }
  | { id?: string; type: 'turn-changes/undo'; changeSetId: string; expectedRevision: number }
  | { id?: string; type: 'turn-changes/redo'; changeSetId: string; expectedRevision: number }
  | { id?: string; type: 'turn-changes/operation'; operationId: string }
  | { id?: string; type: 'turn-changes/operations'; workspaceId: string; cursor?: string }
  | { id?: string; type: 'turn-changes/cancel'; operationId: string }
  | {
      id?: string;
      type: 'turn-changes/recovery-preview';
      operationId: string;
      expectedRevision: number;
    }
  | {
      id?: string;
      type: 'turn-changes/recovery-run';
      operationId: string;
      expectedRevision: number;
      confirmationToken: string;
    }
  | {
      id?: string;
      type: 'turn-changes/recovery-verify';
      operationId: string;
      expectedRevision: number;
    };
