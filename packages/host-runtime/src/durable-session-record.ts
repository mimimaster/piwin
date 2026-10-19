/**
 * Durable Session index persistence.
 *
 * Creating a product Session writes a SessionIndexRecord. It does not
 * activate a Runtime, take an execution lease, or spawn a Worker.
 */

import { mkdir } from 'node:fs/promises';
import type { ModelRef, SessionIndexRecord, ThinkingLevel } from '@piwin/contracts';
import { createSessionRecord, updateSessionRecord, upsertSessionRecord } from '@piwin/session';
import { getPiwinGeneralWorkspacePath, getPiwinSessionDir } from './paths.js';
import type { SessionLineage } from './host-runtime-types.js';
import { applySubagentLineage, copySubagentLineage } from './session-lineage-apply.js';

export type PersistDurableSessionInput = {
  rootDir: string;
  indexPath: string;
  sessionId: string;
  projectPath: string;
  sessionName?: string;
  lineage?: SessionLineage;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  knowledgeBaseIds?: string[];
  disabledMcpServerIds?: string[];
};

/**
 * Atomically write (or refresh) the SessionIndexRecord and ensure the
 * session directory exists. Throws on write failure so durable create
 * cannot ACK a ghost Session.
 */
export async function persistDurableSessionRecord(
  input: PersistDurableSessionInput,
): Promise<SessionIndexRecord> {
  await mkdir(getPiwinSessionDir(input.rootDir, input.sessionId), { recursive: true });
  // Changed under the index lock, so a rename made meanwhile survives.
  // `updatedAt` is left alone: binding a runtime to an existing session (cold
  // activation, settings rebind) is not conversation activity, and moving it
  // reorders the session list when a session is merely opened.
  const current = await updateSessionRecord(input.indexPath, input.sessionId, (record) => {
    // The name here may have been read before a rename landed (a runtime binds
    // with the record it activated from); a name the person chose or a model
    // title is not ours to put back.
    if (input.sessionName && record.nameSource !== 'user' && record.nameSource !== 'llm') {
      record.name = input.sessionName;
    }
    applyLineageToExisting(record, input.lineage);
    if (input.model) {
      record.model = input.model;
    }
    if (input.thinkingLevel !== undefined) {
      record.thinkingLevel = input.thinkingLevel;
    }
    if (input.knowledgeBaseIds && input.knowledgeBaseIds.length > 0) {
      record.knowledgeBaseIds = input.knowledgeBaseIds;
    }
    if (input.disabledMcpServerIds && input.disabledMcpServerIds.length > 0) {
      record.disabledMcpServerIds = input.disabledMcpServerIds;
    }
  });
  if (current) {
    return current;
  }

  const recordInput: Parameters<typeof createSessionRecord>[0] = {
    id: input.sessionId,
    projectPath: input.projectPath,
  };
  if (input.sessionName) {
    recordInput.name = input.sessionName;
  }
  if (!input.projectPath) {
    recordInput.scope = { kind: 'general' };
    recordInput.workingDirectory = getPiwinGeneralWorkspacePath(input.rootDir);
  } else {
    recordInput.scope = { kind: 'project', projectPath: input.projectPath };
    recordInput.workingDirectory = input.projectPath;
  }
  copyLineageToCreate(recordInput, input.lineage);
  if (input.model) {
    recordInput.model = input.model;
  }
  if (input.thinkingLevel !== undefined) {
    recordInput.thinkingLevel = input.thinkingLevel;
  }
  const record = createSessionRecord(recordInput);
  if (input.knowledgeBaseIds && input.knowledgeBaseIds.length > 0) {
    record.knowledgeBaseIds = input.knowledgeBaseIds;
  }
  if (input.disabledMcpServerIds && input.disabledMcpServerIds.length > 0) {
    record.disabledMcpServerIds = input.disabledMcpServerIds;
  }
  await upsertSessionRecord(input.indexPath, record);
  return record;
}

function applyLineageToExisting(
  current: SessionIndexRecord,
  lineage: SessionLineage | undefined,
): void {
  if (!lineage) {
    return;
  }
  if (lineage.parentSessionId) {
    current.parentSessionId = lineage.parentSessionId;
  }
  if (lineage.kind) {
    current.kind = lineage.kind;
  }
  if (typeof lineage.depth === 'number') {
    current.depth = lineage.depth;
  }
  if (lineage.subagentStatus) {
    current.subagentStatus = lineage.subagentStatus;
  }
  if (lineage.task) {
    current.task = lineage.task;
  }
  if (lineage.presentation) {
    current.presentation = lineage.presentation;
  }
  applySubagentLineage(current, lineage);
}

function copyLineageToCreate(
  recordInput: Parameters<typeof createSessionRecord>[0],
  lineage: SessionLineage | undefined,
): void {
  if (!lineage) {
    return;
  }
  if (lineage.parentSessionId) {
    recordInput.parentSessionId = lineage.parentSessionId;
  }
  if (lineage.kind) {
    recordInput.kind = lineage.kind;
  }
  if (typeof lineage.depth === 'number') {
    recordInput.depth = lineage.depth;
  }
  if (lineage.subagentStatus) {
    recordInput.subagentStatus = lineage.subagentStatus;
  }
  if (lineage.task) {
    recordInput.task = lineage.task;
  }
  if (lineage.presentation) {
    recordInput.presentation = lineage.presentation;
  }
  copySubagentLineage(recordInput, lineage);
}
