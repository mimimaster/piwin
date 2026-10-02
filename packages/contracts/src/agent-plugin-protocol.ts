import type { AgentEvent, PermissionRequestContext, PromptInput } from './host.js';
import type { AgentPromptOutcome } from './agent-prompt-outcome.js';
import type { SessionBackendBinding } from './agent-backend.js';
import type { SessionBackendCapabilities, SessionBackendOptions, BackendPermissionOption } from './agent-backend-capabilities.js';
import type { ExternalAgentStatus, ExternalAgentMcpServerStatus } from './external-agent-status.js';
import type { BackendWorkflowSnapshot } from './backend-workflow.js';
import type { BackendRunIntervention, BackendRunInterventionEvent, BackendRunInterventionEventResult } from './run-intervention.js';

export const AGENT_PLUGIN_PROTOCOL_VERSION = 1;
export const AGENT_PLUGIN_MAX_FRAME_BYTES = 2 * 1024 * 1024;

/** Native catalog projection; vendor wire fields never cross this boundary. */
export type AgentPluginCatalogEntry = {
  backendSessionId: string;
  title?: string;
  cwd?: string;
  activity?: string;
  isWorktree?: boolean;
  lastChangeUnixMs?: number;
  modelId?: string;
  autoApprove?: boolean;
  originKind?: string;
};

export type AgentPluginSessionScope = { sessionId: string; runtimeGenerationId: string };
export type AgentPluginScope = { kind: 'plugin' } | ({ kind: 'session' } & AgentPluginSessionScope);
export type AgentPluginOpenInput = { cwd: string; binding: SessionBackendBinding };
export type AgentPluginOpenedSession = {
  backendSessionId: string;
  agentVersion?: string;
  capabilities: SessionBackendCapabilities;
  options: SessionBackendOptions;
  replayEvents: AgentPluginAgentEmission[];
};

/** A file proposal is not a Host media ref, a grant, or an absolute source path. */
export type AgentPluginMediaProposal = {
  directoryId: string;
  relativePath: string;
  kind: 'image' | 'video';
  importKey: string;
  prompt?: string;
  createdAt?: string;
};
export type AgentPluginAgentEmission = {
  type: 'agent';
  event: AgentEvent;
  media?: readonly AgentPluginMediaProposal[];
};
export type AgentPluginEmission =
  | AgentPluginAgentEmission
  | { type: 'options'; options: SessionBackendOptions }
  | { type: 'title'; title: string }
  | { type: 'mcp-status'; servers: readonly ExternalAgentMcpServerStatus[]; observed: boolean }
  | { type: 'closed'; reason: string };

export type AgentPluginPermissionPrompt = {
  action: string;
  detail: string;
  context: PermissionRequestContext;
  options: readonly BackendPermissionOption[];
  runId?: string;
};
export type AgentPluginPermissionDecision = { optionId: string } | { cancelled: true };

