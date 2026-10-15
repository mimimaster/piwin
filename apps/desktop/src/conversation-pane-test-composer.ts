/** Test-only: a pane composer whose handlers do nothing. */
import type { ComposerDockProps } from './composer-dock-types.js';
import { createInitialChatUiState } from './chat-reducer.js';
import { selectContextRingView } from './context-telemetry-selector.js';
import { buildPaneComposerProps } from './pane-composer-props.js';

function ignore(): void {}

export function createPaneTestComposerCard(sessionId: string): ComposerDockProps {
  return buildPaneComposerProps({
    sessionId,
    composer: '',
    onComposerChange: ignore,
    streaming: false,
    runPhase: 'idle',
    mutationsEnabled: true,
    attachments: [],
    onRemoveAttachment: ignore,
    onAttachFiles: ignore,
    onPickFiles: ignore,
    dropActive: false,
    onDropActiveChange: ignore,
    plusMenuOpen: false,
    onPlusMenuOpenChange: ignore,
    plusSubmenu: 'none',
    onPlusSubmenuChange: ignore,
    modelOptions: [],
    selectedModelKey: '',
    selectedModelLabel: '',
    thinkingLevel: 'medium',
    onSelectModel: ignore,
    onThinkingLevelChange: ignore,
    contextRingView: selectContextRingView({
      telemetry: createInitialChatUiState().contextTelemetry,
      locale: 'zh-CN',
    }),
    onSend: ignore,
    onStop: ignore,
  });
}
