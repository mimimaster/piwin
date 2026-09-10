import type { ClipboardEvent, DragEvent } from 'react';
import type { ThinkingLevel } from '@piwin/contracts';
import type { ComposerDockProps } from './composer-dock-types.js';
import type { PendingContextRefItem } from './hooks/use-composer-context-refs.js';

function ignoreEvent(): void {}

export type SideChatComposerCardInput = {
  composer: string;
  onComposerChange: (value: string) => void;
  streaming: boolean;
  activeSideChatId: string | null;
  mainSessionReady: boolean;
  modelOptions: ComposerDockProps['modelOptions'];
  selectedModelKey: string;
  selectedModelLabel: string;
  thinkingLevel: ThinkingLevel;
  onSelectModel: (key: string) => void;
  onThinkingLevelChange: (level: ThinkingLevel) => void;
  onSend: (text?: string) => void;
  onStop: () => void;
  pendingContextRefs?: PendingContextRefItem[];
  onRemoveContextRef?: (key: string) => void;
};

/** ComposerCard props for the side-chat column. Same slab as the main dock. */
export function buildSideChatComposerProps(input: SideChatComposerCardInput): ComposerDockProps {
  return {
    layoutMode: 'docked',
    projectPath: null,
    projectTrusted: true,
    activeSessionId: input.activeSideChatId,
    streaming: input.streaming,
    runPhase: input.streaming ? 'streaming' : 'idle',
    compacting: false,
    composer: input.composer,
    onComposerChange: input.onComposerChange,
    agentMode: 'agent',
    onAgentModeChange: ignoreEvent,
    pendingAttachments: [],
    onRemoveAttachment: ignoreEvent,
    dropActive: false,
    onDropActiveChange: ignoreEvent,
    plusMenuOpen: false,
    onPlusMenuOpenChange: ignoreEvent,
    plusSubmenu: 'none',
    onPlusSubmenuChange: ignoreEvent,
    modelOptions: input.modelOptions,
    selectedModelKey: input.selectedModelKey,
    selectedModelLabel: input.selectedModelLabel,
    onSelectModel: input.onSelectModel,
    menuSkills: [],
    menuMcp: [],
    onRefreshComposerMenus: ignoreEvent,
    onOpenSkillsPanel: ignoreEvent,
    onOpenMcpPanel: ignoreEvent,
    onAttachFile: ignoreEvent,
    onAttachImage: ignoreEvent,
    onPaste: (_event: ClipboardEvent<HTMLTextAreaElement>) => undefined,
    onDrop: (_event: DragEvent<HTMLElement>) => undefined,
    onSend: input.onSend,
    onPause: input.onStop,
    onAbort: input.onStop,
    onCompact: ignoreEvent,
    contextUsage: null,
    ...(input.pendingContextRefs ? { pendingContextRefs: input.pendingContextRefs } : {}),
    ...(input.onRemoveContextRef ? { onRemoveContextRef: input.onRemoveContextRef } : {}),
    thinkingLevel: input.thinkingLevel,
    onThinkingLevelChange: input.onThinkingLevelChange,
    mutationsEnabled: input.mainSessionReady,
    isConversationSession: true,
    embedded: true,
    compactionSupported: false,
  };
}
