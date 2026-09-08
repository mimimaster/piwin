import type {
  ActivitySummaryItem,
  ConfiguredChatModel,
  RemoteHostStatusData,
  RemoteProjectSummary,
  RemoteSessionSummary,
} from '@piwin/contracts';
import { HostClient } from '@piwin/host-client';
import { requestActivitySummary } from '../mobile-activity-summary.js';
import {
  applyConfiguredModels,
  applyHostStatus,
  readArtifactEnabled,
  readPauseCheckpointId,
  readProjects,
  readSessions,
} from '../mobile-host-readers.js';
import { toError } from '../mobile-host-helpers.js';
import { readSessionMessages } from '../mobile-transcript.js';

const MOBILE_SESSION_LIST_MAX_ITEMS = 80;

export type MobileRemoteReadModelContext = {
  clientRef: { current: HostClient | undefined };
  activeSessionRef: { current: string | undefined };
  setHostStatus: (status: RemoteHostStatusData | undefined) => void;
  setErrorMessage: (message: string | undefined) => void;
  setProjects: (projects: RemoteProjectSummary[]) => void;
  setSessions: (sessions: RemoteSessionSummary[]) => void;
  setConfiguredModels: (models: ConfiguredChatModel[]) => void;
  setDefaultProviderId: (providerId: string | undefined) => void;
  setDefaultModelId: (modelId: string | undefined) => void;
  setActivityItems: (items: ActivitySummaryItem[]) => void;
  setArtifactEnabled: (enabled: boolean) => void;
  setActiveSessionId: (sessionId: string | undefined) => void;
  setMessages: (messages: ReturnType<typeof readSessionMessages>) => void;
  setPausedCheckpointId: (checkpointId: string | undefined) => void;
  beginSessionForeground: (client: HostClient, sessionId: string) => Promise<void>;
};

export function createMobileRemoteReadModelRefresher(
  context: MobileRemoteReadModelContext,
): (client: HostClient) => Promise<void> {
  return async (client: HostClient): Promise<void> => {
    try {
      const [statusResponse, projectsResponse, sessionsResponse, modelsResponse, activitySummary] =
        await Promise.all([
          client.request({ type: 'host/status' }),
          client.request({ type: 'project/list' }),
          client.request({
            type: 'session/list',
            allScopes: true,
            order: 'updated',
            maxItems: MOBILE_SESSION_LIST_MAX_ITEMS,
          }),
          client.request({ type: 'models/configured' }),
          requestActivitySummary(client),
        ]);
      if (context.clientRef.current !== client) {
        return;
      }
      applyHostStatus(statusResponse, context.setHostStatus, context.setErrorMessage);
      context.setProjects(readProjects(projectsResponse));
      const sessionList = readSessions(sessionsResponse);
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
      }

      if (targetSessionId !== undefined) {
        const resumeResponse = await client.request({
          type: 'session/resume',
          sessionId: targetSessionId,
        });
        if (context.clientRef.current === client && resumeResponse.success) {
          context.setMessages(readSessionMessages(resumeResponse));
          context.setPausedCheckpointId(readPauseCheckpointId(resumeResponse.data));
        }
        if (context.clientRef.current === client) {
          await context.beginSessionForeground(client, targetSessionId);
        }
      }
    } catch (error) {
      if (context.clientRef.current === client) {
        context.setErrorMessage(toError(error, '刷新 Host 状态失败。').message);
      }
    }
  };
}
