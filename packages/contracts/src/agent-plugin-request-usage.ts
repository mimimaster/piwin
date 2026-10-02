import type { AssistantUsageMeasurement } from './assistant-usage.js';

/** Native model request accounting, independent of a product Run's terminal outcome. */
export type AgentPluginRequestUsage = Omit<AssistantUsageMeasurement,
  'measurementId' | 'sessionId' | 'messageId' | 'runId' | 'runtimeGenerationId'> & {
  requestId: string;
  backendSessionId: string;
};

export type AgentPluginRequestUsageQuery = {
  from: string;
  sessions: readonly { backendSessionId: string; workingDirectory: string; modelId?: string }[];
};
