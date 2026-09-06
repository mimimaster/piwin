import type { ToolCardUi } from './chat-reducer';

export type GenerationToolKind = 'image' | 'video';

/** Resolve live, routed, partially upgraded, and legacy direct generation calls. */
export function resolveGenerationToolKind(tool: ToolCardUi): GenerationToolKind | null {
  const presentationKind = tool.presentation?.kind;
  if (presentationKind === 'image' || presentationKind === 'video') {
    return presentationKind;
  }

  const routedToolName = tool.presentation?.routedToolName?.trim().toLowerCase();
  if (routedToolName === 'image_gen') {
    return 'image';
  }
  if (routedToolName === 'video_gen') {
    return 'video';
  }

  const title = tool.presentation?.title?.trim().toLowerCase();
  if (title === 'image_gen') {
    return 'image';
  }
  if (title === 'video_gen') {
    return 'video';
  }

  const invokedToolName = tool.toolName.trim().toLowerCase();
  if (invokedToolName === 'image_gen') {
    return 'image';
  }
  if (invokedToolName === 'video_gen') {
    return 'video';
  }
  return null;
}

export function getGenerationStatus(
  message: { tools: readonly ToolCardUi[] },
  generationKind: GenerationToolKind,
): ToolCardUi['status'] | null {
  const tool = getGenerationTool(message, generationKind);
  if (!tool) {
    return null;
  }
  const generationTools = message.tools.filter(
    (candidate) => resolveGenerationToolKind(candidate) === generationKind,
  );
  if (generationTools.some((candidate) => candidate.status === 'running')) {
    return 'running';
  }
  if (generationTools.some((candidate) => candidate.status === 'error')) {
    return 'error';
  }
  return 'done';
}

/** Newest matching generation tool for presentation metadata. */
export function getGenerationTool(
  message: { tools: readonly ToolCardUi[] },
  generationKind: GenerationToolKind,
): ToolCardUi | null {
  for (let index = message.tools.length - 1; index >= 0; index -= 1) {
    const tool = message.tools[index];
    if (tool && resolveGenerationToolKind(tool) === generationKind) {
      return tool;
    }
  }
  return null;
}

/** Done generation is the attachment itself; keep the card only while running or failed. */
export function shouldRenderGenerationProgress(
  status: ToolCardUi['status'] | null,
  attachments: readonly { kind: string }[],
): boolean {
  if (status === null) {
    return false;
  }
  if (status === 'done' && attachments.some((attachment) => attachment.kind === 'media')) {
    return false;
  }
  return true;
}
