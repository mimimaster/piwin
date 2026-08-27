/**
 * In-session conversation tree for the Desktop mock Host (ADR 0055).
 * Linear sessions stay a single path until the first branch write; reads then
 * hide sibling branches the same way the SQLite store does.
 */

import type {
  SessionTranscriptMessage,
  TranscriptBranchPoint,
  TranscriptBranchSibling,
  WorkspaceWrites,
} from '@piwin/contracts';
import {
  collectOffPathWorkspaceWrites,
  collectWorkspaceWritesFromMessages,
  workspaceWritesFromMessage,
} from '@piwin/contracts';

export type MockTranscriptTreeHost = {
  transcript: SessionTranscriptMessage[];
  parentById?: Record<string, string | null>;
  activeLeafMessageId?: string | null;
};

const MAX_PREVIEW_CHARS = 120;

export function visibleMockTranscript(
  session: MockTranscriptTreeHost,
): SessionTranscriptMessage[] {
  if (session.parentById === undefined) {
    return session.transcript;
  }
  const leaf = session.activeLeafMessageId;
  if (leaf === null || leaf === undefined) {
    return [];
  }
  const byId = new Map(session.transcript.map((message) => [message.id, message]));
  const path: SessionTranscriptMessage[] = [];
  const seen = new Set<string>();
  let cursor: string | null = leaf;
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const row = byId.get(cursor);
    if (row === undefined) {
      break;
    }
    path.push(row);
    const parentId: string | null | undefined = session.parentById[cursor];
    cursor = parentId === undefined ? null : parentId;
  }
  return path.reverse();
}

export function ensureMockTree(session: MockTranscriptTreeHost): void {
  if (session.parentById !== undefined) {
    return;
  }
  const parentById: Record<string, string | null> = {};
  let previous: string | null = null;
  for (const message of session.transcript) {
    parentById[message.id] = previous;
    previous = message.id;
  }
  session.parentById = parentById;
  session.activeLeafMessageId = previous;
}

export function appendMockTranscriptMessage(
  session: MockTranscriptTreeHost,
  message: SessionTranscriptMessage,
): void {
  ensureMockTree(session);
  const parents = session.parentById;
  if (parents === undefined) {
    throw new Error('Mock transcript tree failed to initialize');
  }
  parents[message.id] = session.activeLeafMessageId ?? null;
  session.transcript.push(message);
  session.activeLeafMessageId = message.id;
}

export function mockOffPathWrites(
  session: MockTranscriptTreeHost,
  targetMessageId: string,
): WorkspaceWrites | null {
  ensureMockTree(session);
  return collectOffPathWorkspaceWrites({
    activePath: visibleMockTranscript(session),
    targetMessageId,
    parentById: session.parentById ?? {},
  });
}

export function rebaseMockLeaf(
  session: MockTranscriptTreeHost,
  messageId: string | null,
): void {
  ensureMockTree(session);
  if (messageId !== null && session.transcript.every((message) => message.id !== messageId)) {
    throw new RangeError(`Branch rebase target message does not exist: ${messageId}`);
  }
  session.activeLeafMessageId = messageId;
}

export function switchMockBranch(
  session: MockTranscriptTreeHost,
  targetMessageId: string,
): string {
  ensureMockTree(session);
  if (session.transcript.every((message) => message.id !== targetMessageId)) {
    throw new RangeError(`Branch switch target message does not exist: ${targetMessageId}`);
  }
  const nextLeaf = deepestOfSubtree(session, targetMessageId);
  session.activeLeafMessageId = nextLeaf;
  return nextLeaf;
}

export function truncateMockSubtree(
  session: MockTranscriptTreeHost,
  messageId: string,
): { found: boolean; removedCount: number; remainingCount: number } {
  ensureMockTree(session);
  const parents = session.parentById;
  if (parents === undefined) {
    throw new Error('Mock transcript tree failed to initialize');
  }
  if (session.transcript.every((message) => message.id !== messageId)) {
    return {
      found: false,
      removedCount: 0,
      remainingCount: visibleMockTranscript(session).length,
    };
  }
  const onPath = visibleMockTranscript(session).some((message) => message.id === messageId);
  const parentId = parents[messageId] ?? null;
  const removed = subtreeIds(session, messageId);
  session.transcript = session.transcript.filter((message) => !removed.has(message.id));
  for (const id of removed) {
    delete parents[id];
  }
  if (onPath) {
    session.activeLeafMessageId = parentId;
  }
  return {
    found: true,
    removedCount: removed.size,
    remainingCount: visibleMockTranscript(session).length,
  };
}

export function listMockBranchPoints(
  session: MockTranscriptTreeHost,
  previewChars = MAX_PREVIEW_CHARS,
): TranscriptBranchPoint[] {
  ensureMockTree(session);
  const parents = session.parentById;
  if (parents === undefined) {
    return [];
  }
  const bound = Math.max(1, Math.min(previewChars, 500));
  const path = visibleMockTranscript(session);
  const points: TranscriptBranchPoint[] = [];
  for (const node of path) {
    const parentId = parents[node.id] ?? null;
    const siblings = session.transcript.filter((message) => (parents[message.id] ?? null) === parentId);
    if (siblings.length <= 1) {
      continue;
    }
    points.push({
      anchorMessageId: parentId,
      activeIndex: Math.max(
        0,
        siblings.findIndex((sibling) => sibling.id === node.id),
      ),
      siblings: siblings.map((sibling) => siblingStats(session, sibling, bound)),
    });
  }
  return points;
}

