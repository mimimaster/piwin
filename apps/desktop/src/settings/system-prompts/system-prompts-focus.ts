import type { BuiltinSystemPromptSlotId } from '@piwin/contracts';

export type SystemPromptsTab = 'presets' | 'builtins';

export type SystemPromptFocusRequest = {
  tab: SystemPromptsTab;
  slotId?: BuiltinSystemPromptSlotId;
};

let pendingFocus: SystemPromptFocusRequest | null = null;

/** Queue a tab/slot jump before navigating to `Settings → system-prompts`. */
export function requestSystemPromptFocus(request: SystemPromptFocusRequest): void {
  pendingFocus = request;
}

export function consumeSystemPromptFocus(): SystemPromptFocusRequest | null {
  const next = pendingFocus;
  pendingFocus = null;
  return next;
}
