import type { ClipboardEvent, DragEvent } from 'react';
import type { PromptAttachment, ThinkingLevel } from '@piwin/contracts';
import type { ComposerDockProps } from './composer-dock-types.js';
import type { ComposerPlusSubmenu } from './composer-plus-menu.js';
import type { ContextRingViewModel } from './context-telemetry-selector.js';
import type { PendingContextRefItem } from './hooks/use-composer-context-refs.js';

function ignoreEvent(): void {}

export type PaneComposerCardInput = {
  sessionId: string;
  composer: string;
  onComposerChange: (value: string) => void;
  streaming: boolean;
  runPhase: ComposerDockProps['runPhase'];
  /** Host ready and no pane request in flight. */
  mutationsEnabled: boolean;
  attachments: readonly PromptAttachment[];
  onRemoveAttachment: (id: string) => void;
  onAttachFiles: (files: File[], source: 'paste' | 'drop' | 'file-picker') => void;
  onPickFiles: () => void;
  dropActive: boolean;
  onDropActiveChange: (active: boolean) => void;
  plusMenuOpen: boolean;
  onPlusMenuOpenChange: (open: boolean) => void;
  plusSubmenu: ComposerPlusSubmenu;
  onPlusSubmenuChange: (submenu: ComposerPlusSubmenu) => void;
  modelOptions: ComposerDockProps['modelOptions'];
  selectedModelKey: string;
  selectedModelLabel: string;
  thinkingLevel: ThinkingLevel;
  onSelectModel: (key: string) => void;
  onThinkingLevelChange: (level: ThinkingLevel) => void;
  contextRingView: ContextRingViewModel;
  /** Sends a prompt, or steers the live run while one is streaming. */
  onSend: () => void;
  onStop: () => void;
  /** Quoted selections attached to the next prompt (side chat seeds). */
  pendingContextRefs?: readonly PendingContextRefItem[];
  onRemoveContextRef?: (key: string) => void;
};

/**
 * ComposerCard props for a split conversation pane: the same card as the
 * workbench dock, limited to what a pane session can do (attach, model,
 * send/steer, stop). Pause is not offered, so the running circle is Stop.
 */
export function buildPaneComposerProps(input: PaneComposerCardInput): ComposerDockProps {
  return {
    layoutMode: 'docked',
    projectPath: null,
    projectTrusted: true,
    activeSessionId: input.sessionId,
    streaming: input.streaming,
    runPhase: input.runPhase,
    compacting: false,
    composer: input.composer,
    onComposerChange: input.onComposerChange,
    agentMode: 'agent',
    onAgentModeChange: ignoreEvent,
    pendingAttachments: input.attachments.map((attachment) => ({
      localId: attachment.id,
      attachment,
      previewUrl: '',
      uploadStatus: 'ready' as const,
    })),
    onRemoveAttachment: input.onRemoveAttachment,
    ...(input.pendingContextRefs ? { pendingContextRefs: [...input.pendingContextRefs] } : {}),
    ...(input.onRemoveContextRef ? { onRemoveContextRef: input.onRemoveContextRef } : {}),
    dropActive: input.dropActive,
    onDropActiveChange: input.onDropActiveChange,
    plusMenuOpen: input.plusMenuOpen,
    onPlusMenuOpenChange: input.onPlusMenuOpenChange,
    plusSubmenu: input.plusSubmenu,
    onPlusSubmenuChange: input.onPlusSubmenuChange,
    modelOptions: input.modelOptions,
    selectedModelKey: input.selectedModelKey,
    selectedModelLabel: input.selectedModelLabel,
    onSelectModel: input.onSelectModel,
    menuSkills: [],
    menuMcp: [],
    onRefreshComposerMenus: ignoreEvent,
    onOpenSkillsPanel: ignoreEvent,
    onOpenMcpPanel: ignoreEvent,
    onAttachFile: input.onPickFiles,
    onAttachImage: input.onPickFiles,
    onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = event.clipboardData.files;
      if (files.length === 0) return;
      event.preventDefault();
      input.onAttachFiles([...files], 'paste');
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      const files = event.dataTransfer.files;
      if (files.length === 0) return;
      input.onAttachFiles([...files], 'drop');
    },
    onSend: input.onSend,
    onSteer: input.onSend,
    onPause: input.onStop,
    onAbort: input.onStop,
    stopOnly: true,
    liveSupported: false,
    onCompact: ignoreEvent,
    contextUsage: null,
    contextRingView: input.contextRingView,
    thinkingLevel: input.thinkingLevel,
    onThinkingLevelChange: input.onThinkingLevelChange,
    mutationsEnabled: input.mutationsEnabled,
    isConversationSession: true,
  };
}
