/**
 * The single live line at the foot of the current response while a run is
 * open: marker · elapsed · output tokens · rotating phrase. It stands in for
 * the per-bubble waiting locator, the model-wait tail row, and the pre-reply
 * activity slot, so tool rounds and model waits share one moving surface.
 */
import { useRef, type ReactElement } from 'react';
import { AgentLocator, SkillActivityChip } from './agent-locator.js';
import type { ChatMessageUi, RunRecordUi, SkillActivityView } from './chat-reducer.js';
import { formatTokensK } from './chat-turn-marginalia.js';
import type { ModelWaitTail } from './model-wait-tail';
import {
  estimateRunOutputTokens,
  resolveRunStatusActivityInput,
  resolveRunStatusStartedAt,
} from './run-status-footer-model.js';
import type { AgentLocatorAnimation } from './ui-preferences.js';
import { formatLiveElapsed, useLiveElapsed } from './work-fold-header.js';

export type RunStatusFooterProps = {
  /** Messages of the current turn, transcript order. */
  messages: readonly ChatMessageUi[];
  activeRunId: string | null;
  runRecordsById: Record<string, RunRecordUi>;
  modelWaitTail: ModelWaitTail | null;
  locale: 'zh-CN' | 'en';
  animation?: AgentLocatorAnimation;
  skill?: SkillActivityView | null;
};

/** Never let the counter step back when a tool start swaps arg progress for its preview. */
function useMonotonicRunCount(runKey: string, value: number): number {
  const ref = useRef<{ runKey: string; value: number }>({ runKey, value });
  if (ref.current.runKey !== runKey) {
    ref.current = { runKey, value };
  } else if (value > ref.current.value) {
    ref.current.value = value;
  }
  return ref.current.value;
}

export function RunStatusFooter(props: RunStatusFooterProps): ReactElement {
  const startedAt = resolveRunStatusStartedAt(props);
  const elapsedMs = useLiveElapsed(startedAt);
  const tokens = useMonotonicRunCount(
    props.activeRunId ?? 'pending',
    estimateRunOutputTokens(props.messages, props.activeRunId),
  );
  const input = resolveRunStatusActivityInput(props);

  const metaParts: string[] = [];
  if (elapsedMs !== undefined) metaParts.push(formatLiveElapsed(elapsedMs));
  if (tokens > 0) metaParts.push(`${formatTokensK(tokens)} tokens`);
  const meta =
    metaParts.length > 0 ? (
      <>
        {metaParts.map((part, index) => (
          <span key={index} className="run-status-footer-fact">
            {part}
          </span>
        ))}
      </>
    ) : null;

  return (
    <div
      className="run-status-footer"
      data-testid="run-status-footer"
      {...(props.activeRunId ? { 'data-run-id': props.activeRunId } : {})}
    >
      {props.skill ? (
        <SkillActivityChip skill={props.skill} loading={false} locale={props.locale} />
      ) : null}
      <AgentLocator
        input={input}
        meta={meta}
        {...(props.animation ? { animation: props.animation } : {})}
      />
    </div>
  );
}
