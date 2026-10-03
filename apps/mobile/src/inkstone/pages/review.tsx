import type { ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import { useInkstone } from '../inkstone-context.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { FullButton, IconButton, ScreenHeading, TopBar } from '../inkstone-ui.js';
import { ResultReviewView } from './result-review-view.js';
import { useResultReview } from './use-result-review.js';

export function ReviewPage(): ReactElement {
  const hostCtx = useInkstoneHost();
  return hostCtx === null ? <NeedsHost /> : <ConnectedReviewPage hostCtx={hostCtx} />;
}
function ConnectedReviewPage({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const ready = host.connectionState.kind === 'ready' && hostCtx.offlineSnapshot === undefined;
  const review = useResultReview(host.client, host.activeSessionId, ready);
  const goChat = () => dispatch({ type: 'navigate', route: 'chat' });
  return <>
    <TopBar title="审阅变更" subtitle={`Host · ${host.activeSessionId ?? '未选择会话'}`} onBack={goChat}
      right={ready && review.snapshot.result !== undefined ? <IconButton name="more" label="审阅选项"
        onClick={() => dispatch({ type: 'open-sheet', key: 'review-options' })} /> : undefined} />
    <div className="screen-scroll">
      {!ready || host.client === undefined ? <>
        <ScreenHeading title={host.connectionState.kind === 'disconnected' ? 'Host 已断开' : 'Host 尚未就绪'} subtitle="旧快照已失效；不会展示本地伪造差异" />
        <p className="muted">连接后读取当前会话的真实公开结果。</p>
      </> : host.activeSessionId === undefined ? <>
        <ScreenHeading title="还没有选中会话" subtitle="先打开一个 Host 会话" />
        <FullButton variant="secondary" onClick={() => dispatch({ type: 'navigate', route: 'sessions' })}>返回会话</FullButton>
      </> : <ResultReviewView review={review} />}
      <FullButton variant="secondary" onClick={goChat}>回到对话</FullButton>
    </div>
  </>;
}