export function copyVisibleMockTranscript(
  session: MockTranscriptTreeHost,
  throughMessageId?: string,
): SessionTranscriptMessage[] {
  const path = visibleMockTranscript(session);
  if (throughMessageId === undefined) {
    return path.map(cloneTranscriptMessage);
  }
  const cut = path.findIndex((message) => message.id === throughMessageId);
  if (cut === -1) {
    return [];
  }
  return path.slice(0, cut + 1).map(cloneTranscriptMessage);
}

function siblingStats(
  session: MockTranscriptTreeHost,
  sibling: SessionTranscriptMessage,
  previewChars: number,
): TranscriptBranchSibling {
  const ids = subtreeIds(session, sibling.id);
  const rows = session.transcript.filter((message) => ids.has(message.id));
  const leaf = session.transcript.find((message) => message.id === deepestOfSubtree(session, sibling.id));
  let updatedAt = sibling.createdAt;
  for (const row of rows) {
    if (row.createdAt > updatedAt) {
      updatedAt = row.createdAt;
    }
  }
  return {
    headMessageId: sibling.id,
    role: sibling.role === 'user' ? 'user' : 'assistant',
    preview: sibling.text.slice(0, previewChars),
    leafPreview: (leaf?.text ?? '').slice(0, previewChars),
    messageCount: rows.length,
    writesWorkspace: rows.some((row) => workspaceWritesFromMessage(row) !== null),
    updatedAt,
  };
}

function subtreeIds(session: MockTranscriptTreeHost, headId: string): Set<string> {
  const parents = session.parentById ?? {};
  const children = new Map<string | null, string[]>();
  for (const message of session.transcript) {
    const parent = parents[message.id] ?? null;
    const list = children.get(parent) ?? [];
    list.push(message.id);
    children.set(parent, list);
  }
  const ids = new Set<string>();
  const stack = [headId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || ids.has(id)) {
      continue;
    }
    ids.add(id);
    for (const child of children.get(id) ?? []) {
      stack.push(child);
    }
  }
  return ids;
}

function deepestOfSubtree(session: MockTranscriptTreeHost, headId: string): string {
  const ids = subtreeIds(session, headId);
  const parents = session.parentById ?? {};
  const index = new Map(session.transcript.map((message, sequence) => [message.id, sequence]));
  let best = headId;
  let bestSequence = index.get(headId) ?? -1;
  for (const id of ids) {
    const hasChild = session.transcript.some((message) => (parents[message.id] ?? null) === id);
    if (hasChild) {
      continue;
    }
    const sequence = index.get(id) ?? -1;
    if (sequence >= bestSequence) {
      best = id;
      bestSequence = sequence;
    }
  }
  return best;
}

function cloneTranscriptMessage(message: SessionTranscriptMessage): SessionTranscriptMessage {
  const next: SessionTranscriptMessage = {
    id: crypto.randomUUID(),
    role: message.role,
    text: message.text,
    createdAt: message.createdAt,
    status: message.status,
  };
  if (message.thinking !== undefined) next.thinking = message.thinking;
  if (message.runId !== undefined) next.runId = message.runId;
  if (message.tools) next.tools = message.tools.map((tool) => ({ ...tool }));
  if (message.attachments) {
    next.attachments = message.attachments.map((attachment) => ({ ...attachment }));
  }
  if (message.contextRefs) next.contextRefs = [...message.contextRefs];
  return next;
}

export function applyMockRetryPrompt(
  session: MockTranscriptTreeHost,
  input: {
    retryUserMessageId: string;
    keepPrevious: boolean;
    confirm: boolean;
  },
):
  | { ok: true; user: SessionTranscriptMessage }
  | { ok: false; error: string; writes?: WorkspaceWrites } {
  const target = session.transcript.find((message) => message.id === input.retryUserMessageId);
  if (target === undefined) {
    return { ok: false, error: `retry-target-not-found: ${input.retryUserMessageId}` };
  }
  if (target.role !== 'user') {
    return { ok: false, error: `retry-target-not-user: ${input.retryUserMessageId}` };
  }
  ensureMockTree(session);
  const path = visibleMockTranscript(session);
  const index = path.findIndex((message) => message.id === target.id);
  if (index === -1) {
    return { ok: false, error: `retry-target-off-path: ${input.retryUserMessageId}` };
  }
  const after = path.slice(index + 1);
  if (!input.keepPrevious) {
    const writes = collectWorkspaceWritesFromMessages(
      after.filter((message) => message.role === 'assistant'),
    );
    if (writes !== null && !input.confirm) {
      return {
        ok: false,
        error: `retry-discards-writes: ${writes.files.join(', ')}`,
        writes,
      };
    }
    const firstChild = after[0];
    if (firstChild !== undefined) {
      truncateMockSubtree(session, firstChild.id);
    }
  }
  rebaseMockLeaf(session, target.id);
  return { ok: true, user: target };
}
