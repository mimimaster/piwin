/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { join } from 'node:path';
import type { CreateSessionInput, CreateSessionOptions, SessionHandle } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';

import {
  createSessionRecord,
  deriveDefaultNameFromMessage,
  isPlaceholderSessionName,
  getSessionRecord,
  setSessionAutoName,
  upsertSessionRecord,
} from '@piwin/session';
import { createTestFixtureSession } from './delayed-session-fixture.js';
import { createProductSessionId, createRuntimeGenerationId } from './product-agent-host.js';
import { loadPiwinConfig } from './config-store.js';
import { maybeAutoNameSession } from './session-naming-service.js';
import { createSecretResolver } from './secret-resolver.js';
import { getEnabledProviders } from './provider-helpers.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';
import { ok } from './response-helpers.js';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';

export async function resolveAutoCompaction(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<{
  enabled: boolean;
  source: 'session' | 'global' | 'unknown';
  globalDefault: boolean;
}> {
  const config = await loadPiwinConfig(getPiwinRoot(deps.options.piwinRoot));
  const globalDefault = config.compaction?.autoEnabledDefault !== false;
  if (deps.sessionAutoCompactionOverrides.has(sessionId)) {
    return {
      enabled: Boolean(deps.sessionAutoCompactionOverrides.get(sessionId)),
      source: 'session',
      globalDefault,
    };
  }
  return { enabled: globalDefault, source: 'global', globalDefault };
}

export async function applyAutoCompactionToSession(
  deps: HostRuntimeKernel,
  session: SessionHandle,
): Promise<void> {
  if (!session.setAutoCompactionEnabled) {
    return;
  }
  const resolved = await deps.resolveAutoCompaction(session.id);
  await session.setAutoCompactionEnabled(resolved.enabled);
}

/**
 * Plan execution seam: send a prompt to a session for inline execution
 * or final verification. Uses the existing session/prompt path.
 */
export async function promptPlanSession(
  deps: HostRuntimeKernel,
  sessionId: string,
  text: string,
  parentRunId?: string,
): Promise<{ runId: string; finalAssistantMessageId: string }> {
  const operation = () =>
    deps.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text },
    });
  const result = parentRunId
    ? await deps.runExecutionContext.run(parentRunId, operation)
    : await operation();
  if (!result.success) {
    throw new Error(result.error);
  }
  const data = result.data as { runId?: unknown };
  if (typeof data.runId !== 'string') {
    throw new Error('session/prompt accepted without a Run id');
  }
  const terminal = await deps.runRegistry.join(data.runId);
  if (!terminal) {
    throw new Error(`foreground Run disappeared: ${data.runId}`);
  }
  if (terminal.status !== 'completed') {
    throw new Error(terminal.error ?? `foreground Run ${data.runId} ended with ${terminal.status}`);
  }
  const recorder = deps.transcriptRecorders.get(sessionId);
  if (recorder) {
    await recorder.flush();
  }
  const messages = await deps.loadTranscriptMessages(sessionId);
  const finalAssistant = [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === 'assistant' && message.runId === data.runId && message.status === 'done',
    );
  if (!finalAssistant) {
    throw new Error(`foreground Run ${data.runId} completed without a durable assistant message`);
  }
  return { runId: data.runId, finalAssistantMessageId: finalAssistant.id };
}

/**
 * Plan execution seam: abort a running session (parent or child).
 */
export async function abortPlanSession(deps: HostRuntimeKernel, sessionId: string): Promise<void> {
  await deps.handleCommand({
    type: 'session/abort',
    sessionId,
  });
}

export async function touchSession(
  deps: HostRuntimeKernel,
  sessionId: string,
  preview: string,
): Promise<void> {
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const current = await getSessionRecord(indexPath, sessionId);
  if (current) {
    current.updatedAt = new Date().toISOString();
    current.messageCount += 1;
    current.lastPreview = preview.slice(0, 160);
    await upsertSessionRecord(indexPath, current);
    return;
  }
  const projectPath = deps.sessionProjects.get(sessionId) ?? 'unknown';
  const record = createSessionRecord({
    id: sessionId,
    projectPath,
    // Leave unnamed; first-prompt text naming fills the list title.
  });
  record.messageCount = 1;
  record.lastPreview = preview.slice(0, 160);
  await upsertSessionRecord(indexPath, record);
}

/**
 * Naming pipeline step 1 (immediate): first user message → truncated text
 * title so the session becomes listable without waiting on the model.
 * Step 2 (LLM upgrade) runs from maybeTriggerAutoName after completed turns.
 */
export async function maybeAssignTextNameFromPrompt(
  deps: HostRuntimeKernel,
  sessionId: string,
  text: string,
): Promise<void> {
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const record = await getSessionRecord(indexPath, sessionId);
  if (!record) {
    return;
  }
  // Duplicate titles explain that this is a standalone copy and remain stable
  // until the user explicitly renames the session.
  if (record.origin?.kind === 'duplicate') {
    return;
  }
  // Never overwrite user renames, LLM titles, prior text names, or legacy auto.
  if (
    record.nameSource === 'user' ||
    record.nameSource === 'llm' ||
    record.nameSource === 'text' ||
    (record.nameSource as string | undefined) === 'auto'
  ) {
    return;
  }
  if (!isPlaceholderSessionName(record.name)) {
    return;
  }
  const interimName = deriveDefaultNameFromMessage(text);
  if (!interimName) {
    return;
  }
  const updated = await setSessionAutoName(indexPath, sessionId, interimName, 'text');
  if (updated) {
    deps.push({
      type: 'session/name-updated',
      sessionId,
      name: updated.name ?? interimName,
      nameSource: 'text',
    });
  }
}

