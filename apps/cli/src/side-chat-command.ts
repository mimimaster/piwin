/**
 * CLI side-chat commands (spec §12).
 *
 * The CLI has no panel UX but reuses the same Host commands as Desktop:
 *   - `piwin side-chat list <source-session-id> [--include-archived]`
 *   - `piwin side-chat open <source-session-id> [--name <name>] [--message <message-id>]`
 *   - `piwin side-chat sync <side-chat-session-id>`
 *   - `piwin side-chat send <side-chat-session-id> <text>`
 *   - `piwin side-chat resume <side-chat-session-id>`
 *
 * `send` and `resume` reuse the same `session/prompt` and `session/resume`
 * Host commands as the main chat flow — side chats are regular product
 * sessions with a read-only tool profile and inherited context.
 */
import { randomUUID } from 'node:crypto';
import type {
  HostCommand,
  HostPush,
  HostResponse,
  SideChatListData,
  SideChatOpenData,
  SideChatSyncData,
  SessionSummary,
} from '@piwin/contracts';
import { parseSessionContextSnapshot } from '@piwin/contracts';
import { formatCliAgentErrorEvent } from './cli-agent-error.js';
import { formatSessionContextOccupancy } from './context-command.js';

/* ------------------------------------------------------------------ */
/* Host client seam (testable)                                         */
/* ------------------------------------------------------------------ */

/**
 * Minimal host client surface the side-chat commands need. Identical to
 * WalkthroughHostClient — kept separate for clarity and future divergence.
 */
export type SideChatHostClient = {
  handleCommand: (
    command: HostCommand,
    options?: { idempotencyKey?: string },
  ) => Promise<HostResponse>;
  onPush: (handler: (message: HostPush) => void) => () => void;
  dispose: () => Promise<void>;
};

export type SideChatHostHandle = {
  handleCommand: SideChatHostClient['handleCommand'];
  dispose: () => Promise<void>;
};

/**
 * Keep caller-owned request options (idempotencyKey) on the Host handle.
 * `(command) => host.handleCommand(command)` drops the key and attached
 * `session/prompt` then fails with idempotency-key-required.
 */
export function bindSideChatHostClient(
  host: SideChatHostHandle,
  pushHandlers: Set<(message: HostPush) => void>,
): SideChatHostClient {
  return {
    handleCommand: (command, options) => host.handleCommand(command, options),
    onPush: (handler) => {
      pushHandlers.add(handler);
      return () => {
        pushHandlers.delete(handler);
      };
    },
    dispose: () => host.dispose(),
  };
}

/* ------------------------------------------------------------------ */
/* Output formatting (pure, unit-tested)                               */
/* ------------------------------------------------------------------ */

/**
 * Format a single side-chat session row for the `list` table.
 * Returns tab-separated `sessionId\tname\tversion\tsourceState`.
 */
export function formatSideChatListRow(session: SessionSummary): string {
  const version = session.sideChatRelation?.contextVersion ?? 0;
  const sourceState = session.sideChatRelation?.sourceState ?? 'active';
  const rawName = session.name ?? '';
  const name = rawName.trim().length > 0 ? rawName : '(unnamed)';
  return `${session.id}\t${name}\tv${version}\t${sourceState}`;
}

/**
 * Render the full `list` table with a header row. Empty input yields a
 * placeholder line.
 */
export function formatSideChatListTable(sessions: SessionSummary[]): string {
  if (sessions.length === 0) {
    return '(no side chats)';
  }
  const header = 'sessionId\tname\tversion\tsourceState';
  const rows = sessions.map(formatSideChatListRow);
  return [header, ...rows].join('\n');
}

/* ------------------------------------------------------------------ */
/* Command implementations                                             */
/* ------------------------------------------------------------------ */

/**
 * `piwin side-chat list <source-session-id>` — table of side chats.
 */
export async function runSideChatList(
  client: SideChatHostClient,
  sourceSessionId: string,
  log: (line: string) => void,
  options?: { includeArchived?: boolean },
): Promise<void> {
  const command: HostCommand = {
    type: 'side-chat/list',
    sourceSessionId,
    ...(options?.includeArchived ? { includeArchived: true } : {}),
  };
  const response = await client.handleCommand(command);
  if (!response.success) {
    throw new Error(response.error);
  }
  const data = response.data as SideChatListData | undefined;
  const sessions = data?.sessions ?? [];
  log(formatSideChatListTable(sessions));
}

/**
 * `piwin side-chat open <source-session-id> [--name <name>] [--message <message-id>]`
 * — creates a side chat and prints the new session id + context version.
 */
