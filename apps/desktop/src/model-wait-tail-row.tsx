/** Hollow trailing node on the call chain while the model reads tool results. */
import type { ReactElement } from 'react';
import type { ModelWaitTail } from './model-wait-tail';
import { formatLiveElapsed, useLiveElapsed } from './work-fold-header.js';

/** Past this the wait reads as a slow provider, not normal latency. */
export const MODEL_WAIT_SLOW_MS = 30_000;

export function modelWaitTailLabel(tail: ModelWaitTail, locale: 'zh-CN' | 'en'): string {
  const zh = locale === 'zh-CN';
  if (tail.kind === 'reconnecting') {
    const base = zh ? '正在重连模型' : 'Reconnecting to model';
    return tail.detail ? `${base} · ${tail.detail}` : `${base}…`;
  }
  const model = tail.modelLabel ?? (zh ? '模型' : 'The model');
  return zh ? `${model} 正在处理结果…` : `${model} is reading the results…`;
}

export function ModelWaitTailRow(props: {
  tail: ModelWaitTail;
  locale: 'zh-CN' | 'en';
}): ReactElement {
  const elapsedMs = useLiveElapsed(props.tail.since);
  const zh = props.locale === 'zh-CN';
  const slow = elapsedMs !== undefined && elapsedMs >= MODEL_WAIT_SLOW_MS;
  return (
    <div
      className="thread turn-tool-sequence model-wait-tail-thread"
      data-testid="model-wait-tail"
      data-wait-kind={props.tail.kind}
      data-slow={slow ? 'true' : 'false'}
      role="status"
      aria-live="polite"
    >
      <div className="tr model-wait-tail">
        <span className="node model-wait-node" data-kind="pending" aria-hidden="true" />
        <span className="model-wait-label behavior-thinking-active">
          {modelWaitTailLabel(props.tail, props.locale)}
        </span>
        <span className="meta model-wait-meta">
          {slow ? (
            <span className="model-wait-slow">{zh ? '响应较慢' : 'Slow response'}</span>
          ) : null}
          {elapsedMs !== undefined ? (
            <span className="model-wait-elapsed" data-testid="model-wait-elapsed">
              {zh ? `等待 ${formatLiveElapsed(elapsedMs)}` : `waiting ${formatLiveElapsed(elapsedMs)}`}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
