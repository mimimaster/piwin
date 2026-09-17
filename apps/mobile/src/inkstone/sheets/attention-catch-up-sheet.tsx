import type { ReactElement } from 'react';
import {
  clearMobileCatchUpDraft,
  getMobileCatchUpDraft,
} from '../../mobile-attention-catch-up.js';
import { useInkstoneHost } from '../host/inkstone-host-context.js';
import { useInkstone } from '../inkstone-context.js';
import { FullButton, ListRow } from '../inkstone-ui.js';

function kindLabel(kind: string): string {
  if (kind === 'needs-input') {
    return '等待批准';
  }
  if (kind === 'turn-failed') {
    return '失败';
  }
  return '已完成';
}

export function AttentionCatchUpSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  const items = getMobileCatchUpDraft();

  return (
    <>
      <p>你离开的这段时间，有这些事需要看一眼。不会重复打扰。</p>
      {items.length === 0 ? <p className="muted">没有未读提醒。</p> : null}
      {items.map((item) => (
        <ListRow
          key={`${item.sessionId}:${item.title}`}
          name="bell"
          title={item.title}
          subtitle={`${kindLabel(item.kind)} · ${item.body}`}
          onClick={() => {
            clearMobileCatchUpDraft();
            dispatch({ type: 'navigate', route: 'chat' });
            dispatch({ type: 'close-sheet' });
            if (hostCtx !== null) {
              void hostCtx.host.handleSelectSession(item.sessionId);
            }
          }}
        />
      ))}
      <FullButton
        onClick={() => {
          clearMobileCatchUpDraft();
          dispatch({ type: 'close-sheet' });
        }}
      >
        知道了
      </FullButton>
    </>
  );
}
