import type { AgentEvent, HostPush, PromptAttachment } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { connectCliAttachedHost, readCliHostAttachTarget } from './attach-existing-host.js';
import { resolveCliChatPrompt } from './chat-prompt.js';
import { formatCliAgentErrorEvent } from './cli-agent-error.js';
import { createCliExtensionUiPushResponder } from './extension-ui-cli.js';
import { saveAttachedCliImageAttachment, saveLocalCliImageAttachment } from './cli-prompt-image.js';
import { buildCliContextRefs, collectRefArgs } from './context-ref-args.js';
import { formatCliFlashcardToolResult } from './flashcard-tool-result.js';
import { HostRuntime, getPiwinRoot, loadPiwinConfig } from '@piwin/host-runtime';
import { randomUUID } from 'node:crypto';
import {
  parseMock,
  parseMode,
  parseOptionalProject,
  readOption,
  resolvePermissionModeOverride,
} from './cli-args.js';

/**
 * `piwin chat` subcommand: argv handling, host lifecycle, and output.
 */

export function createAssistantCliDisplay() {
  let thinkingBuffer = '';
  let sawTextDelta = false;
  let composingAnnounced = false;

  return {
    /** Process one AgentEvent, return the string to write (or null for no-op). */
    feed(event: AgentEvent): string | null {
      switch (event.type) {
        case 'message/text_delta':
          // Flush any buffered thinking block before text starts
          if (thinkingBuffer) {
            const block = `\n[thinking]\n${thinkingBuffer.trimEnd()}\n[/thinking]\n`;
            thinkingBuffer = '';
            sawTextDelta = true;
            return block + event.delta;
          }
          sawTextDelta = true;
          return event.delta;

        case 'message/text_snapshot':
          // Snapshot is a full cumulative replacement; only emit if we never
          // streamed deltas for this message (otherwise it would duplicate).
          if (sawTextDelta) return null;
          return event.text;

        case 'message/thinking_delta':
          thinkingBuffer += event.delta;
          return null; // buffer until text starts or message ends

        case 'message/start':
          sawTextDelta = false;
          composingAnnounced = false;
          return '\n';

        case 'message/tool_args_progress':
          if (composingAnnounced) return null;
          composingAnnounced = true;
          return event.toolName ? `\n[composing:${event.toolName}]` : '\n[composing]';

        case 'message/end': {
          // Flush remaining thinking buffer
          let out = '';
          if (thinkingBuffer) {
            out = `\n[thinking]\n${thinkingBuffer.trimEnd()}\n[/thinking]\n`;
            thinkingBuffer = '';
          }
          sawTextDelta = false;
          return out || null;
        }

        case 'tool/start':
          return `\n[tool:${event.toolName}]`;

        case 'tool/update':
          if (!event.delta) return null;
          return event.delta;

        case 'tool/end':
          if (event.isError) {
            return `\n[tool:error] ${event.toolCallId}\n`;
          }
          {
            const flashcardText = formatCliFlashcardToolResult(event.presentation);
            if (flashcardText) return `\n${flashcardText}\n`;
          }
          return '\n';

        case 'error':
          return formatCliAgentErrorEvent(event);

        case 'permission/request':
          return `\n[permission ${event.defaultDecision}] ${event.action}: ${event.detail}\n`;

        case 'usage/update': {
          const usage = event.usage;
          const used = usage.tokensUsed ?? usage.totalTokens;
          const limit = usage.tokensLimit;
          if (typeof used === 'number' && typeof limit === 'number') {
            return `\n[usage] ${used}/${limit} tokens\n`;
          }
          if (typeof used === 'number') {
            return `\n[usage] ${used} tokens\n`;
          }
          return `\n[usage] unknown\n`;
        }

        default:
          return null;
      }
    },
  };
}

export function printCliWaitingResource(push: HostPush, seen: { printed: boolean }): void {
  if (seen.printed || push.type !== 'run/updated' || push.run.phase !== 'waiting-resource') {
    return;
  }
  seen.printed = true;
  const reason =
    push.run.phaseDetail === 'execution-slot'
      ? 'waiting for an execution slot'
      : 'waiting for runtime capacity';
  console.error(`[run] ${push.run.runId} ${reason}`);
}

