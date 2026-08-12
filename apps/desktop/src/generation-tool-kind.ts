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

  const invokedToolName = tool.toolName.trim().toLowerCase();
  if (invokedToolName === 'image_gen') {
    return 'image';
  }
  if (invokedToolName === 'video_gen') {
    return 'video';
  }
  return null;
}
