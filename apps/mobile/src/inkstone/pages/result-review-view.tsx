import type { ReactElement } from 'react';
import { MobileDiffViewer } from '../../components/chat/MobileDiffViewer.js';
import { FullButton, ListRow, ScreenHeading, TabsRow } from '../inkstone-ui.js';
import { resultKey, verificationLabel } from './review-model.js';
import type { useResultReview } from './use-result-review.js';

type Props = { review: ReturnType<typeof useResultReview> };
export function ResultReviewView({ review }: Props): ReactElement {
  const { snapshot: state } = review;
  const { result, diff } = state;
  return <>
    <div role="group" aria-label="结果筛选">
      <TabsRow items={['待处理结果', '全部公开结果']} selected={review.pendingOnly ? '待处理结果' : '全部公开结果'}
        onSelect={(value) => review.setPendingOnly(value === '待处理结果')} />
    </div>
    <p className="muted">Host · 已加载 {state.results.length} 个结果；{state.resultCursor === undefined ? '当前返回页无后续游标' : '还有后续页'}，Host 未公开总数。</p>
    {state.disconnected ? <p role="status" className="muted">Host 已断开；快照已失效，旧引用不代表当前状态。重连后重新读取。</p> : state.stale ?
      <p role="status" className="muted">快照已失效/过期；旧引用不代表当前状态，请等待读取完成或刷新。</p> : null}
    {state.resultsLoading ? <p role="status">正在读取 Host 结果页…</p> : null}
    {state.resultsError !== undefined ? <p role="alert" className="error-text">{state.resultsError}</p> : null}
    <FullButton variant="secondary" disabled={state.resultsLoading || state.disconnected} onClick={review.refresh}>刷新公开结果</FullButton>
    <div aria-label="Host 结果列表" aria-busy={state.resultsLoading}>
      {state.results.map((item) => <ListRow key={resultKey(item)} name="file"
        title={`结果 ${item.resultId} · r${item.revision}`}
        subtitle={`执行 ${item.executionStatus ?? '未知'} · 合入 ${item.integrationStatus ?? '未知'}`}
        selected={result !== undefined && resultKey(item) === resultKey(result)}
        trailing={result !== undefined && resultKey(item) === resultKey(result) ? '当前结果' : '选择'}
        onClick={() => review.selectResult(resultKey(item))} />)}
    </div>
    {state.resultCursor !== undefined ? <FullButton variant="secondary" disabled={state.resultsLoading || state.stale} onClick={review.moreResults}>加载更多结果</FullButton> : null}
    {result === undefined && !state.resultsLoading && state.resultsError === undefined ?
      <ScreenHeading title="Host 未返回结果条目" subtitle={review.pendingOnly ? '当前待处理筛选页为空；可查看全部公开结果' : '当前公开结果页为空'} /> : null}
    {result !== undefined ? <>
      <ScreenHeading title="Host 返回的结果快照" subtitle={`会话 ${result.parentSessionId} · ${result.resultId} · r${result.revision}`} />
      <div className="quote-note">
        执行：{result.executionStatus ?? '未知'} · 摘要：{result.summaryStatus ?? '未知'} · 合入：{result.integrationStatus ?? '未知'}
        <br />审阅：{result.reviewStatus ?? '未公开'} · latestReview：{result.latestReview === undefined ? '未公开引用' : `${result.latestReview.reviewId} · r${result.latestReview.revision}`}
        <br />latestVerification：{result.latestVerification === undefined ? '未公开引用' : `${result.latestVerification.verificationId} · r${result.latestVerification.revision}`}
        <br />{verificationLabel(result, state.verification)}
      </div>
      {state.verificationLoading ? <p role="status">正在读取所选结果的公开验收状态…</p> : null}
      {state.verificationError !== undefined ? <p className="muted">{state.verificationError} 验收状态未公开/无法确认。</p> : null}
      <div aria-label="Host 公开可用性" className="quote-note">
        {(['view', 'apply', 'resolve', 'cleanup'] as const).map((key) => {
          const action = result.availability[key];
          return <p key={key}>
            {key}：{action === undefined ? '未公开/无法确认' : action.allowed ? 'Host 允许' : 'Host 不允许'}
            {action?.reason !== undefined ? ` · ${action.reason}` : ''}
          </p>;
        })}
      </div>
      <p className="muted">Host · 已加载 {state.files.length} 个文件引用；{state.fileCursor === undefined ? '当前返回页无后续游标' : '还有后续页'}。未公开文件总数/整体增删数；路径仅用于显示。</p>
      {state.filesLoading ? <p role="status">正在读取精确结果版本的文件页…</p> : null}
      {state.filesError !== undefined ? <p role="alert" className="error-text">{state.filesError}</p> : null}
      {!state.stale && !state.filesLoading && state.filesError === undefined && state.files.length === 0 ?
        <p className="muted">Host返回空列表，无法确认确无变更或快照可用</p> : null}
      <div aria-label="Host 文件引用" aria-busy={state.filesLoading}>
        {state.files.map((file) => <ListRow key={file.fileId} name="file" title={file.relativePath}
          subtitle={`${file.kind} · 增删数未读取`} selected={file.fileId === state.fileId}
          trailing={file.fileId === state.fileId ? '当前文件' : '查看 Diff'}
          onClick={() => review.selectFile(file.fileId)} />)}
      </div>
      {state.fileCursor !== undefined ? <FullButton variant="secondary" disabled={state.filesLoading || state.stale} onClick={review.moreFiles}>加载更多文件</FullButton> : null}
      {state.fileId === undefined ? <p className="muted">选择文件后按需读取 Diff（不会预先读取前 12 个文件）。</p> : <>
        <p className="muted">Host · {result.resultId} · r{result.revision} · 文件 {state.fileId}</p>
        {state.diffLoading ? <p role="status">正在读取所选文件 Diff…</p> : null}
        {!state.stale && !state.diffLoading && diff === undefined && state.diffError === undefined ?
          <p className="muted">Diff 快照已清除，点击所选文件重新读取。</p> : null}
        {state.diffError !== undefined ? <p role="alert" className="error-text">{state.diffError}</p> : null}
        {diff !== undefined ? <>
          <p className="muted">Host 返回增删数（未确认快照可用）：{diff.additions === null ? '新增未知' : `+${diff.additions}`} / {diff.deletions === null ? '删除未知' : `−${diff.deletions}`}；零计数不证明无变更。</p>
          <p className="muted">Host未提供完整性标记/仅显示所返回内容，无法确认完整Diff</p>
          {diff.locallyClipped ? <p className="muted">客户端显示已截断至 64 Ki 字符；与 Host 完整性未知分开标记。</p> : null}
          {diff.binary === true ? <p className="muted">Host 标记为二进制文件，未提供可确认的文本 Diff。</p> : diff.patch !== undefined && diff.patch.length > 0 ?
            <MobileDiffViewer diffText={diff.patch} /> : <p className="muted">Host 未返回文本补丁或返回空补丁，无法确认无变更或快照可用。</p>}
          {diff.binary === undefined ? <p className="muted">Host 未公开二进制标记。</p> : null}
        </> : null}
      </>}
    </> : null}
  </>;
}
