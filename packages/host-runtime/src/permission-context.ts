/**
 * Build normalized PermissionRequestContext from host action/detail strings.
 */
import type { PermissionRequestContext, PermissionRiskKind } from '@piwin/contracts';

export function buildPermissionRequestContext(
  action: string,
  detail: string,
  facts?: { policyReason?: string; cwd?: string; command?: string; paths?: readonly string[] },
): PermissionRequestContext {
  const lowered = action.toLowerCase();
  const detailText = detail.trim();
  const outsideWorkspace =
    facts?.policyReason === 'path-escapes-project-root' ||
    facts?.policyReason === 'cwd-outside-workspace';

  // Explicit action kinds first — these are the canonical permission action
  // strings emitted by the host gates (evaluateFileWritePermission /
  // evaluateBashPermission). Matching them up front keeps the generic
  // `includes` fallbacks below from misclassifying edge cases.
  if (
    lowered === 'file-write' ||
    lowered.startsWith('file-write:') ||
    lowered === 'browser:upload' ||
    lowered === 'browser:screenshot'
  ) {
    const paths = facts?.paths ? [...facts.paths] : extractPaths(detailText);
    const secretRelated = /\.env|id_rsa|credentials|secret|api[_-]?key|token/i.test(detailText);
    const upload = lowered === 'browser:upload';
    const screenshot = lowered === 'browser:screenshot';
    return {
      kind: 'file-write',
      summary: outsideWorkspace
        ? upload
          ? 'Upload files from outside this workspace'
          : screenshot
            ? 'Save a screenshot outside this workspace'
            : 'Write outside this workspace'
        : action,
      secretRelated,
      ...(outsideWorkspace ? { outsideWorkspace: true } : {}),
      ...(paths.length > 0 ? { paths } : {}),
      reason: outsideWorkspace
        ? upload
          ? 'These files include a path outside the session workspace and will be sent to the browser page.'
          : 'This path is outside the session workspace. Allow this write only if the location is intended.'
        : secretRelated
          ? 'Write may touch secrets or credentials'
          : 'File write requires review',
      ...(detailText ? { command: detailText } : {}),
    };
  }

  if (lowered === 'process:start') {
    return {
      kind: 'command',
      summary: outsideWorkspace ? 'Run a process outside this workspace' : 'Start a background process',
      reason: outsideWorkspace
        ? 'The process will run in a directory outside the session workspace.'
        : 'Starting a background process requires review',
      ...(outsideWorkspace ? { outsideWorkspace: true } : {}),
      ...(facts?.cwd ? { cwd: facts.cwd } : {}),
      ...(facts?.command ? { command: facts.command } : {}),
    };
  }

  if (lowered === 'extensions:install' || lowered.startsWith('extensions:install ')) {
    return {
      kind: 'unknown' satisfies PermissionRiskKind,
      summary: 'Install a Pi extension',
      reason:
        'This loads executable code into the Agent with your OS privileges. Pi TUI UI, themes, keybindings, and /reload will not work in piwin.',
      ...(detailText ? { command: detailText } : {}),
    };
  }

  if (lowered === 'capabilities:install' || lowered.startsWith('capabilities:install ')) {
    return {
      kind: 'unknown' satisfies PermissionRiskKind,
      summary: 'Install a capability from the piwin catalog',
      reason:
        'Skills can ship scripts, and extensions and MCP servers run with your OS privileges. The source is pinned to the catalog version.',
      ...(detailText ? { command: detailText } : {}),
    };
  }

  if (lowered === 'bash' || lowered.startsWith('bash:')) {
    return {
      kind: 'command',
      summary: action,
      command: detailText || action,
      reason: 'Shell command requires review',
      destructive: /rm\s+-rf|sudo|mkfs|dd\s+if=|shutdown|reboot/i.test(detailText),
    };
  }

  if (lowered.startsWith('network:') || lowered.includes('web_') || lowered.includes('fetch')) {
    const host = extractHost(detailText);
    return {
      kind: 'network',
      summary: action,
      ...(host ? { host } : {}),
      reason: 'Outbound network access requires review',
      ...(detailText ? { command: detailText } : {}),
    };
  }

  if (lowered.startsWith('browser:') || lowered.includes('browser_navigate')) {
    const host = extractHost(detailText);
    const navigate = lowered === 'browser:navigate' || lowered.includes('browser_navigate');
    return {
      kind: 'network',
      summary: action,
      ...(host ? { host } : {}),
      reason: navigate
        ? 'Browser navigation requires review'
        : 'Browser interaction requires review',
      ...(detailText ? { command: detailText } : {}),
    };
  }

  if (lowered.startsWith('mcp:') || lowered.includes('mcp')) {
    const serverId =
      (lowered === 'mcp:tool-call' || lowered === 'mcp:connect'
        ? undefined
        : extractAfter(action, 'mcp:')) ||
      extractMcpServerFromToolDetail(detailText) ||
      extractServerId(detailText);
    const toolName = extractMcpToolFromToolDetail(detailText);
    const risk = extractMcpRiskFromDetail(detailText);
    const argsSummary = extractMcpArgsSummary(detailText);
    return {
      kind: 'mcp',
      summary: toolName ? `MCP tool ${serverId ?? '?'}.${toolName}` : action,
      ...(serverId ? { serverId } : {}),
      reason:
        risk === 'unknown'
          ? 'Unknown MCP tool risk — review before allowing'
          : `MCP ${risk} tool requires review`,
      ...(detailText ? { command: detailText } : {}),
      ...(serverId && toolName
        ? {
            mcpTool: {
              serverId,
              toolName,
              selector: `${serverId}.${toolName}`,
              risk,
              argumentsSummary: argsSummary ?? '{}',
            },
          }
        : {}),
    };
  }

  if (lowered.includes('git') || /\bgit\b/i.test(detailText)) {
    const destructive = /force|reset|clean|push\s+--force|hard/i.test(`${action} ${detailText}`);
    return {
      kind: 'git',
      summary: action,
      destructive,
      reason: destructive
        ? 'Destructive Git operation requires explicit approval'
        : 'Git mutation requires review',
      ...(detailText ? { command: detailText } : {}),
    };
  }

  if (
    lowered.includes('write') ||
    lowered.includes('file') ||
    /\.env|id_rsa|credentials|secret|key/i.test(detailText)
  ) {
    const paths = extractPaths(detailText);
    const secretRelated = /\.env|id_rsa|credentials|secret|api[_-]?key|token/i.test(detailText);
    return {
      kind: 'file-write',
      summary: action,
      secretRelated,
      ...(paths.length > 0 ? { paths } : {}),
      reason: secretRelated
        ? 'Write may touch secrets or credentials'
        : 'File write requires review',
      ...(detailText ? { command: detailText } : {}),
    };
  }

  if (
    lowered.includes('bash') ||
    lowered.includes('shell') ||
    lowered.includes('command') ||
    lowered.includes('exec')
  ) {
    return {
      kind: 'command',
      summary: action,
      command: detailText || action,
      reason: 'Shell command requires review',
      destructive: /rm\s+-rf|sudo|mkfs|dd\s+if=|shutdown|reboot/i.test(detailText),
    };
  }

  return {
    kind: 'unknown' satisfies PermissionRiskKind,
    summary: action,
    reason: 'Unrecognized permission risk; no persistent allow',
    ...(detailText ? { command: detailText } : {}),
  };
}