/** Requests operate a backend, not a second Host tools/Run/queue API. */
export type AgentPluginRequestMap = {
  'plugin/initialize': {
    params: { agentId: string; pluginRevision: string; hostProtocolVersion: number; runtime: { binaryPath?: string } };
    result: { agentId: string; protocolVersion: 1; requestUsage?: boolean };
  };
  'check': { params: { refresh: boolean }; result: ExternalAgentStatus };
  'catalog/list': { params: Record<string, never>; result: AgentPluginCatalogEntry[] };
  'catalog/usage': {
    params: import('./agent-plugin-request-usage.js').AgentPluginRequestUsageQuery;
    result: import('./agent-plugin-request-usage.js').AgentPluginRequestUsage[];
  };
  'catalog/rename': { params: { backendSessionId: string; title: string }; result: null };
  'catalog/delete': { params: { backendSessionId: string }; result: null };
  'session/new': { params: AgentPluginOpenInput; result: AgentPluginOpenedSession };
  'session/load': { params: AgentPluginOpenInput; result: AgentPluginOpenedSession };
  'session/resume': { params: AgentPluginOpenInput; result: AgentPluginOpenedSession };
  'session/prompt': { params: { input: PromptInput; runId: string }; result: AgentPromptOutcome };
  'session/cancel': { params: Record<string, never>; result: null };
  'session/options': { params: Record<string, never>; result: SessionBackendOptions };
  'session/model': { params: { modelId: string }; result: SessionBackendOptions };
  'session/effort': { params: { effortId: string }; result: SessionBackendOptions };
  'session/mode': { params: { modeId: string }; result: SessionBackendOptions };
  /** Native slash commands travel verbatim in prompt text; this returns discovery only. */
  'session/commands': { params: Record<string, never>; result: SessionBackendOptions['commands'] };
  'session/interject': { params: BackendRunIntervention; result: null };
  'session/interject-cancel': { params: { interventionId: string; expectedRevision: number }; result: boolean };
  'session/mcp-status': { params: Record<string, never>; result: { servers: ExternalAgentMcpServerStatus[]; observed: boolean } };
  'session/workflows': { params: AgentPluginOpenInput; result: BackendWorkflowSnapshot[] };
  'session/workflow-report': { params: AgentPluginOpenInput & { workflowId: string }; result: { workflowId: string; text: string } };
  'session/release': { params: Record<string, never>; result: null };
  'plugin/dispose': { params: Record<string, never>; result: null };
};

/** Reverse calls bridge existing permission/intervention channels, never arbitrary Host calls. */
export type AgentPluginCallbackMap = {
  'permission/request': { params: AgentPluginPermissionPrompt; result: AgentPluginPermissionDecision };
  'intervention/event': { params: BackendRunInterventionEvent; result: BackendRunInterventionEventResult };
};
export type AgentPluginMethodMap = AgentPluginRequestMap & AgentPluginCallbackMap;
export type AgentPluginMethod = keyof AgentPluginMethodMap;

export const AGENT_PLUGIN_METHODS = [
  'plugin/initialize', 'check', 'catalog/list', 'catalog/usage', 'catalog/rename', 'catalog/delete',
  'session/new', 'session/load', 'session/resume', 'session/prompt', 'session/cancel',
  'session/options', 'session/model', 'session/effort', 'session/mode', 'session/commands',
  'session/interject', 'session/interject-cancel', 'session/mcp-status',
  'session/workflows', 'session/workflow-report', 'session/release', 'plugin/dispose',
  'permission/request', 'intervention/event',
] as const satisfies readonly AgentPluginMethod[];

export type AgentPluginProtocolFailure = {
  code: 'invalid-request' | 'unsupported' | 'unavailable' | 'backend-error' | 'cancelled' | 'migration-required';
  message: string;
};
type AgentPluginCorrelatedFrame = {
  protocolVersion: 1;
  requestId: string;
  scope: AgentPluginScope;
};
export type AgentPluginRequest<Method extends AgentPluginMethod> = AgentPluginCorrelatedFrame & {
  kind: 'request'; method: Method; params: AgentPluginMethodMap[Method]['params'];
};
export type AgentPluginResponse<Method extends AgentPluginMethod> = AgentPluginCorrelatedFrame & {
  kind: 'response'; method: Method;
} & ({ ok: true; result: AgentPluginMethodMap[Method]['result'] } | { ok: false; error: AgentPluginProtocolFailure });
export type AgentPluginNotification = {
  protocolVersion: 1; kind: 'event'; scope: { kind: 'session' } & AgentPluginSessionScope;
  emission: AgentPluginEmission;
};

/** Decode envelopes first. Payloads stay unknown until a method-specific decoder accepts them. */
export type AgentPluginFrame =
  | (AgentPluginCorrelatedFrame & { kind: 'request'; method: AgentPluginMethod; params: unknown })
  | (AgentPluginCorrelatedFrame & { kind: 'response'; method: AgentPluginMethod } &
      ({ ok: true; result: unknown } | { ok: false; error: AgentPluginProtocolFailure }))
  | { protocolVersion: 1; kind: 'event'; scope: { kind: 'session' } & AgentPluginSessionScope; emission: unknown };
