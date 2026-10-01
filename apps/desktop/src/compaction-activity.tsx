import { useId, useMemo, useState, type ReactElement } from 'react';
import { Spinner } from '@piwin/ui-kit';
import type { CompactionActivityUi } from './chat-reducer.js';
import {
  resolveCompactionSeamModel,
  type CompactionSeamLocale,
  type CompactionSeamModel,
} from './compaction-seam-model.js';
import { IconCheck, IconChevronDown, IconClose } from './shell-icons';
import { formatLiveElapsed, useLiveElapsed } from './work-fold-header.js';

export type CompactionActivityProps = {
  activity: CompactionActivityUi;
  locale: CompactionSeamLocale;
  onAbort?: () => void | Promise<void>;
};

const DETAIL_COPY = {
  'zh-CN': { reason: '原因', compare: '前后对比', before: '压缩前', after: '压缩后', summary: '摘要', files: '涉及文件' },
  en: { reason: 'Reason', compare: 'Before and after', before: 'Before', after: 'After', summary: 'Summary', files: 'Files' },
} as const;

/** The bar for a near-total reduction must still be visible. */
const MIN_AFTER_BAR_PERCENT = 1.5;

function SeamGlyph(props: { tone: CompactionSeamModel['tone']; label: string }): ReactElement {
  switch (props.tone) {
    case 'live':
      return (
        <span className="chat-compaction-seam-glyph chat-compaction-seam-spinner">
          <Spinner label={props.label} testId="compaction-spinner" />
        </span>
      );
    case 'done':
      return <IconCheck className="chat-compaction-seam-glyph" width={13} height={13} aria-hidden="true" />;
    case 'failed':
      return <IconClose className="chat-compaction-seam-glyph" width={13} height={13} aria-hidden="true" />;
    case 'cancelled':
      return <span className="chat-compaction-seam-glyph chat-compaction-seam-dash" aria-hidden="true" />;
  }
}

function SeamDetail(props: {
  id: string;
  model: CompactionSeamModel;
  locale: CompactionSeamLocale;
}): ReactElement {
  const { model } = props;
  const copy = DETAIL_COPY[props.locale];
  const showCompare = model.ratio !== null && model.before !== null && model.after !== null;
  return (
    <div id={props.id} className="chat-compaction-seam-detail" data-testid="compaction-detail">
      {model.reason !== null ? (
        <div className="chat-compaction-seam-section">
          <span className="chat-compaction-seam-key">{copy.reason}</span>
          <span>{model.reason}</span>
        </div>
      ) : null}
      {showCompare && model.ratio !== null ? (
        <div className="chat-compaction-seam-section">
          <span className="chat-compaction-seam-key">{copy.compare}</span>
          <div className="chat-compaction-seam-compare">
            <span>{copy.before}</span>
            <span className="chat-compaction-seam-track">
              <b className="is-before" style={{ width: '100%' }} />
            </span>
            <span className="chat-compaction-seam-figure">{model.before}</span>
            <span>{copy.after}</span>
            <span className="chat-compaction-seam-track">
              <b
                className="is-after"
                style={{ width: `${Math.max(model.ratio * 100, MIN_AFTER_BAR_PERCENT)}%` }}
              />
            </span>
            <span className="chat-compaction-seam-figure">{model.after}</span>
          </div>
        </div>
      ) : null}
      {model.summary !== null ? (
        <div className="chat-compaction-seam-section">
          <span className="chat-compaction-seam-key">{copy.summary}</span>
          <p className="chat-compaction-seam-summary">{model.summary}</p>
        </div>
      ) : null}
      {model.files.length > 0 ? (
        <div className="chat-compaction-seam-section">
          <span className="chat-compaction-seam-key">{copy.files}</span>
          <ul className="chat-compaction-seam-files">
            {model.files.map((file) => (
              <li key={file.path} title={file.path} data-modified={file.modified ? 'true' : undefined}>
                {file.name}
              </li>
            ))}
            {model.filesOmitted > 0 ? <li>+{model.filesOmitted}</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Compaction drawn as a seam across the transcript: a hairline with one pill
 * on it. It is maintenance on the whole context window rather than a tool the
 * agent called, so it sits between the messages it separates instead of
 * posing as a chain row. Running shows a spinner and shimmering label; a
 * settled compaction collapses to the token delta and unfolds on demand.
 */
export function CompactionActivity(props: CompactionActivityProps): ReactElement {
  const { activity, locale } = props;
  const model = useMemo(() => resolveCompactionSeamModel(activity, locale), [activity, locale]);
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const elapsedMs = useLiveElapsed(activity.phase === 'running' ? activity.startedAt : undefined);
  const expanded = open && model.expandable;

  const facts: Array<{ kind: 'clock' | 'tokens' | 'reduction' | 'duration' | 'note'; text: string }> = [];
  if (model.tone === 'live' && elapsedMs !== undefined) {
    facts.push({ kind: 'clock', text: formatLiveElapsed(elapsedMs) });
  }
  if (model.tokens !== null) facts.push({ kind: 'tokens', text: model.tokens });
  if (model.reduction !== null) facts.push({ kind: 'reduction', text: model.reduction });
  if (model.duration !== null) facts.push({ kind: 'duration', text: model.duration });
  const note = model.failure ?? model.note;
  if (note !== null) facts.push({ kind: 'note', text: note });

  const pillBody = (
    <>
      <SeamGlyph tone={model.tone} label={model.label} />
      <span
        className={
          model.tone === 'live'
            ? 'chat-compaction-seam-label behavior-generic-active'
            : 'chat-compaction-seam-label'
        }
      >
        {model.label}
      </span>
      {facts.map((fact) => (
        <span key={fact.kind} className="chat-compaction-seam-fact" data-kind={fact.kind}>
          {fact.text}
        </span>
      ))}
      {model.expandable ? (
        <IconChevronDown className="chat-compaction-seam-chevron" width={13} height={13} aria-hidden="true" />
      ) : null}
    </>
  );

  return (
    <div
      className="chat-compaction-seam"
      data-testid="compaction-activity"
      data-operation-id={activity.operationId}
      data-phase={activity.phase}
      data-reason={activity.reason}
      data-tone={model.tone}
      data-open={expanded ? 'true' : 'false'}
    >
      <div className="chat-compaction-seam-line">
        <span className="chat-compaction-seam-rule" aria-hidden="true" />
        {model.expandable ? (
          <button
            type="button"
            className="chat-compaction-seam-pill"
            aria-expanded={expanded}
            aria-controls={detailId}
            onClick={() => setOpen((current) => !current)}
          >
            {pillBody}
          </button>
        ) : (
          <div className="chat-compaction-seam-pill">{pillBody}</div>
        )}
        <span className="chat-compaction-seam-rule" aria-hidden="true" />
      </div>
      {expanded ? (
        <SeamDetail id={detailId} model={model} locale={locale} />
      ) : null}
    </div>
  );
}
