import { useCallback } from 'react';
import type { UseSessionActionsArgs } from './use-session-actions.js';
import { chooseSessionExportPath } from '../session-export-dialog.js';
import { pushError } from '../notification-queue.js';
import { appendHostLogEntry } from '../HostLogPanel.js';

export function useSessionExport({
  state,
  hostClient,
  dispatchNotification,
  setHostLogEntries,
}: Pick<
  UseSessionActionsArgs,
  'state' | 'hostClient' | 'dispatchNotification' | 'setHostLogEntries'
>) {
  const handleExportSession = useCallback(
    async (options?: { format?: 'md' | 'html'; redactTools?: boolean }): Promise<void> => {
      const sessionId = state.activeSessionId;
      if (!sessionId) {
        dispatchNotification(pushError('Select a session before exporting.'));
        return;
      }
      const format = options?.format === 'html' ? 'html' : 'md';
      const redactTools = options?.redactTools === true;
      const defaultName = `piwin-export-${sessionId.slice(0, 8)}.${
        format === 'html' ? 'html' : 'md'
      }`;

      let outputPath: string | undefined;
      const selectedPath = await chooseSessionExportPath({
        title: 'Export session',
        defaultName,
        format,
      });
      if (selectedPath === null) {
        return;
      }
      if (selectedPath) {
        outputPath = selectedPath;
      }

      const command: {
        type: 'session/export';
        sessionId: string;
        format: 'md' | 'html';
        redactTools: boolean;
        outputPath?: string;
      } = {
        type: 'session/export',
        sessionId,
        format,
        redactTools,
      };
      if (outputPath) {
        command.outputPath = outputPath;
      }
      const response = await hostClient.request(command);
      if (!response.success) {
        dispatchNotification(pushError(response.error));
        return;
      }
      const data = response.data as { path?: string; byteLength?: number; format?: string };
      const pathLabel = data.path ?? '(unknown path)';
      const sizeLabel = typeof data.byteLength === 'number' ? ` (${data.byteLength} bytes)` : '';
      setHostLogEntries((current) =>
        appendHostLogEntry(current, {
          level: 'info',
          message: `Exported session to ${pathLabel}${sizeLabel}`,
          at: new Date().toISOString(),
        }),
      );
    },
    [dispatchNotification, hostClient, setHostLogEntries, state.activeSessionId],
  );

  return handleExportSession;
}
