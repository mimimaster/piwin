import { useCallback, useEffect, useState } from 'react';
import type { ManagedProcessRecord } from '@piwin/contracts';
import type { HostClient } from '../host-client';

export function useManagedProcesses(
  hostClient: HostClient,
  options: { refreshWhenVisible: boolean },
) {
  const [managedProcesses, setManagedProcesses] = useState<ManagedProcessRecord[]>([]);
  const [processLogsById, setProcessLogsById] = useState<Record<string, string>>({});

  const refreshManagedProcesses = useCallback(async (): Promise<void> => {
    const response = await hostClient.request({ type: 'process/list' });
    if (!response.success) {
      return;
    }
    const processes =
      (response.data as { processes?: ManagedProcessRecord[] } | undefined)?.processes ?? [];
    setManagedProcesses(processes);
  }, [hostClient]);

  const loadProcessLogs = useCallback(
    async (processId: string): Promise<void> => {
      const response = await hostClient.request({
        type: 'process/logs',
        query: { processId },
      });
      if (!response.success) {
        return;
      }
      const chunks =
        (response.data as { chunks?: Array<{ text: string }> } | undefined)?.chunks ?? [];
      const text = chunks.map((chunk) => chunk.text).join('');
      setProcessLogsById((current) => ({
        ...current,
        [processId]: limitProcessLog(text),
      }));
    },
    [hostClient],
  );

  const stopManagedProcess = useCallback(
    async (processId: string): Promise<void> => {
      const response = await hostClient.request({ type: 'process/stop', processId });
      if (response.success) {
        await refreshManagedProcesses();
        await loadProcessLogs(processId);
      }
    },
    [hostClient, refreshManagedProcesses, loadProcessLogs],
  );

  const appendProcessLog = useCallback((processId: string, text: string): void => {
    setProcessLogsById((current) => ({
      ...current,
      [processId]: limitProcessLog(`${current[processId] ?? ''}${text}`),
    }));
  }, []);

  useEffect(() => {
    if (options.refreshWhenVisible) {
      void refreshManagedProcesses();
    }
  }, [options.refreshWhenVisible, refreshManagedProcesses]);

  return {
    managedProcesses,
    processLogsById,
    refreshManagedProcesses,
    loadProcessLogs,
    stopManagedProcess,
    appendProcessLog,
  };
}

function limitProcessLog(text: string): string {
  const MAX_PROCESS_LOG_BYTES = 512_000;
  if (text.length <= MAX_PROCESS_LOG_BYTES) {
    return text;
  }
  return `[earlier process output truncated]\n${text.slice(-MAX_PROCESS_LOG_BYTES)}`;
}