function extractHost(detail: string): string | undefined {
  const urlMatch = detail.match(/https?:\/\/([^/\s]+)/i);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }
  const hostMatch = detail.match(/\bhost[=:]\s*([\w.-]+)/i);
  return hostMatch?.[1];
}

function extractAfter(value: string, prefix: string): string | undefined {
  const index = value.toLowerCase().indexOf(prefix.toLowerCase());
  if (index < 0) {
    return undefined;
  }
  const rest = value.slice(index + prefix.length).trim();
  return rest.split(/[\s:/]/)[0] || undefined;
}

function extractServerId(detail: string): string | undefined {
  const match = detail.match(/server[=:]\s*([\w.-]+)/i);
  return match?.[1];
}

function extractPaths(detail: string): string[] {
  const matches = detail.match(/(?:\/[^\s:]+|[A-Za-z]:\\[^\s:]+)/g) ?? [];
  return [...new Set(matches)].slice(0, 12);
}

/** Detail shape: "server/tool risk=… args=…" or "server/tool". */
function extractMcpServerFromToolDetail(detail: string): string | undefined {
  const match = detail.match(/^([^/\s]+)\/([^\s]+)/);
  return match?.[1];
}

function extractMcpToolFromToolDetail(detail: string): string | undefined {
  const match = detail.match(/^[^/\s]+\/([^\s]+)/);
  return match?.[1];
}

function extractMcpRiskFromDetail(detail: string): import('@piwin/contracts').McpToolRisk {
  const match = detail.match(/\brisk=([a-z-]+)/i);
  const value = match?.[1]?.toLowerCase();
  switch (value) {
    case 'read':
    case 'network':
    case 'external-write':
    case 'local-write':
    case 'process':
    case 'credential':
    case 'unknown':
      return value;
    default:
      return 'unknown';
  }
}

function extractMcpArgsSummary(detail: string): string | undefined {
  const marker = ' args=';
  const index = detail.indexOf(marker);
  if (index === -1) {
    return undefined;
  }
  return detail.slice(index + marker.length).trim() || undefined;
}
