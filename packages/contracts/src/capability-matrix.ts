/** Human-readable host capability matrix for doctor / Settings. */

import type { HostStatusData } from './ipc.js';

export type CapabilityRow = {
  id: string;
  label: string;
  available: boolean;
  /** Short honesty note when degraded or partial. */
  note?: string;
};

function row(
  id: string,
  label: string,
  available: boolean,
  note?: string,
): CapabilityRow {
  if (note !== undefined && note.length > 0) {
    return { id, label, available, note };
  }
  return { id, label, available };
}

export function buildCapabilityMatrix(
  capabilities: HostStatusData['capabilities'],
  options?: { mode?: HostStatusData['mode']; mock?: boolean },
): CapabilityRow[] {
  const rpcFallback = capabilities.rpcSdkFallback === true;
  const mode = options?.mode;
  const mock = options?.mock === true;

  let customNote: string | undefined;
  if (capabilities.customTools !== true) {
    customNote = 'Use SDK host mode (or live RPC with SDK fallback)';
  } else if (rpcFallback) {
    customNote = 'RPC host uses SDK session backend';
  }

  let ptyNote: string | undefined;
  if (capabilities.pty !== true) {
    ptyNote =
      capabilities.shellPreview === true
        ? 'Host path is shell preview; interactive PTY is Tauri desktop (ADR 0013)'
        : 'Not available';
  }

  let isolationAvailable = false;
  let isolationNote: string | undefined;
  if (mode === 'rpc' && rpcFallback) {
    isolationAvailable = false;
    isolationNote = 'RPC mode: SDK backend (no process isolation)';
  } else if (mode === 'rpc' && mock) {
    isolationAvailable = false;
    isolationNote = 'Mock RPC — isolation not simulated';
  } else if (mode === 'rpc' && !rpcFallback && !mock) {
    isolationAvailable = true;
  } else if (mode === 'sdk') {
    isolationAvailable = false;
    isolationNote = 'Host mode is SDK (in-process)';
  }

  return [
    row('customTools', 'Custom tools (web/MCP/memory/process)', capabilities.customTools === true, customNote),
    row('productTranscript', 'Product transcript resume', capabilities.productTranscript === true),
    row('mcpLifecycle', 'MCP lifecycle', capabilities.mcpLifecycle === true),
    row(
      'sessionLifecycle',
      'Session rename / archive / duplicate',
      capabilities.sessionLifecycle === true || capabilities.sessionPin === true,
    ),
    row('sessionSearch', 'Session search', capabilities.sessionSearch === true),
    row('process', 'Managed processes', capabilities.process === true),
    row('pty', 'Interactive terminal (PTY)', capabilities.pty === true, ptyNote),
    row(
      'shellPreview',
      'Shell preview (piped)',
      capabilities.shellPreview === true || capabilities.pty !== true,
      capabilities.pty === true ? 'Superseded by real PTY' : undefined,
    ),
    row(
      'automation',
      'Automation (cron/hooks)',
      capabilities.automation === true,
      'Hooks are post-event only; optional',
    ),
    row('extensions', 'Pi Extensions', capabilities.extensions === true),
    row('rpcIsolation', 'RPC process isolation', isolationAvailable, isolationNote),
  ];
}

export function formatCapabilityMatrixLines(
  capabilities: HostStatusData['capabilities'],
  options?: { mode?: HostStatusData['mode']; mock?: boolean },
): string[] {
  return buildCapabilityMatrix(capabilities, options).map((entry) => {
    const mark = entry.available ? 'yes' : 'no';
    const note = entry.note ? ` — ${entry.note}` : '';
    return `${entry.label}: ${mark}${note}`;
  });
}
