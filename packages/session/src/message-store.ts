/**
 * Persist product chat transcripts under ~/.piwin/sessions/<id>/transcript.json.
 * Independent of Pi session JSONL; enables UI hydration after process restart.
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  MediaAttachmentRef,
  SessionScope,
  SessionTranscriptDocument,
  SessionTranscriptMessage,
  SessionToolCardView,
} from '@piwin/contracts';

function nowIso(): string {
  return new Date().toISOString();
}

function emptyDoc(
  sessionId: string,
  projectPath: string,
  scope?: SessionScope,
  workingDirectory?: string,
): SessionTranscriptDocument {
  const doc: SessionTranscriptDocument = {
    version: 1,
    sessionId,
    projectPath,
    messages: [],
    updatedAt: nowIso(),
  };
  if (scope) {
    doc.scope = scope;
  }
  if (workingDirectory) {
    doc.workingDirectory = workingDirectory;
  }
  return doc;
}

export async function loadSessionTranscript(
  filePath: string,
): Promise<SessionTranscriptDocument | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    if (!raw.trim()) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.sessionId !== 'string') return null;
    const messages = Array.isArray(record.messages)
      ? record.messages.filter(isTranscriptMessage)
      : [];
    const document: SessionTranscriptDocument = {
      version: 1,
      sessionId: record.sessionId,
      projectPath: typeof record.projectPath === 'string' ? record.projectPath : '',
      messages,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : nowIso(),
    };
    if (record.scope && typeof record.scope === 'object') {
      document.scope = record.scope as SessionScope;
    }
    if (typeof record.workingDirectory === 'string') {
      document.workingDirectory = record.workingDirectory;
    }
    return document;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function saveSessionTranscript(
  filePath: string,
  document: SessionTranscriptDocument,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  // Compact JSON: pretty-print bloats multi-MB tool-heavy transcripts and slows
  // every session/resume parse. Human debugging can pretty-print on demand.
  await writeFile(filePath, `${JSON.stringify(document)}\n`, 'utf8');
}

/**
 * Persist a transcript through a same-directory temporary file so readers
 * never observe a partially written JSON document during a stream flush.
 */
export async function saveSessionTranscriptAtomic(
  filePath: string,
  document: SessionTranscriptDocument,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(document)}\n`, 'utf8');
    await rename(temporaryPath, filePath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
      // Preserve the original write/rename error.
    }
    throw error;
  }
}

export async function ensureSessionTranscript(
  filePath: string,
  sessionId: string,
  projectPath: string,
  scope?: SessionScope,
  workingDirectory?: string,
): Promise<SessionTranscriptDocument> {
  const existing = await loadSessionTranscript(filePath);
  if (existing) {
    if (!existing.projectPath && projectPath) {
      existing.projectPath = projectPath;
      await saveSessionTranscript(filePath, existing);
    }
    return existing;
  }
  const created = emptyDoc(sessionId, projectPath, scope, workingDirectory);
  await saveSessionTranscript(filePath, created);
  return created;
}

export async function appendTranscriptMessage(
  filePath: string,
  sessionId: string,
  projectPath: string,
  message: SessionTranscriptMessage,
  scope?: SessionScope,
  workingDirectory?: string,
): Promise<SessionTranscriptDocument> {
  const document = await ensureSessionTranscript(filePath, sessionId, projectPath, scope, workingDirectory);
  const existingIndex = document.messages.findIndex((item) => item.id === message.id);
  if (existingIndex === -1) {
    document.messages.push(message);
  } else {
    document.messages[existingIndex] = message;
  }
  document.updatedAt = nowIso();
  await saveSessionTranscript(filePath, document);
  return document;
}

export async function patchTranscriptMessage(
  filePath: string,
  sessionId: string,
  projectPath: string,
  messageId: string,
  patch: Partial<SessionTranscriptMessage>,
): Promise<SessionTranscriptDocument | null> {
  const document = await ensureSessionTranscript(filePath, sessionId, projectPath);
  const index = document.messages.findIndex((item) => item.id === messageId);
  if (index === -1) {
    return null;
  }
  const current = document.messages[index]!;
  const next: SessionTranscriptMessage = {
    ...current,
    ...patch,
    id: current.id,
    role: patch.role ?? current.role,
    text: patch.text ?? current.text,
    createdAt: current.createdAt,
    status: patch.status ?? current.status,
  };
  document.messages[index] = next;
  document.updatedAt = nowIso();
  await saveSessionTranscript(filePath, document);
  return document;
}

export async function listTranscriptMessages(
  filePath: string,
): Promise<SessionTranscriptMessage[]> {
  const document = await loadSessionTranscript(filePath);
  return document?.messages ?? [];
}

export function createUserTranscriptMessage(input: {
  id: string;
  text: string;
  attachments?: MediaAttachmentRef[];
  source?: SessionTranscriptMessage['source'];
  voiceCallId?: string;
  skillId?: string;
}): SessionTranscriptMessage {
  const message: SessionTranscriptMessage = {
    id: input.id,
    role: 'user',
    text: input.text,
    createdAt: nowIso(),
    status: 'done',
  };
  if (input.attachments && input.attachments.length > 0) {
    message.attachments = input.attachments;
  }
  if (input.source !== undefined) message.source = input.source;
  if (input.voiceCallId !== undefined) message.voiceCallId = input.voiceCallId;
  if (input.skillId !== undefined) message.skillId = input.skillId;
  return message;
}

export function createAssistantTranscriptMessage(input: {
  id: string;
  runtimeGenerationId?: string;
}): SessionTranscriptMessage {
  const message: SessionTranscriptMessage = {
    id: input.id,
    role: 'assistant',
    text: '',
    createdAt: nowIso(),
    status: 'streaming',
    thinking: '',
    tools: [],
  };
  if (input.runtimeGenerationId !== undefined) {
    message.runtimeGenerationId = input.runtimeGenerationId;
  }
  return message;
}

export function appendToolCard(
  tools: SessionToolCardView[] | undefined,
  card: SessionToolCardView,
): SessionToolCardView[] {
  return [...(tools ?? []), card];
}


export async function truncateTranscriptFrom(
  filePath: string,
  messageId: string,
): Promise<{
  found: boolean;
  removedCount: number;
  remainingCount: number;
  document: SessionTranscriptDocument | null;
}> {
  const document = await loadSessionTranscript(filePath);
  if (!document) {
    return { found: false, removedCount: 0, remainingCount: 0, document: null };
  }
  const cutIndex = document.messages.findIndex((item) => item.id === messageId);
  if (cutIndex === -1) {
    return {
      found: false,
      removedCount: 0,
      remainingCount: document.messages.length,
      document,
    };
  }
  const removedCount = document.messages.length - cutIndex;
  document.messages = document.messages.slice(0, cutIndex);
  document.updatedAt = nowIso();
  await saveSessionTranscript(filePath, document);
  return {
    found: true,
    removedCount,
    remainingCount: document.messages.length,
    document,
  };
}

function isTranscriptMessage(value: unknown): value is SessionTranscriptMessage {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.role === 'string' &&
    typeof record.text === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.status === 'string'
  );
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT',
  );
}
