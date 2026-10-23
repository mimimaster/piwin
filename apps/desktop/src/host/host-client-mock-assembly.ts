import type { ContextSummaryPush, PromptInput } from '@piwin/contracts';
import { estimateHostTokens } from '@piwin/contracts';
import type { MockHostBackend } from './host-client-mock.js';

export function createMockMediaAsset(input: {
  sessionId: string;
  mimeType: string;
  name?: string;
  contentKind?: string;
  byteSize?: number;
  base64Data?: string;
}): {
  id: string;
  sessionId: string;
  absolutePath: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  name?: string;
  contentKind?: string;
} {
  const extension =
    input.name?.match(/\.[a-z0-9]{1,12}$/iu)?.[0].toLowerCase() ??
    (input.mimeType.split('/')[1]?.replace(/[^a-z0-9]/giu, '') || 'bin');
  const asset = {
    id: crypto.randomUUID(),
    sessionId: input.sessionId,
    absolutePath: `/tmp/piwin-mock-media/${input.sessionId}/${crypto.randomUUID()}${extension.startsWith('.') ? extension : `.${extension}`}`,
    mimeType: input.mimeType,
    byteSize:
      input.byteSize ?? Math.max(1, Math.floor((input.base64Data?.length ?? 4) * 0.75)),
    createdAt: new Date().toISOString(),
  };
  return {
    ...asset,
    ...(input.name ? { name: input.name } : {}),
    ...(input.contentKind ? { contentKind: input.contentKind } : {}),
  };
}

export function copyMockAssemblySummaries(
  host: MockHostBackend,
  sourceSessionId: string,
  targetSessionId: string,
  messageIdMap: ReadonlyMap<string, string>,
  retainedRunIds?: ReadonlySet<string>,
): void {
  const source = host.mockAssemblySummaries.get(sourceSessionId) ?? [];
  if (source.length === 0) {
    return;
  }
  const copied: ContextSummaryPush[] = [];
  for (const summary of source) {
    const mappedUser = summary.userMessageId
      ? messageIdMap.get(summary.userMessageId)
      : undefined;
    const keepByUser =
      summary.userMessageId !== undefined && messageIdMap.has(summary.userMessageId);
    const keepByRun = retainedRunIds === undefined || retainedRunIds.has(summary.runId);
    if (retainedRunIds !== undefined && !keepByUser && !keepByRun) {
      continue;
    }
    copied.push({
      ...summary,
      sessionId: targetSessionId,
      ...(mappedUser === undefined ? {} : { userMessageId: mappedUser }),
    });
  }
  host.mockAssemblySummaries.set(targetSessionId, copied);
  host.mockAssemblyOrdinals.set(
    targetSessionId,
    copied.reduce((max, item) => Math.max(max, item.requestOrdinal), 0),
  );
}

export function emitMockAssemblySummary(
  host: MockHostBackend,
  input: {
    sessionId: string;
    runId: string;
    requestClass: ContextSummaryPush['requestClass'];
    userMessageId?: string;
    text: string;
    attachments?: PromptInput['attachments'];
  },
): void {
  const requestOrdinal = (host.mockAssemblyOrdinals.get(input.sessionId) ?? 0) + 1;
  host.mockAssemblyOrdinals.set(input.sessionId, requestOrdinal);
  const contributions: ContextSummaryPush['contributions'] = [
    {
      id: crypto.randomUUID(),
      kind: 'user',
      label: input.requestClass === 'steer' ? 'Steer' : 'User',
      trustOrigin: 'user',
      canOpenOnClient: false,
      redactionState: 'none',
      estimatedTokens: estimateHostTokens(input.text),
      preview: input.text.slice(0, 200),
    },
  ];
  for (const attachment of input.attachments ?? []) {
    if (attachment.kind !== 'media') {
      continue;
    }
    contributions.push({
      id: crypto.randomUUID(),
      kind: attachment.mimeType.toLowerCase().startsWith('image/')
        ? 'native-image'
        : 'attachment-text',
      label: attachment.mimeType,
      trustOrigin: 'user',
      canOpenOnClient: false,
      redactionState: 'path',
      displayPath: attachment.path.split(/[/\\]/).pop() ?? attachment.path,
    });
  }
  const totalEstimatedTokens = contributions.reduce(
    (sum, item) => sum + (item.estimatedTokens ?? 0),
    0,
  );
  const summary: ContextSummaryPush = {
    type: 'agent/context-summary',
    sessionId: input.sessionId,
    runId: input.runId,
    requestClass: input.requestClass,
    requestOrdinal,
    coverage: 'assembly-only',
    estimateSource: 'host-estimate',
    contributions,
    ...(input.userMessageId ? { userMessageId: input.userMessageId } : {}),
    ...(totalEstimatedTokens > 0 ? { totalEstimatedTokens } : {}),
  };
  const existing = host.mockAssemblySummaries.get(input.sessionId) ?? [];
  host.mockAssemblySummaries.set(input.sessionId, [...existing, summary]);
  host.emitPush(summary);
}
