import { useMemo, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { ToolCallCard } from './tool-call-card.js';
import { mapCompactionActivityToToolRow } from './compaction-tool-row.js';
import type { CompactionActivityUi } from './chat-reducer.js';

export type CompactionActivityProps = {
  activity: CompactionActivityUi;
  locale: 'zh-CN' | 'en';
  onAbort?: () => void | Promise<void>;
};

/**
 * Compaction rendered as one row of the tool chain.
 *
 * The operation id is the row's tool-call id, so a start → terminal transition
 * updates a single node in place instead of swapping a detached banner. Running
 * rows do not auto-expand: compaction streams no output worth holding open, and
 * a self-opening row is what made the old card read as a notification. Terminal
 * rows need no dismiss — they are transcript history like any other tool call.
 */
export function CompactionActivity(props: CompactionActivityProps): ReactElement {
  const { activity, locale } = props;
  const tool = useMemo(() => mapCompactionActivityToToolRow(activity, locale), [activity, locale]);
  const showCancel = activity.phase === 'running' && props.onAbort !== undefined;

  return (
    <div
      className="turn-tool-sequence chat-compaction-row"
      data-testid="compaction-activity"
      data-operation-id={activity.operationId}
      data-phase={activity.phase}
      data-reason={activity.reason}
    >
      <ToolCallCard tool={tool} density="compact" locale={locale} expandWhileRunning={false} />
      {showCancel ? (
        <Button
          size="compact"
          variant="ghost"
          className="chat-compaction-row-cancel"
          onClick={() => void props.onAbort?.()}
        >
          {locale === 'zh-CN' ? '取消' : 'Cancel'}
        </Button>
      ) : null}
    </div>
  );
}