/**
 * Form state for one MCP server in the editor dialog, and its conversion to
 * and from `McpServerConfig`. A draft keeps both transports' fields so
 * switching between "local command" and "remote URL" does not lose typing.
 */
import { isRemoteMcpServerConfig, type McpServerConfig } from '@piwin/contracts';

export type McpServerFormTransport = 'stdio' | 'remote';

export type McpServerFormDraft = {
  id: string;
  transport: McpServerFormTransport;
  command: string;
  argsText: string;
  envText: string;
  url: string;
  /** `auto` tries Streamable HTTP, then legacy SSE. */
  remoteType: 'auto' | 'http' | 'sse';
  headersText: string;
};

export type McpServerFormErrors = { id?: string; command?: string; url?: string };

export function emptyMcpServerFormDraft(): McpServerFormDraft {
  return {
    id: '',
    transport: 'stdio',
    command: '',
    argsText: '',
    envText: '',
    url: '',
    remoteType: 'auto',
    headersText: '',
  };
}

export function mcpServerToFormDraft(id: string, server: McpServerConfig): McpServerFormDraft {
  const draft = { ...emptyMcpServerFormDraft(), id };
  if (isRemoteMcpServerConfig(server)) {
    return {
      ...draft,
      transport: 'remote',
      url: server.url,
      remoteType: server.type ?? 'auto',
      headersText: formatPairs(server.headers, ': '),
    };
  }
  return {
    ...draft,
    command: server.command,
    argsText: (server.args ?? []).join(' '),
    envText: formatPairs(server.env, '='),
  };
}

export function mcpFormDraftToServer(draft: McpServerFormDraft): McpServerConfig {
  if (draft.transport === 'remote') {
    const headers = parsePairs(draft.headersText, ':');
    return {
      url: draft.url.trim(),
      ...(draft.remoteType !== 'auto' ? { type: draft.remoteType } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    };
  }
  const args = draft.argsText
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const env = parsePairs(draft.envText, '=');
  return {
    command: draft.command.trim(),
    ...(args.length > 0 ? { args } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}

/** Whether the transport fields are filled enough to save, test or probe. */
export function hasMcpServerEndpoint(draft: McpServerFormDraft): boolean {
  return draft.transport === 'remote'
    ? draft.url.trim().length > 0
    : draft.command.trim().length > 0;
}

export function validateMcpServerFormDraft(
  draft: McpServerFormDraft,
  isChinese: boolean,
): McpServerFormErrors {
  const errors: McpServerFormErrors = {};
  const id = draft.id.trim();
  if (!id) {
    errors.id = isChinese ? '请填写服务器 ID。' : 'Server ID is required.';
  } else if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    errors.id = isChinese
      ? '只能包含字母、数字、- 和 _。'
      : 'Only letters, digits, - and _ are allowed.';
  }
  if (draft.transport === 'remote') {
    if (!isHttpUrl(draft.url.trim())) {
      errors.url = isChinese
        ? '请填写 http:// 或 https:// 开头的地址。'
        : 'Enter an http:// or https:// URL.';
    }
  } else if (!draft.command.trim()) {
    errors.command = isChinese ? '请填写命令。' : 'Command is required.';
  }
  return errors;
}

function formatPairs(values: Record<string, string> | undefined, separator: string): string {
  return Object.entries(values ?? {})
    .map(([key, value]) => `${key}${separator}${value}`)
    .join('\n');
}

/**
 * One `KEY<sep>VALUE` per line; blank lines and `#` comments are skipped.
 * Env values keep the text after `=` as typed; header values (`Name: value`)
 * drop the conventional space after the colon.
 */
function parsePairs(text: string, separator: '=' | ':'): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf(separator);
    if (index <= 0) continue;
    const value = trimmed.slice(index + 1);
    result[trimmed.slice(0, index).trim()] = separator === ':' ? value.trim() : value;
  }
  return result;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
