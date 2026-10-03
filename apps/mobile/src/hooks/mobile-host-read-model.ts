import type {
  ActivitySummaryItem,
  ConfiguredChatModel,
  RemoteHostStatusData,
  RemoteSessionSummary,
} from '@piwin/contracts';
import { HostClient } from '@piwin/host-client';
import { requestActivitySummary } from '../mobile-activity-summary.js';
import {
  applyConfiguredModels,
  applyHostStatus,
  readArtifactEnabled,
  readPauseCheckpointId,
  readProjectList,
} from '../mobile-host-readers.js';
import { toError } from '../mobile-host-helpers.js';
import { readSessionMessages } from '../mobile-transcript.js';
import { mobileSessionListCommand, readSessionListPage } from './mobile-session-list.js';
import type { MobileProjectList } from './mobile-project-list.js';

export type MobileRemoteReadModelContext = {
  clientRef: { current: HostClient | undefined };
  activeSessionRef: { current: string | undefined };
  /** Guards asynchronous hydration against a newer session selection. */
  selectionGenerationRef: { current: number };
  setHostStatus: (status: RemoteHostStatusData | undefined) => void;
  setErrorMessage: (message: string | undefined) => void;
  setProjectList: (snapshot: MobileProjectList) => void;
  setSessions: (sessions: RemoteSessionSummary[]) => void;
  setConfiguredModels: (models: ConfiguredChatModel[]) => void;
  setDefaultProviderId: (providerId: string | undefined) => void;
  setDefaultModelId: (modelId: string | undefined) => void;
  setActivityItems: (items: ActivitySummaryItem[]) => void;
  setArtifactEnabled: (enabled: boolean) => void;
  setActiveSessionId: (sessionId: string | undefined) => void;
  setMessages: (messages: ReturnType<typeof readSessionMessages>) => void;
  setPausedCheckpointId: (checkpointId: string | undefined) => void;
  beginSessionForeground: (
    client: HostClient,
    sessionId: string,
    expectedGeneration?: number,
  ) => Promise<void>;
};

export function createMobileRemoteReadModelRefresher(
  context: MobileRemoteReadModelContext,
): (client: HostClient) => Promise<void> {
  return async (client: HostClient): Promise<void> => {
    if (context.clientRef.current !== client) return;
    context.setProjectList({ status: 'loading', projects: [] });
    let projectsApplied = false;
    try {
      const [statusResponse, projectsResponse, sessionsResponse, modelsResponse, activitySummary] =
        await Promise.all([
          client.request({ type: 'host/status' }),
          client.supportsCommand('project/list')
            ? client.request({ type: 'project/list' }).catch((error: unknown) => ({
                type: 'response' as const,
                command: 'project/list' as const,
                success: false as const,
                error: toError(error, '读取 Host 项目列表失败。').message,
              }))
            : Promise.resolve(undefined),
          client.request(mobileSessionListCommand()),
          client.request({ type: 'models/configured' }),
          requestActivitySummary(client),
        ]);
      if (context.clientRef.current !== client) {
        return;
      }
      applyHostStatus(statusResponse, context.setHostStatus, context.setErrorMessage);
      context.setProjectList(readProjectList(projectsResponse));
      projectsApplied = true;
      const sessionList = readSessionListPage(sessionsResponse);
      context.setSessions(sessionList);
      applyConfiguredModels(
        modelsResponse,
        context.setConfiguredModels,
        context.setDefaultProviderId,
        context.setDefaultModelId,
      );
      context.setActivityItems(activitySummary.items);
      try {
        const settingsResponse = await client.request({ type: 'settings/get' });
        if (context.clientRef.current === client) {
          context.setArtifactEnabled(readArtifactEnabled(settingsResponse));
        }
      } catch {
        if (context.clientRef.current === client) {
          context.setArtifactEnabled(true);
        }
      }

      let targetSessionId = context.activeSessionRef.current;
      if (targetSessionId === undefined && sessionList.length > 0 && sessionList[0] !== undefined) {
        targetSessionId = sessionList[0].sessionId;
        context.activeSessionRef.current = targetSessionId;
        context.setActiveSessionId(targetSessionId);
        context.selectionGenerationRef.current += 1;
      }

      if (targetSessionId !== undefined) {
        const expectedGeneration = context.selectionGenerationRef.current;
        const resumeResponse = await client.request({
          type: 'session/resume',
          sessionId: targetSessionId,
        });
        if (
          context.clientRef.current !== client ||
          context.activeSessionRef.current !== targetSessionId ||
          context.selectionGenerationRef.current !== expectedGeneration
        ) {
          return;
        }
        if (resumeResponse.success) {
          context.setMessages(readSessionMessages(resumeResponse));
          context.setPausedCheckpointId(readPauseCheckpointId(resumeResponse.data));
        }
        await context.beginSessionForeground(client, targetSessionId, expectedGeneration);
      }
    } catch (error) {
      if (context.clientRef.current === client) {
        const message = toError(error, '刷新 Host 状态失败。').message;
        if (!projectsApplied) context.setProjectList({ status: 'error', projects: [], error: message });
        context.setErrorMessage(message);
      }
    }
  };
}