export async function runSideChatOpen(
  client: SideChatHostClient,
  sourceSessionId: string,
  log: (line: string) => void,
  options?: { name?: string; sourceMessageId?: string },
): Promise<SideChatOpenData> {
  const command: HostCommand = {
    type: 'side-chat/open',
    sourceSessionId,
    ...(options?.name ? { name: options.name } : {}),
    ...(options?.sourceMessageId ? { sourceMessageId: options.sourceMessageId } : {}),
  };
  const response = await client.handleCommand(command);
  if (!response.success) {
    throw new Error(response.error);
  }
  const data = response.data as SideChatOpenData | undefined;
  if (!data) {
    throw new Error('side-chat/open returned no data');
  }
  log(`created side chat ${data.sideChatSessionId} (context v${data.relation.contextVersion})`);
  return data;
}

/**
 * `piwin side-chat sync <side-chat-session-id>` — syncs context from source
 * and prints the new context version (or "unchanged").
 */
export async function runSideChatSync(
  client: SideChatHostClient,
  sideChatSessionId: string,
  log: (line: string) => void,
): Promise<SideChatSyncData> {
  const response = await client.handleCommand({
    type: 'side-chat/sync',
    sideChatSessionId,
  });
  if (!response.success) {
    throw new Error(response.error);
  }
  const data = response.data as SideChatSyncData | undefined;
  if (!data) {
    throw new Error('side-chat/sync returned no data');
  }
  log(`synced side chat ${sideChatSessionId} → context v${data.relation.contextVersion}`);
  return data;
}

/**
 * `piwin side-chat send <side-chat-session-id> <text>` — sends a prompt to
 * the side chat session. Reuses the same `session/prompt` Host command as
 * the main chat flow. Subscribes to agent events and prints the streaming
 * response, then waits for run/terminal before returning so the user sees
 * the full reply. The side chat's read-only tool profile is compiled at
 * session creation time, so no special CLI-side gating is needed.
 */
export async function runSideChatSend(
  client: SideChatHostClient,
  sideChatSessionId: string,
  text: string,
  log: (line: string) => void,
  options?: { timeoutMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const waiter = waitForSideChatRun(client, sideChatSessionId, timeoutMs, log);
  try {
    const response = await client.handleCommand(
      {
        type: 'session/prompt',
        sessionId: sideChatSessionId,
        input: { text },
        foreground: { kind: 'if-idle' },
      },
      { idempotencyKey: randomUUID() },
    );
    if (!response.success) {
      throw new Error(response.error);
    }
    const status = await waiter.promise;
    log(`\n[side chat run ${status}]`);
  } catch (error) {
    waiter.cancel();
    throw error;
  }
}

/**
 * Subscribe to pushes for a side chat session, print streaming text deltas,
 * and resolve when the run terminates. Mirrors the walkthrough wait pattern.
 */
function waitForSideChatRun(
  client: SideChatHostClient,
  sessionId: string,
  timeoutMs: number,
  log: (line: string) => void,
): { promise: Promise<string>; cancel: () => void } {
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<string>((resolve, reject) => {
    unsubscribe = client.onPush((message: HostPush) => {
      if (message.type === 'event' && message.sessionId === sessionId) {
        const event = message.event;
        switch (event.type) {
          case 'message/text_delta':
            log(event.delta);
            break;
          case 'message/text_snapshot':
            log(event.text);
            break;
          case 'message/end':
            log('\n');
            break;
          case 'error':
            log(formatCliAgentErrorEvent(event));
            break;
          default:
            break;
        }
      } else if (
        message.type === 'run/terminal' &&
        message.run.sessionId === sessionId
      ) {
        resolve(message.run.status);
      }
    });
    timer = setTimeout(() => {
      reject(new Error(`side chat send timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  const cancel = (): void => {
    if (timer) clearTimeout(timer);
    if (unsubscribe) unsubscribe();
  };
  // Clean up on resolve/reject so the push listener doesn't leak.
  promise.finally(() => cancel());
  return { promise, cancel };
}

/**
 * `piwin side-chat resume <side-chat-session-id>` — resumes a side chat
 * session. Reuses the same `session/resume` Host command.
 */
export async function runSideChatResume(
  client: SideChatHostClient,
  sideChatSessionId: string,
  log: (line: string) => void,
): Promise<void> {
  const response = await client.handleCommand({
    type: 'session/resume',
    sessionId: sideChatSessionId,
  });
  if (!response.success) {
    throw new Error(response.error);
  }
  log(`resumed side chat ${sideChatSessionId}`);
  const snapshot = parseSessionContextSnapshot(
    isRecord(response.data) ? response.data.contextSnapshot : undefined,
  );
  if (snapshot) {
    log(formatSessionContextOccupancy(snapshot));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