/**
 * CE-NAME: auto-name after each completed exchange until a terminal name
 * (`llm` or `user`) lands.
 */
export async function maybeTriggerAutoName(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<void> {
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const record = await getSessionRecord(indexPath, sessionId);
  if (!record) {
    return;
  }
  // messageCount counts completed runs (touchSession += 1 per run), so a
  // value >= 1 means at least one exchange is finished. We attempt naming on
  // every completed exchange; a failure leaves nameSource as 'default', so
  // the next exchange retries until naming succeeds.
  // `user` (manual) and `llm` (generated) names are terminal for auto-naming.
  // A `text` fallback may still be upgraded to an LLM title on a later
  // completed exchange. messageCount is best-effort (touchSession); still
  // attempt when the session is only text-named so a failed touch cannot
  // block the model title forever.
  if (record.nameSource === 'user' || record.nameSource === 'llm') {
    return;
  }
  if (record.messageCount < 1 && record.nameSource !== 'text') {
    return;
  }
  // Read the transcript instead of in-memory maps: the maps drift when the
  // first exchange fails to name (a later retry would see a later prompt
  // instead of the first user message) and are empty after a host restart.
  const store = await deps.getTranscriptStore(sessionId);
  const firstUserMessage = await store.firstMessageByRole('user');
  if (!firstUserMessage?.text) {
    return;
  }
  const lastAssistantMessage = await store.lastMessageByRole('assistant');
  const assistantReply = lastAssistantMessage?.text ?? '';
  // Prefer the model snapshot from the transcript; fall back to the last
  // prompt's model for legacy transcripts that omit it.
  const modelRef = lastAssistantMessage?.model ?? deps.sessionModels.get(sessionId);
  const config = await loadPiwinConfig(rootDir);
  await maybeAutoNameSession({
    piwinRoot: deps.options.piwinRoot ?? rootDir,
    sessionId,
    firstMessage: firstUserMessage.text,
    ...(assistantReply ? { assistantReply } : {}),
    ...(modelRef ? { modelRef } : {}),
    providers: getEnabledProviders(config),
    secretResolver: createSecretResolver(),
    push: (message) => deps.push(message),
  });
}

export function requireSession(deps: HostRuntimeKernel, sessionId: string): SessionHandle {
  const session = deps.sessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }
  return session;
}

/**
 * Validate product-session ownership without waking a Pi runtime. Media
 * uploads may arrive while a session is cold; the next prompt owns runtime
 * activation and must not be blocked by attachment persistence.
 */
export async function requireDurableSession(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<void> {
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const record = await getSessionRecord(getPiwinSessionIndexPath(rootDir), sessionId);
  if (!record) {
    throw new Error(`Unknown session: ${sessionId}`);
  }
  if (record.isArchived === true) {
    throw new Error(`Archived session cannot receive attachments: ${sessionId}`);
  }
}

export async function createSession(
  deps: HostRuntimeKernel,
  input: CreateSessionInput,
  options: CreateSessionOptions = {},
): Promise<SessionHandle> {
  if (deps.options.testFixture !== undefined) {
    return createTestFixtureSession(deps.options.testFixture, {
      ...(input.projectPath ? { projectPath: input.projectPath } : {}),
    });
  }
  // Mock hosts expose no `browser_*` tools. Real hosts need the passive
  // BrowserSession service registered before the Pi session so the tools
  // appear; creating/subscribing it does not launch Chromium (ADR 0020).
  // Best-effort: service initialization failure must not block session
  // creation — the tools simply will not appear.
  if (deps.options.mock !== true) {
    try {
      await deps.ensureBrowserSession();
    } catch (error) {
      const detail = formatError(error);
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `browser session init failed: ${detail}`,
      });
    }
  }
  const sessionId = createProductSessionId();
  const runtimeGenerationId = createRuntimeGenerationId();
  await deps.refreshWorkerRssSample();
  const admission = await deps.residencyController.beginActivation(
    sessionId,
    runtimeGenerationId,
    new AbortController().signal,
  );
  if (!admission.ok) {
    const error = new Error(
      admission.code === 'memory-pressure'
        ? `runtime-memory-pressure: ${admission.message}`
        : `activation aborted: ${admission.message}`,
    );
    (error as { code?: string }).code =
      admission.code === 'memory-pressure' ? 'runtime-memory-pressure' : admission.code;
    throw error;
  }
  deps.pendingDirectActivations.set(sessionId, runtimeGenerationId);
  try {
    // Direct create and cold activation share the same stable-identity
    // backend path. The reservation remains `activating` until bindSession
    // has installed the recorder/subscription and publishes the handle.
    // Lease registration waits for bindSession success so a failed bind
    // cannot leave a foreign Host thinking this session is live.
    return await deps.host.activateSession(sessionId, input, runtimeGenerationId, options);
  } catch (error) {
    deps.pendingDirectActivations.delete(sessionId);
    deps.residencyController.abortActivation(sessionId, runtimeGenerationId);
    await deps.host.dropSession(sessionId).catch(() => undefined);
    throw error;
  }
}
