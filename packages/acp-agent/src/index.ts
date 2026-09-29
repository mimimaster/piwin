export { parseJsonRpcLine } from './json-rpc-message.js';
export type {
  JsonRpcFailure,
  JsonRpcId,
  JsonRpcInbound,
  JsonRpcNotification,
  JsonRpcParseResult,
  JsonRpcRequest,
  JsonRpcSuccess,
} from './json-rpc-message.js';

export {
  AcpConnectionClosedError,
  AcpProtocolShapeError,
  AcpRequestTimeoutError,
  AcpRpcError,
} from './acp-errors.js';

export type { AcpLineTransport, AcpTransportCloseInfo } from './acp-line-transport.js';

export { JsonRpcConnection } from './json-rpc-connection.js';
export type {
  AcpCloseListener,
  AcpNotificationListener,
  AcpProtocolIssue,
  AcpRequestHandler,
  JsonRpcConnectionOptions,
} from './json-rpc-connection.js';

export { GROK_DROPPED_NOTIFICATION_METHODS, GROK_XAI_METHODS } from './grok-acp-methods.js';

export type {
  AcpAuthMethod,
  AcpClientInfo,
  AcpContentBlock,
  AcpInitializeParams,
  AcpInitializeResult,
  AcpNewSessionParams,
  AcpPromptParams,
  AcpPromptResult,
  AcpSessionListParams,
  AcpSessionListResult,
  AcpSessionSetupParams,
  AcpSessionSetupResult,
  XaiSessionEntry,
  XaiSessionOrigin,
} from './acp-protocol-types.js';

export { AcpClient } from './acp-client.js';

export {
  applyGrokToolUpdate,
  createGrokToolState,
  isGrokToolTerminal,
  mapAcpToolKind,
  presentGrokTool,
} from './grok-tool-projection.js';
export type { GrokToolState, GrokToolStatus } from './grok-tool-projection.js';

export { GrokTurnProjector } from './grok-turn-projector.js';
export type {
  GrokProjection,
  GrokSessionSignal,
  GrokTurnProjectorOptions,
} from './grok-turn-projector.js';

export {
  GROK_CONFIRMED_MODE_IDS,
  GROK_PERMISSION_MODES,
  GrokSessionOptionsState,
  parseGrokCommands,
  parseGrokConfigCurrent,
  parseGrokModelState,
} from './grok-session-options.js';
export type { GrokModelState } from './grok-session-options.js';

export {
  classifyGrokStopReason,
  parseGrokPermissionRequest,
  parseGrokPromptUsage,
  projectGrokCatalogEntry,
} from './grok-protocol-projection.js';
export type {
  GrokCatalogSession,
  GrokPermissionPrompt,
  GrokTurnTerminal,
  GrokTurnUsage,
} from './grok-protocol-projection.js';
