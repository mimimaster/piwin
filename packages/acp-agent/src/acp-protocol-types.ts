export type AcpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'resource'; resource: { uri: string; text: string; mimeType?: string } }
  | { type: 'resource_link'; uri: string; name: string; mimeType?: string };

export type AcpClientInfo = {
  name: string;
  version: string;
};

export type AcpInitializeParams = {
  protocolVersion: number;
  clientCapabilities: {
    fs: { readTextFile: boolean; writeTextFile: boolean };
    terminal: boolean;
  };
  clientInfo?: AcpClientInfo;
};

export type AcpAuthMethod = {
  id: string;
  name?: string;
  description?: string;
};

export type AcpInitializeResult = {
  protocolVersion: number;
  agentCapabilities?: unknown;
  authMethods?: AcpAuthMethod[];
  _meta?: Record<string, unknown>;
};

export type AcpNewSessionParams = {
  cwd: string;
  mcpServers: unknown[];
  _meta?: Record<string, unknown>;
};

export type AcpSessionSetupParams = {
  sessionId: string;
  cwd: string;
  mcpServers: unknown[];
};

export type AcpSessionSetupResult = {
  sessionId: string;
  modes?: unknown;
  models?: unknown;
  configOptions?: unknown;
  _meta?: Record<string, unknown>;
};

export type AcpPromptParams = {
  sessionId: string;
  prompt: AcpContentBlock[];
};

export type AcpPromptResult = {
  stopReason: string;
  _meta?: Record<string, unknown>;
};

export type AcpSessionListParams = {
  cwd?: string;
};

export type AcpSessionListResult = {
  sessions: Array<Record<string, unknown>>;
  nextCursor?: string;
};

export type XaiSessionOrigin = {
  kind?: string;
};

export type XaiSessionEntry = {
  sessionId: string;
  title?: unknown;
  cwd?: string;
  isWorktree?: boolean;
  modelId?: string;
  reasoningEffort?: string;
  yolo?: boolean;
  activity?: string;
  resident?: boolean;
  lastChangeUnixMs?: number;
  origin?: XaiSessionOrigin;
};
