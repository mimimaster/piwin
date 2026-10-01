/**
 * The card's footer while its undo/redo runs: progress, a cancel that only
 * works before the first write, and the reconnect wait.
 */
import { useState, type ReactElement } from 'react';

import { IconWarn } from '../shell-icons.js';
import type { TurnChangesApi } from './turn-changes-context.js';

type Copy = (zh: string, en: string) => string;

export type RunningNote = 'none' | 'reconnecting' | 'write-started' | 'cancel-requested';

export function TurnChangeRunningFoot(props: {
  api: TurnChangesApi;
  changeSetId: string;
  direction: 'undo' | 'redo';
  note: RunningNote;
  onNote: (note: RunningNote) => void;
  t: Copy;
}): ReactElement {
  const { api, t } = props;
  const live = api.live.get(props.changeSetId);
  const [cancelling, setCancelling] = useState(false);
  const verb = props.direction === 'undo' ? t('正在撤销', 'Undoing') : t('正在恢复', 'Restoring');
  const progress = live?.progress;
  let text: string;
  if (props.note === 'reconnecting') {
    text = t('结果尚未确认，正在重连…', 'Waiting for the Host to reconnect to confirm the result…');
  } else if (props.note === 'write-started') {
    text = t('已开始写入，正在安全完成…', 'Writing has started; finishing safely…');
  } else if (props.note === 'cancel-requested') {
    text = t('正在取消…', 'Cancelling…');
  } else if (progress && progress.total > 0) {
    text = t(
      `${verb} ${progress.done} / ${progress.total} 个文件…`,
      `${verb} ${progress.done} / ${progress.total} files…`,
    );
  } else {
    text = t(`${verb}…`, `${verb}…`);
  }
  // Cancel is meaningful only before the first file is written.
  const canCancel =
    live !== undefined &&
    props.note === 'none' &&
    !cancelling &&
    (progress === null || progress === undefined || progress.done === 0);

  const cancel = (): void => {
    if (!live) return;
    setCancelling(true);
    void api.cancel(live.operationId).then((outcome) => {
      setCancelling(false);
      if (outcome === 'cancelled') props.onNote('cancel-requested');
      else if (outcome === 'write-started') props.onNote('write-started');
    });
  };

  return (
    <div className="turn-change-bar-foot info" role="status" aria-live="polite" data-testid="turn-change-bar-running">
      <IconWarn className="i turn-change-bar-foot-glyph" />
      <div className="turn-change-bar-foot-body" data-testid="turn-change-bar-running-text">
        {text}
      </div>
      {canCancel ? (
        <button
          type="button"
          className="turn-change-bar-action quiet"
          onClick={cancel}
          data-testid="turn-change-bar-cancel"
        >
          {t('取消', 'Cancel')}
        </button>
      ) : null}
    </div>
  );
}
