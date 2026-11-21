/**
 * Pure status formatting and preview-layer assembly helpers for built-in
 * system prompt stacks.
 */
import {
  compileBuiltinSystemPromptStackContent,
  type BuiltinSystemPromptDescriptor,
  type BuiltinSystemPromptStackConfig,
  type SystemPromptFileReadItem,
} from '@piwin/contracts';
import { promptFileDisplayName, promptFileExtensionLabel } from './prompt-file-actions';
import type { PromptPreviewLayer, PromptPreviewPayload } from './PromptPreviewModal';

export type BuiltinSlotStatusTone = 'inactive' | 'active' | 'warning';

export function describeBuiltinSlotStatus(params: {
  includeBuiltin: boolean;
  fileCount: number;
  legacyOverridden: boolean;
  isZh: boolean;
}): { label: string; tone: BuiltinSlotStatusTone } {
  const { includeBuiltin, fileCount, legacyOverridden, isZh } = params;
  if (!includeBuiltin && fileCount === 0) {
    return { label: isZh ? '已清空' : 'Empty', tone: 'warning' };
  }
  if (!includeBuiltin && fileCount > 0) {
    return {
      label: isZh ? `替换 · ${fileCount}` : `Replaced · ${fileCount}`,
      tone: 'active',
    };
  }
  if (includeBuiltin && fileCount > 0) {
    return {
      label: isZh ? `内置 +${fileCount}` : `Built-in +${fileCount}`,
      tone: 'active',
    };
  }
  if (includeBuiltin && legacyOverridden) {
    return { label: isZh ? '已自定义' : 'Custom', tone: 'active' };
  }
  return { label: isZh ? '内置' : 'Built-in', tone: 'inactive' };
}

export function buildBuiltinFileLayers(params: {
  filePaths: readonly string[];
  readByPath: ReadonlyMap<string, SystemPromptFileReadItem>;
  orderOffset: number;
  keyPrefix: string;
}): { layers: PromptPreviewLayer[]; validContents: string[] } {
  const validContents: string[] = [];
  const layers: PromptPreviewLayer[] = params.filePaths.map((filePath, index) => {
    const item = params.readByPath.get(filePath);
    const fileName = item?.fileName ?? promptFileDisplayName(filePath);
    const missing = item ? !item.exists : false;
    if (!missing && item?.content.trim()) {
      validContents.push(item.content);
    }
    const orderTag = String(index + 1 + params.orderOffset).padStart(2, '0');
    return {
      id: `${params.keyPrefix}-${index}`,
      label: `${orderTag} @${fileName}`,
      badge: promptFileExtensionLabel(filePath),
      filePath: item?.resolvedPath ?? filePath,
      content: item?.content ?? '',
      missing,
      ...(item?.error ? { error: item.error } : {}),
      ...(item?.sizeBytes !== undefined ? { sizeBytes: item.sizeBytes } : {}),
    };
  });
  return { layers, validContents };
}

export function buildBuiltinPreviewPayload(params: {
  descriptor: BuiltinSystemPromptDescriptor;
  baseContent: string;
  legacyOverridden: boolean;
  stack: BuiltinSystemPromptStackConfig;
  readByPath: ReadonlyMap<string, SystemPromptFileReadItem>;
  isZh: boolean;
}): PromptPreviewPayload {
  const { descriptor, baseContent, legacyOverridden, stack, readByPath, isZh } = params;
  const status = describeBuiltinSlotStatus({
    includeBuiltin: stack.includeBuiltin,
    fileCount: stack.filePaths.length,
    legacyOverridden,
    isZh,
  });
  const title = isZh ? descriptor.titleZh : descriptor.titleEn;

  if (stack.includeBuiltin && stack.filePaths.length === 0) {
    return {
      title,
      badge: legacyOverridden ? status.label : descriptor.slotId,
      badgeTone: legacyOverridden ? 'running' : 'neutral',
      layers: [
        {
          id: descriptor.slotId,
          label: isZh ? '内置默认' : 'Built-in default',
          content: baseContent,
        },
      ],
    };
  }

  const { layers: fileLayers, validContents } = buildBuiltinFileLayers({
    filePaths: stack.filePaths,
    readByPath,
    orderOffset: stack.includeBuiltin ? 1 : 0,
    keyPrefix: 'builtin-file',
  });
  const compiled = compileBuiltinSystemPromptStackContent({
    baseContent,
    stack,
    fileContents: validContents,
  });

  return {
    title,
    badge: status.label,
    badgeTone: status.tone === 'warning' ? 'warning' : 'running',
    layers: [
      {
        id: 'combined',
        label: isZh ? '完整合成' : 'Combined',
        content: compiled,
      },
      ...(stack.includeBuiltin
        ? [
            {
              id: 'builtin-base',
              label: isZh ? '01 内置默认' : '01 Built-in',
              content: baseContent,
            },
          ]
        : []),
      ...fileLayers,
    ],
  };
}