export async function commandChat(argv: string[]): Promise<void> {
  const args = argv.slice(1);
  const messageTokens: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) continue;
    if (
      token === '--project' ||
      token === '--mode' ||
      token === '--image' ||
      token === '--permission-mode' ||
      token === '--scheme' ||
      token === '--ref'
    ) {
      index += 1;
      continue;
    }
    if (token === '--mock' || token.startsWith('--')) {
      continue;
    }
    messageTokens.push(token);
  }
  let message = messageTokens.join(' ').trim();
  const resolvedChatPrompt = resolveCliChatPrompt(message);
  const imagePath = readOption(argv, '--image');
  if (!message && !imagePath) {
    console.error(
      'Usage: piwin chat <text> [--project <path>] [--mode sdk|rpc] [--mock] [--image <path>] [--permission-mode auto|ask-all|bypass] [--scheme <id>] [--ref <path>…]',
    );
    process.exitCode = 1;
    return;
  }

  const attachTarget = readCliHostAttachTarget();
  const attachments: PromptAttachment[] = [];
  if (imagePath && !attachTarget) {
    const saved = await saveLocalCliImageAttachment(imagePath);
    attachments.push(saved.attachment);
    console.error(`[media] saved ${saved.logPath}`);
    const config = await loadPiwinConfig(getPiwinRoot());
    const defaultProvider = config.providers.find((item) => item.id === config.defaultProviderId);
    const defaultModel = defaultProvider?.models.find((item) => item.id === config.defaultModelId);
    const supportsImage = defaultModel?.input?.includes('image') === true;
    if (!supportsImage) {
      if (config.visionDelegation?.enabled && config.visionDelegation.model) {
        console.error(
          `[media] default model is text-only; vision delegation will describe the image via ${config.visionDelegation.model.providerId}/${config.visionDelegation.model.modelId}`,
        );
      } else {
        console.error(
          '[media] default model is text-only (or input unset); host will path-inject the image. Mark model input as image or enable visionDelegation for descriptions.',
        );
      }
    }
  }

  const projectPath = parseOptionalProject(argv);
  const mock = parseMock(argv);
  const mode = parseMode(argv);
  const permissionModeOverride = resolvePermissionModeOverride(argv);
  if (mode === 'rpc' && !mock) {
    console.error(
      'piwin chat --mode rpc: stock Pi RPC does not support piwin custom tools ' +
        '(web/MCP/bash). Use default --mode sdk, or --mode rpc --mock for offline smoke. ' +
        'See ADR 0008 / host status capabilities.customTools.',
    );
    process.exitCode = 1;
    return;
  }
  if (attachTarget) {
    if (projectPath && !/^project-[a-f0-9]{24}$/.test(projectPath)) {
      console.error(
        'PIWIN_HOST_URL is set; --project must be a Host projectId, not a local folder.',
      );
      process.exitCode = 1;
      return;
    }
    const client = await connectCliAttachedHost(attachTarget);
    let resolveAttachedCompletion: (() => void) | undefined;
    let rejectAttachedCompletion: ((error: Error) => void) | undefined;
    const attachedCompletion = new Promise<void>((resolve, reject) => {
      resolveAttachedCompletion = resolve;
      rejectAttachedCompletion = reject;
    });
    const attachedPromptTimeoutMs = 10 * 60 * 1000;
    const attachedTimeout = setTimeout(() => {
      rejectAttachedCompletion?.(
        new Error(
          `Attached Host prompt timed out after ${attachedPromptTimeoutMs}ms waiting for run/terminal`,
        ),
      );
    }, attachedPromptTimeoutMs);
    const attachedDisplay = createAssistantCliDisplay();
    const attachedWaiting = { printed: false };
    const answerAttachedExtensionUi = createCliExtensionUiPushResponder((command) =>
      client.request(command),
    );
    const unsubscribe = client.subscribePush((push) => {
      if (push.type === 'run/terminal') {
        resolveAttachedCompletion?.();
        return;
      }
      if (push.type === 'extension/ui_request') {
        answerAttachedExtensionUi(push).catch((error: unknown) => {
          console.error(`[extension-ui] ${formatError(error)}`);
        });
        return;
      }
      printCliWaitingResource(push, attachedWaiting);
      if (push.type !== 'event') {
        return;
      }
      const line = attachedDisplay.feed(push.event);
      if (line !== null) {
        process.stdout.write(line);
      }
    });
    try {
      const createResponse = await client.request(
        {
          type: 'session/create',
          input: projectPath ? { projectId: projectPath } : { scope: { kind: 'general' } },
        },
        { idempotencyKey: randomUUID() },
      );
      if (!createResponse.success) {
        throw new Error(createResponse.error);
      }
      const sessionId = (createResponse.data as { sessionId: string }).sessionId;
      console.error(`session ${sessionId}`);
      if (imagePath) {
        const saved = await saveAttachedCliImageAttachment({
          request: (command) => client.request(command),
          sessionId,
          imagePath,
        });
        attachments.push(saved.attachment);
        console.error(`[media] saved ${saved.logPath}`);
      }
      const schemeId = readOption(argv, '--scheme')?.trim();
      const refArgs = collectRefArgs(argv);
      const refsResult =
        refArgs.length > 0 ? await buildCliContextRefs(projectPath, refArgs) : null;
      if (refsResult && !refsResult.ok) {
        console.error(`[ref] ${refsResult.reason}`);
        process.exitCode = 1;
        return;
      }
      const promptResponse = await client.request(
        {
          type: 'session/prompt',
          sessionId,
          input: {
            text: resolvedChatPrompt.text,
            ...(resolvedChatPrompt.skillId ? { skillId: resolvedChatPrompt.skillId } : {}),
            ...(attachments.length > 0 ? { attachments } : {}),
            ...(refsResult && refsResult.ok && refsResult.refs.length > 0
              ? { contextRefs: refsResult.refs }
              : {}),
            ...(schemeId && schemeId !== 'off' ? { orchestrationSchemeId: schemeId } : {}),
          },
          foreground: { kind: 'if-idle' },
        },
        { idempotencyKey: randomUUID() },
      );
      if (!promptResponse.success) {
        throw new Error(promptResponse.error);
      }
      const attachedRunId = (promptResponse.data as { runId?: string } | undefined)?.runId;
      if (typeof attachedRunId === 'string') {
        console.error(`run ${attachedRunId}`);
      }
      await attachedCompletion;
      process.stdout.write('\n');
    } finally {
      clearTimeout(attachedTimeout);
      unsubscribe();
      await client.close();
    }
    return;
  }

  let resolvePromptCompletion: (() => void) | undefined;
  let rejectPromptCompletion: ((error: Error) => void) | undefined;
  const promptCompletion = new Promise<void>((resolve, reject) => {
    resolvePromptCompletion = resolve;
    rejectPromptCompletion = reject;
  });
  const localPromptTimeoutMs = 10 * 60 * 1000;
  const localPromptTimeout = setTimeout(() => {
    rejectPromptCompletion?.(
      new Error(
        `Local Host prompt timed out after ${localPromptTimeoutMs}ms waiting for run/terminal`,
      ),
    );
  }, localPromptTimeoutMs);
  const display = createAssistantCliDisplay();
  const localWaiting = { printed: false };
  // `runtime` is assigned before any session exists, so the first push that can
  // carry an Extension UI request always sees it.
  const answerLocalExtensionUi = createCliExtensionUiPushResponder((command) =>
    runtime.handleCommand(command),
  );
  const runtime: HostRuntime = new HostRuntime({
    mode,
    mock,
    onPush: (push) => {
      if (push.type === 'run/terminal') {
        resolvePromptCompletion?.();
        return;
      }
      if (push.type === 'extension/ui_request') {
        answerLocalExtensionUi(push).catch((error: unknown) => {
          console.error(`[extension-ui] ${formatError(error)}`);
        });
        return;
      }
      printCliWaitingResource(push, localWaiting);
      if (push.type !== 'event') {
        return;
      }
      const line = display.feed(push.event);
      if (line !== null) {
        process.stdout.write(line);
      }
    },
    ...(permissionModeOverride !== undefined ? { permissionModeOverride } : {}),
  });

  try {
    const createResponse = await runtime.handleCommand({
      type: 'session/create',
      input: projectPath
        ? { scope: { kind: 'project', projectPath }, projectPath }
        : { scope: { kind: 'general' } },
    });
    if (!createResponse.success) {
      throw new Error(createResponse.error);
    }
    const sessionId = (createResponse.data as { sessionId: string }).sessionId;
    console.error(`session ${sessionId}`);
    const schemeId = readOption(argv, '--scheme')?.trim();
    // CM-18: `--ref <path>` (repeatable) maps to structured context refs.
    const refArgs = collectRefArgs(argv);
    const refsResult = refArgs.length > 0 ? await buildCliContextRefs(projectPath, refArgs) : null;
    if (refsResult && !refsResult.ok) {
      console.error(`[ref] ${refsResult.reason}`);
      process.exitCode = 1;
      return;
    }
    const promptResponse = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: {
        text: resolvedChatPrompt.text,
        ...(resolvedChatPrompt.skillId ? { skillId: resolvedChatPrompt.skillId } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(refsResult && refsResult.ok && refsResult.refs.length > 0
          ? { contextRefs: refsResult.refs }
          : {}),
        ...(schemeId && schemeId !== 'off' ? { orchestrationSchemeId: schemeId } : {}),
      },
    });
    if (!promptResponse.success) {
      throw new Error(promptResponse.error);
    }
    const localRunId = (promptResponse.data as { runId?: string } | undefined)?.runId;
    if (typeof localRunId === 'string') {
      console.error(`run ${localRunId}`);
    }
    await promptCompletion;
    process.stdout.write('\n');
  } finally {
    clearTimeout(localPromptTimeout);
    await runtime.dispose();
  }
}
