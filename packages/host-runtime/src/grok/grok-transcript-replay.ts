/**
 * Rebuild a Grok session's display projection from `session/load` replay
 * (ADR 0082). Grok replay messages carry no ids, so rows are rebuilt in
 * order and the product transcript is replaced wholesale.
 */

import { randomUUID } from 'node:crypto';
import type { AgentEvent, SessionIndexRecord, SessionTranscriptMessage } from '@piwin/contracts';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';

/**
 * Replace the display projection with the Grok replay. Rows are rebuilt from
 * ordered replay events because Grok messages carry no ids.
 */
export async function rebuildTranscriptFromReplay(
  deps: HostRuntimeKernel,
  record: SessionIndexRecord,
  events: readonly AgentEvent[],
  pendingUserMessageId: string | undefined,
): Promise<void> {
  const rows = replayEventsToRows(events);
  if (rows.length === 0) {
    return;
  }
  await deps.withTranscriptStore(
    record.id,
    async (store) => {
      const pending =
        pendingUserMessageId !== undefined ? await store.getMessage(pendingUserMessageId) : undefined;
      const existingIds: string[] = [];
      for await (const existing of store.iterateActivePath()) {
        existingIds.push(existing.id);
      }
      for (const id of existingIds) {
        await store.deleteMessage(id);
      }
      for (const row of rows) {
        await store.appendMessage({
          id: row.id,
          runtimeGenerationId: 'grok-replay',
          backendMessageId: row.id,
          role: row.role,
          text: row.text,
          status: 'done',
          createdAt: row.createdAt,
          ...(row.tools !== undefined ? { tools: row.tools } : {}),
        });
      }
      if (pending !== undefined) {
        // The prompt that triggered this activation stays after the history.
        await store.appendMessage({
          id: pending.id,
          runtimeGenerationId: 'grok-replay',
          backendMessageId: pending.id,
          role: pending.role,
          text: pending.text,
          status: pending.status,
          createdAt: new Date().toISOString(),
          ...(pending.contextRefs !== undefined ? { contextRefs: pending.contextRefs } : {}),
        });
      }
    },
    record.projectPath,
  );
}

type ReplayRow = {
  id: string;
  role: SessionTranscriptMessage['role'];
  text: string;
  createdAt: string;
  tools?: NonNullable<SessionTranscriptMessage['tools']>;
};

export function replayEventsToRows(events: readonly AgentEvent[]): ReplayRow[] {
  const rows: ReplayRow[] = [];
  const byId = new Map<string, ReplayRow>();
  const base = Date.now() - events.length;
  let ordinal = 0;
  let lastAssistant: ReplayRow | undefined;
  for (const event of events) {
    ordinal += 1;
    if (event.type === 'message/start') {
      const row: ReplayRow = {
        id: event.messageId,
        role: event.role,
        text: '',
        createdAt: new Date(base + ordinal).toISOString(),
      };
      rows.push(row);
      byId.set(event.messageId, row);
      if (event.role === 'assistant') lastAssistant = row;
      if (event.role === 'user') lastAssistant = undefined;
    } else if (event.type === 'message/text_delta') {
      const row = byId.get(event.messageId);
      if (row !== undefined) row.text += event.delta;
    } else if (event.type === 'tool/end') {
      let owner = event.responseMessageId !== undefined ? byId.get(event.responseMessageId) : lastAssistant;
      if (owner === undefined) {
        owner = { id: `grok-replay-${randomUUID()}`, role: 'assistant', text: '', createdAt: new Date(base + ordinal).toISOString() };
        rows.push(owner);
        byId.set(owner.id, owner);
        lastAssistant = owner;
      }
      owner.tools = [
        ...(owner.tools ?? []),
        {
          toolCallId: event.toolCallId,
          toolName: event.presentation?.title ?? 'tool',
          status: event.isError ? 'error' : 'done',
          output: event.presentation?.output?.text ?? '',
          ...(event.presentation !== undefined ? { presentation: event.presentation } : {}),
        },
      ];
    }
  }
  return rows.filter((row) => row.text !== '' || (row.tools?.length ?? 0) > 0);
}
