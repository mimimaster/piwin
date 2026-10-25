import type { HostPush, PromptAttachment } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { connectCliAttachedHost, resolveCliHostAttachTarget } from './attach-existing-host.js';
import { createChatOutput, parseOutputFormat } from './chat-output.js';
import { resolveCliChatPrompt } from './chat-prompt.js';
import {
  createCliExtensionSurfacePrinter,
  createCliExtensionUiPushResponder,
} from './extension-ui-cli.js';
import { saveAttachedCliImageAttachment, saveLocalCliImageAttachment } from './cli-prompt-image.js';
import { buildCliContextRefs, collectRefArgs } from './context-ref-args.js';
import { createCliBackendPermissionResponder, parseCliAgent } from './external-agent-cli.js';
import {
  HostRuntime,
  applyHostNetworkProxyFromConfig,
  getPiwinRoot,
  loadPiwinConfig,
} from '@piwin/host-runtime';
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
      token === '--ref' ||
      token === '--agent' ||
      token === '--output-format'
    ) {
      index += 1;
      continue;
    }
    if (token === '--mock' || token.startsWith('--')) {
      continue;
    }
    messageTokens.push(token);
  }
  const message = messageTokens.join(' ').trim();
  const resolvedChatPrompt = resolveCliChatPrompt(message);
  const imagePath = readOption(argv, '--image');
  if (!message && !imagePath) {
    console.error(
      'Usage: piwin chat <text> [--project <path>] [--agent pi|grok] [--mode sdk|rpc] [--mock] [--image <path>] [--permission-mode auto|ask-all|bypass|unrestricted] [--scheme <id>] [--ref <path>…] [--output-format text|json|stream-json]',
    );
    process.exitCode = 1;
    return;
  }

  const attachTarget = await resolveCliHostAttachTarget();
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
  const outputFormat = parseOutputFormat(argv);
  if (typeof outputFormat === 'object') {
    console.error(outputFormat.error);
    process.exitCode = 1;
    return;
  }
  const agent = parseCliAgent(argv);
  if (typeof agent === 'object') {
    console.error(agent.error);
    process.exitCode = 1;
    return;
  }
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
        'Attached to a Host; --project must be a Host projectId, not a local folder.',
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
    const attachedOutput = createChatOutput(outputFormat);
    const attachedWaiting = { printed: false };
    const answerAttachedExtensionUi = createCliExtensionUiPushResponder((command) =>
      client.request(command),
    );
    const printAttachedExtensionSurface = createCliExtensionSurfacePrinter();
    const answerAttachedBackendPermission = createCliBackendPermissionResponder((command) =>
      client.request(command),
    );
    const unsubscribe = client.subscribePush((push) => {
      if (push.type === 'run/terminal') {
        resolveAttachedCompletion?.();
        return;
      }
      if (answerAttachedBackendPermission(push)) return;
      if (printAttachedExtensionSurface(push)) return;
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
      attachedOutput.event(push.event);
    });
    try {
      const createResponse = await client.request(
        {
          type: 'session/create',
          input: {
            ...(projectPath ? { projectId: projectPath } : { scope: { kind: 'general' as const } }),
            ...(agent !== 'pi' ? { agentId: agent } : {}),
          },
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
      attachedOutput.finish({ sessionId, ...(attachedRunId === undefined ? {} : { runId: attachedRunId }) });
      if (attachedOutput.failed && outputFormat !== 'text') process.exitCode = 1;
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
  const output = createChatOutput(outputFormat);
  const localWaiting = { printed: false };
  // `runtime` is assigned before any session exists, so the first push that can
  // carry an Extension UI request always sees it.
  const answerLocalExtensionUi = createCliExtensionUiPushResponder((command) =>
    runtime.handleCommand(command),
  );
  const printLocalExtensionSurface = createCliExtensionSurfacePrinter();
  const answerLocalBackendPermission = createCliBackendPermissionResponder((command) =>
    runtime.handleCommand(command),
  );
  await applyHostNetworkProxyFromConfig();
  const runtime: HostRuntime = new HostRuntime({
    mode,
    mock,
    onPush: (push) => {
      if (push.type === 'run/terminal') {
        resolvePromptCompletion?.();
        return;
      }
      if (answerLocalBackendPermission(push)) return;
      if (printLocalExtensionSurface(push)) return;
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
      output.event(push.event);
    },
    ...(permissionModeOverride !== undefined ? { permissionModeOverride } : {}),
  });

  try {
    const createResponse = await runtime.handleCommand({
      type: 'session/create',
      input: {
        ...(projectPath
          ? { scope: { kind: 'project' as const, projectPath }, projectPath }
          : { scope: { kind: 'general' as const } }),
        ...(agent !== 'pi' ? { agentId: agent } : {}),
      },
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
    output.finish({ sessionId, ...(localRunId === undefined ? {} : { runId: localRunId }) });
    if (output.failed && outputFormat !== 'text') process.exitCode = 1;
  } finally {
    clearTimeout(localPromptTimeout);
    await runtime.dispose();
  }
}
