/**
 * Legacy backfill for generated-media receipts written before the adapter
 * protocol existed (ADR 0082 §媒体历史迁移).
 *
 * New sessions import media when the adapter emits its proposal, so this only
 * recognises tools that already ran: the image/video tool name, and either a
 * relative path the adapter left in the presentation or a native link in the
 * following text. Everything it imports goes through the same manifest-driven
 * resolver as live imports.
 */
import { type AgentPluginOutputDirectory, type HostPush, type SessionIndexRecord, type SessionTranscriptMessage } from '@piwin/contracts';
import type { SessionTranscriptStore } from '@piwin/session';
import { bindOrphanGeneratedMediaToStore } from '../bind-orphan-generated-media.js';
import { getPiwinRoot } from '../paths.js';
import { importAgentPluginMedia } from '../agent-plugin-media.js';
import { requireExtensionBackendLaunch } from '../extension-session-backends.js';
import { workingDirectoryFromIndexRecord } from '../session-scope.js';

/** Tool name to the media kind it produces. Recognition only, never execution. */
const GENERATED_MEDIA_TOOLS: Readonly<Record<string, 'image' | 'video'>> = {
  image_gen: 'image',
  video_gen: 'video',
};

export async function bindGeneratedMediaToStore(input: {
  store: SessionTranscriptStore; sessionMediaDir: string;
  messages: readonly SessionTranscriptMessage[]; record?: SessionIndexRecord;
  piwinRoot?: string; push: (push: HostPush) => void;
}): Promise<SessionTranscriptMessage[]> {
  const binding = input.record?.backend;
  if (input.record === undefined || binding === undefined) {
    return bindOrphanGeneratedMediaToStore(input);
  }
  let outputDirectories: readonly AgentPluginOutputDirectory[];
  try {
    outputDirectories = (await requireExtensionBackendLaunch(getPiwinRoot(input.piwinRoot), binding.agentId)).outputDirectories;
  } catch {
    // No launchable adapter (legacy v1 install): nothing can be resolved safely.
    return bindOrphanGeneratedMediaToStore(input);
  }
  const cwd = workingDirectoryFromIndexRecord(input.record, input.piwinRoot);
  const backendSessionId = binding.backendSessionId ?? '';
  const next: SessionTranscriptMessage[] = [];
  for (let messageIndex = 0; messageIndex < input.messages.length; messageIndex += 1) {
    const message = input.messages[messageIndex];
    if (message === undefined) continue;
    if (message.role !== 'assistant') {
      next.push(message); continue;
    }
    const attachments = [...(message.attachments ?? [])];
    const tools = [];
    let changed = false;
    for (const tool of message.tools ?? []) {
      const kind = GENERATED_MEDIA_TOOLS[tool.toolName];
      if (tool.status !== 'done' || kind === undefined) {
        tools.push(tool); continue;
      }
      const directory = outputDirectories.find((entry) => entry.kind === kind);
      const relativePath = directory === undefined
        ? undefined
        : (relativeTarget(tool.presentation?.targetPaths?.[0], directory.id)
          ?? findNativeMediaLink(input.messages, messageIndex, kind === 'video' ? 'videos' : 'images'));
      if (directory === undefined || relativePath === undefined) {
        tools.push(tool); continue;
      }
      const asset = await importAgentPluginMedia({
        proposal: {
          directoryId: directory.id,
          relativePath,
          kind,
          importKey: `agent:${binding.agentId}:${backendSessionId}:${relativePath}`,
        },
        context: { agentId: binding.agentId, sessionId: input.record.id, backendSessionId, cwd, outputDirectories },
        push: input.push,
        ...(input.piwinRoot ? { piwinRoot: input.piwinRoot } : {}),
      });
      if (asset === undefined) {
        tools.push(tool); continue;
      }
      tools.push(
        tool.presentation !== undefined
          ? { ...tool, presentation: { ...tool.presentation, targetPaths: [relativePath] } }
          : tool,
      );
      if (!attachments.some((item) => item.id === asset.id)) {
        attachments.push({
          id: asset.id, kind: 'media', path: asset.absolutePath, mimeType: asset.mimeType,
          byteSize: asset.byteSize, source: 'generated',
          ...(kind === 'image' ? { contentKind: 'image' } : {}),
        });
        changed = true;
      }
    }
    const updated = changed ? { ...message, tools, attachments } : message;
    if (changed) await input.store.updateMessage(message.id, { tools, attachments });
    next.push(updated);
  }
  return bindOrphanGeneratedMediaToStore({ ...input, messages: next });
}

/** A presentation path is only usable when the adapter already made it relative. */
function relativeTarget(path: string | undefined, directoryId: string): string | undefined {
  if (path === undefined || path.startsWith('/') || path.includes('..')) return undefined;
  if (!path.includes('/')) return path;
  return path.startsWith(`${directoryId}/`) ? path.slice(directoryId.length + 1) : undefined;
}

function findNativeMediaLink(
  messages: readonly SessionTranscriptMessage[],
  toolMessageIndex: number,
  directory: 'images' | 'videos',
): string | undefined {
  const pattern = new RegExp(`(?:^|[\\s([】])${directory}/([A-Za-z0-9][A-Za-z0-9._-]*)`, 'gu');
  for (let index = toolMessageIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role === 'user') break;
    if (message?.role !== 'assistant') continue;
    const match = pattern.exec(message.text);
    if (match?.[1]) return match[1];
  }
  return undefined;
}
