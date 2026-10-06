import type { ComposerDockProps, ComposerDraftAgentOption } from './composer-dock-types.js';

type LandingComposer = Pick<ComposerDockProps,
  | 'activeSessionId' | 'activeAgentId' | 'backendOptions'
  | 'draftAgentId' | 'draftAgentOptions' | 'onDraftAgentChange'
  | 'onStartNewSession' | 'onOpenAgentSettings'
>;

type LegacyLandingAgent = {
  draftAgentId?: string | undefined;
  draftAgentOptions?: readonly ComposerDraftAgentOption[] | undefined;
  onSelectDraftAgent?: ((agentId: string) => void) | undefined;
  onOpenAgentSettings?: (() => void) | undefined;
};

/** Engine cards and their composer must share identity and navigation authority. */
export function buildEmptyStageAgentControl(card: LandingComposer, legacy: LegacyLandingAgent) {
  const bound = Boolean(card.activeSessionId);
  const agentId = bound
    ? card.activeAgentId ?? card.backendOptions?.agentId ?? 'pi'
    : card.draftAgentId ?? legacy.draftAgentId ?? 'pi';
  return {
    agentId,
    agentOptions: card.draftAgentOptions ?? legacy.draftAgentOptions,
    openSettings: card.onOpenAgentSettings ?? legacy.onOpenAgentSettings,
    selectAgent: async (requestedAgentId: string): Promise<void> => {
      // An existing session's backend is immutable. A different engine starts
      // an unsent draft through the same navigation path as New Agent.
      if (bound && requestedAgentId !== agentId && card.onStartNewSession) {
        await card.onStartNewSession({ agentId: requestedAgentId });
        return;
      }
      (card.onDraftAgentChange ?? legacy.onSelectDraftAgent)?.(requestedAgentId);
    },
  };
}
