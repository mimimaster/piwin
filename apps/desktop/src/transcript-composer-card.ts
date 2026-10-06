/**
 * The transcript's view of the composer.
 *
 * ChatThread, its rows and the in-place MessageEditCard read only the model /
 * thinking / orchestration controls and a few handlers from the composer
 * props. The full `ComposerDockProps` object also carries the draft text, so
 * handing it to the transcript re-rendered the whole thread on every typed
 * character. This hook keeps the object identity stable until a data field the
 * transcript actually reads changes; handlers go through stable proxies that
 * call the latest closure (upstream handlers are rebuilt on many renders).
 *
 * Invariant: when you make a transcript component read another composer
 * field, add it here — data to `TRANSCRIPT_COMPOSER_DATA_FIELDS`, handlers to
 * `TRANSCRIPT_COMPOSER_HANDLER_FIELDS` — otherwise it goes stale.
 */
import { useInsertionEffect, useMemo, useRef } from 'react';
import type { ComposerDockProps } from './composer-dock-types';

export const TRANSCRIPT_COMPOSER_DATA_FIELDS = [
  'activeSessionId',
  'activeAgentId',
  'backendOptions',
  'draftAgentId',
  'draftAgentOptions',
  'capabilities',
  'streaming',
  'runPhase',
  'mutationsEnabled',
  'delegationDisabled',
  'isConversationSession',
  'modelOptions',
  'orchestrationSchemeId',
  'orchestrationSchemeOptions',
  'selectedModelKey',
  'selectedModelLabel',
  'thinkingLevel',
  'ultraThinkingEnabled',
] as const satisfies readonly (keyof ComposerDockProps)[];

export const TRANSCRIPT_COMPOSER_HANDLER_FIELDS = [
  'onBackendModelChange',
  'onBackendEffortChange',
  'onBackendModeChange',
  'onDraftAgentChange',
  'onStartNewSession',
  'onOpenAgentSettings',
  'onAbort',
  'onAgentModeChange',
  'onDelegationDisabledChange',
  'onOpenOrchestrationSchemeSettings',
  'onOrchestrationSchemeChange',
  'onSelectModel',
  'onThinkingLevelChange',
] as const satisfies readonly (keyof ComposerDockProps)[];

type HandlerField = (typeof TRANSCRIPT_COMPOSER_HANDLER_FIELDS)[number];
type HandlerProxy = (...args: unknown[]) => unknown;

export function useTranscriptComposerCard(composerCard: ComposerDockProps): ComposerDockProps {
  const latestRef = useRef(composerCard);
  // Insertion effects run before layout effects, so a child commit that
  // invokes a handler already sees this render's closure.
  useInsertionEffect(() => {
    latestRef.current = composerCard;
  });
  const proxiesRef = useRef(new Map<HandlerField, HandlerProxy>());
  const proxyFor = (field: HandlerField): HandlerProxy => {
    let proxy = proxiesRef.current.get(field);
    if (proxy === undefined) {
      proxy = (...args: unknown[]): unknown => {
        const latest = latestRef.current[field] as HandlerProxy | undefined;
        return latest?.(...args);
      };
      proxiesRef.current.set(field, proxy);
    }
    return proxy;
  };

  const dataValues = TRANSCRIPT_COMPOSER_DATA_FIELDS.map((field) => composerCard[field]);
  // Optional handlers: presence (not identity) decides whether a control renders.
  const handlerPresence = TRANSCRIPT_COMPOSER_HANDLER_FIELDS.map(
    (field) => composerCard[field] !== undefined,
  );
  return useMemo(() => {
    const view: Record<string, unknown> = { ...composerCard };
    for (const field of TRANSCRIPT_COMPOSER_HANDLER_FIELDS) {
      if (composerCard[field] !== undefined) {
        view[field] = proxyFor(field);
      }
    }
    return view as ComposerDockProps;
    // Deps are the transcript-read fields, not the object: the draft text and
    // other dock-only fields must not invalidate the transcript's copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dataValues, ...handlerPresence]);
}
