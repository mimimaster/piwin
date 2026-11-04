import { useEffect, useRef } from 'react';
import type { ChatUiState } from '../conversation/chat-ui-types.js';
import { installRendererSelfHeal, type RendererActivity } from '../platform/renderer-self-heal.js';
import type { useWorkbenchAppModel } from './use-workbench-app-model.js';
import type { WorkbenchShellChrome } from './use-workbench-shell-chrome.js';

type AppModel = ReturnType<typeof useWorkbenchAppModel>;

type WorkbenchRecoveryInput = {
  state: Pick<ChatUiState, 'streaming' | 'compacting' | 'hostReady'>;
  chrome: Pick<
    WorkbenchShellChrome,
    'settingsOpen' | 'activeSubPage' | 'knowledgeOpen' | 'editingMessageId' | 'showOverlayScrim'
  >;
  model: Pick<
    AppModel,
    | 'composer'
    | 'pendingAttachments'
    | 'pendingContextRefs'
    | 'extensionUiRequest'
    | 'backendUserInput'
  > & {
    screenCapture: Pick<AppModel['screenCapture'], 'phase'>;
    live: Pick<AppModel['live'], 'starting' | 'call'>;
  };
};

/** Keep editable surfaces/device work intact; Host turns can reconnect after reclamation. */
export function readWorkbenchRendererActivity(input: WorkbenchRecoveryInput): RendererActivity {
  const { state, chrome, model } = input;
  return {
    runActive: state.streaming || state.compacting,
    protectedWork:
      !state.hostReady ||
      model.composer.trim().length > 0 ||
      model.pendingAttachments.length > 0 ||
      model.pendingContextRefs.length > 0 ||
      chrome.settingsOpen ||
      chrome.activeSubPage !== null ||
      chrome.knowledgeOpen ||
      chrome.editingMessageId !== null ||
      chrome.showOverlayScrim ||
      model.screenCapture.phase.kind !== 'idle' ||
      model.live.starting ||
      model.live.call !== null ||
      model.extensionUiRequest != null ||
      model.backendUserInput != null,
  };
}

export function useWorkbenchRendererSelfHeal(input: WorkbenchRecoveryInput): void {
  const activityRef = useRef<RendererActivity>(readWorkbenchRendererActivity(input));
  activityRef.current = readWorkbenchRendererActivity(input);
  useEffect(() => installRendererSelfHeal(() => activityRef.current), []);
}
