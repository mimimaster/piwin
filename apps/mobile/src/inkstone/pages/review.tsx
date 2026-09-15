import { useEffect, useState, type ReactElement } from 'react';
import type { HostResponse } from '@piwin/contracts';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../demo-state.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { FullButton, IconButton, ListRow, Pill, ScreenHeading, TopBar } from '../inkstone-ui.js';
import { MobileDiffViewer } from '../../components/chat/MobileDiffViewer.js';

const DIFF_LINES: { className: string; line: number; code: string; commentable?: boolean }[] = [
  { className: '', line: 41, code: '  async restoreSession(id) {' },
  { className: 'remove', line: 42, code: '−   return createSession(id);' },
  {
    className: 'add commentable',
    line: 42,
    code: '+   const saved = await store.get(id);',
    commentable: true,
  },
  { className: 'add', line: 43, code: '+   if (!saved) return createSession(id);' },
  { className: 'add', line: 44, code: '+   return hydrateSession(saved);' },
  { className: '', line: 45, code: '  }' },
];

export function DiffCard(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <div className="diff-card">
      <div className="diff-heading">
        <span>session-index.ts</span>
        <span>
          <span className="green">+24</span> <span className="red">−6</span>
        </span>
      </div>
      <div className="diff-lines" aria-label="统一代码差异">
        {DIFF_LINES.map((entry, index) => (
          <div
            key={index}
            className={`diff-line ${entry.className}`.trim()}
            role={entry.commentable === true ? 'button' : undefined}
            tabIndex={entry.commentable === true ? 0 : undefined}
            onClick={
              entry.commentable === true
                ? () => dispatch({ type: 'open-sheet', key: 'comment' })
                : undefined
            }
            onKeyDown={
              entry.commentable === true
                ? (event) => {
                    if (event.key === 'Enter') dispatch({ type: 'open-sheet', key: 'comment' });
                  }
                : undefined
            }
            aria-label={entry.commentable === true ? `评论第${entry.line}行` : undefined}
          >
            <em>{entry.line}</em>
            {entry.code}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReviewPage(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx !== null) {
    return <ConnectedReviewPage hostCtx={hostCtx} />;
  }
  return <DemoReviewPage />;
}

function DemoReviewPage(): ReactElement {
  const { state, dispatch } = useInkstone();
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  return (
    <>
      <TopBar
        title="审阅变更"
        subtitle="piwin · 当前会话"
        onBack={go('chat')}
        right={<IconButton name="more" label="审阅选项" onClick={openSheet('review-options')} />}
      />
      <div className="screen-scroll">
        <ScreenHeading
          title={'看看这一轮，\n落下了哪些笔。'}
          subtitle="统一差异 · 点击新增行可留下意见"
        />
        <div className="diff-stats">
          <strong>3</strong>
          <span className="muted">个文件</span>
          <span className="green">+48</span>
          <span className="red">−12</span>
        </div>
        <ListRow
          name="file"
          title="session-index.ts"
          subtitle="会话恢复 · +24 −6"
          onClick={openSheet('file')}
          trailing="M"
        />
        <ListRow
          name="file"
          title="draft-store.ts"
          subtitle="草稿存储 · +18 −0"
          onClick={openSheet('file')}
          trailing="A"
        />
        <ListRow
          name="file"
          title="session-index.test.ts"
          subtitle="恢复路径测试 · +6 −6"
          onClick={openSheet('file')}
          trailing="M"
        />
        <DiffCard />
        {state.comment !== '' ? (
          <div className="quote-note">
            你的批注
            <br />
            {state.comment}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 11 }}>
            ↳ 点绿色新增行，写一条批注
          </p>
        )}
        <div className="section-label">
          验证结果 <Pill variant="pine">已通过</Pill>
        </div>
        <div className="command">
          ✓ session restore　8 tests
          <br />
          ✓ draft persistence　6 tests
          <br />✓ typecheck
        </div>
        <p className="muted" style={{ fontSize: 11 }}>
          以上为原型示例结果。
        </p>
      </div>
      <div className="bottom-action">
        <FullButton variant="secondary" onClick={() => dispatch({ type: 'mark-reviewed' })}>
          {state.reviewDone ? '已标记看过 ✓' : '标记已看过'}
        </FullButton>
        <FullButton variant="subtle" onClick={go('chat')}>
          继续对话
        </FullButton>
      </div>
    </>
  );
}

type ReviewResult = {
  resultId: string;
  revision: number;
  executionStatus?: string;
  summaryStatus?: string;
  integrationStatus?: string;
};

type ReviewFile = {
  fileId: string;
  relativePath: string;
  kind: 'added' | 'modified' | 'deleted';
  additions: number | null;
  deletions: number | null;
  binary: boolean;
  patch?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readReviewResults(response: HostResponse): ReviewResult[] {
  if (!response.success || !isRecord(response.data) || !Array.isArray(response.data.items)) {
    return [];
  }
  return response.data.items.flatMap((value): ReviewResult[] => {
    if (
      !isRecord(value) ||
      typeof value.resultId !== 'string' ||
      typeof value.revision !== 'number' ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0
    ) {
      return [];
    }
    return [
      {
        resultId: value.resultId,
        revision: value.revision,
        ...(typeof value.executionStatus === 'string'
          ? { executionStatus: value.executionStatus }
          : {}),
        ...(typeof value.summaryStatus === 'string' ? { summaryStatus: value.summaryStatus } : {}),
        ...(typeof value.integrationStatus === 'string'
          ? { integrationStatus: value.integrationStatus }
          : {}),
      },
    ];
  });
}

function readReviewFiles(response: HostResponse): Array<Pick<ReviewFile, 'fileId' | 'relativePath' | 'kind'>> {
  if (!response.success || !isRecord(response.data) || !Array.isArray(response.data.files)) {
    return [];
  }
  return response.data.files.flatMap((value) => {
    if (
      !isRecord(value) ||
      typeof value.fileId !== 'string' ||
      typeof value.relativePath !== 'string' ||
      (value.kind !== 'added' && value.kind !== 'modified' && value.kind !== 'deleted')
    ) {
      return [];
    }
    return [{ fileId: value.fileId, relativePath: value.relativePath, kind: value.kind }];
  });
}

function readReviewDiff(
  response: HostResponse,
  file: Pick<ReviewFile, 'fileId' | 'relativePath' | 'kind'>,
): ReviewFile | undefined {
  if (!response.success || !isRecord(response.data)) return undefined;
  const additions =
    typeof response.data.additions === 'number' && Number.isSafeInteger(response.data.additions)
      ? response.data.additions
      : null;
  const deletions =
    typeof response.data.deletions === 'number' && Number.isSafeInteger(response.data.deletions)
      ? response.data.deletions
      : null;
  return {
    ...file,
    additions,
    deletions,
    binary: response.data.binary === true,
    ...(typeof response.data.patch === 'string' ? { patch: response.data.patch } : {}),
  };
}

function ConnectedReviewPage({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const client = host.client;
  const sessionId = host.activeSessionId;
  const [result, setResult] = useState<ReviewResult | undefined>();
  const [files, setFiles] = useState<ReviewFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setResult(undefined);
    setFiles([]);
    setSelectedFileId(undefined);
    const load = async (): Promise<void> => {
      if (client === undefined || sessionId === undefined) {
        setLoading(false);
        return;
      }
      if (!client.supportsCommand('subagent/results')) {
        setError('当前 Host 未开放子代理结果审阅。');
        setLoading(false);
        return;
      }
      try {
        const resultsResponse = await client.request({
          type: 'subagent/results',
          parentSessionId: sessionId,
          pendingOnly: true,
          limit: 20,
        });
        if (cancelled) return;
        if (!resultsResponse.success) {
          setError(resultsResponse.error);
          setLoading(false);
          return;
        }
        const currentResult = readReviewResults(resultsResponse)[0];
        if (currentResult === undefined) {
          setLoading(false);
          return;
        }
        setResult(currentResult);
        if (!client.supportsCommand('subagent/result-files')) {
          setError('Host 未开放变更文件读取。');
          setLoading(false);
          return;
        }
        const filesResponse = await client.request({
          type: 'subagent/result-files',
          resultId: currentResult.resultId,
          revision: currentResult.revision,
          limit: 32,
        });
        if (cancelled) return;
        const fileRefs = readReviewFiles(filesResponse);
        if (!client.supportsCommand('subagent/result-diff')) {
          setFiles(
            fileRefs.map((file) => ({
              ...file,
              additions: null,
              deletions: null,
              binary: false,
            })),
          );
          setSelectedFileId(fileRefs[0]?.fileId);
          setError('Host 未开放文本 Diff 读取。');
          setLoading(false);
          return;
        }
        const loadedFiles = await Promise.all(
          fileRefs.slice(0, 12).map(async (file) => {
            const diffResponse = await client.request({
              type: 'subagent/result-diff',
              resultId: currentResult.resultId,
              revision: currentResult.revision,
              fileId: file.fileId,
            });
            return readReviewDiff(diffResponse, file);
          }),
        );
        if (cancelled) return;
        const nextFiles = loadedFiles.filter((file): file is ReviewFile => file !== undefined);
        setFiles(nextFiles);
        setSelectedFileId(nextFiles[0]?.fileId);
        setLoading(false);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '读取 Host 变更失败。');
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, sessionId]);

  const goChat = () => dispatch({ type: 'navigate', route: 'chat' });
  const selectedFile = files.find((file) => file.fileId === selectedFileId);
  const additions = files.reduce((sum, file) => sum + (file.additions ?? 0), 0);
  const deletions = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0);

  return (
    <>
      <TopBar
        title="审阅变更"
        subtitle={sessionId === undefined ? 'Host · 未选择会话' : 'Host · 当前会话'}
        onBack={goChat}
        right={
          result !== undefined ? (
            <IconButton
              name="more"
              label="审阅选项"
              onClick={() => dispatch({ type: 'open-sheet', key: 'review-options' })}
            />
          ) : undefined
        }
      />
      <div className="screen-scroll">
        {client === undefined ? (
          <>
            <ScreenHeading title="正在连接 Host" subtitle="不会展示本地伪造差异" />
            <p className="muted">连接后会读取当前会话的真实变更。</p>
          </>
        ) : sessionId === undefined ? (
          <>
            <ScreenHeading title="还没有选中会话" subtitle="先打开一个 Host 会话" />
            <FullButton variant="secondary" onClick={() => dispatch({ type: 'navigate', route: 'sessions' })}>
              返回会话
            </FullButton>
          </>
        ) : loading ? (
          <>
            <ScreenHeading title="正在读取变更" subtitle="请求 Host 子任务结果" />
            <p className="muted">正在同步文件列表和 Diff。</p>
          </>
        ) : result === undefined ? (
          <>
            <ScreenHeading title="暂无待审阅变更" subtitle="Host 未返回 pending 子任务结果" />
            {error !== undefined ? <p className="error-text">{error}</p> : null}
            <FullButton variant="secondary" onClick={goChat}>
              回到对话
            </FullButton>
          </>
        ) : (
          <>
            <ScreenHeading title="Host 返回的变更" subtitle={`结果 ${result.resultId} · rev ${result.revision}`} />
            <div className="diff-stats">
              <strong>{files.length}</strong>
              <span className="muted">个文件</span>
              <span className="green">+{additions}</span>
              <span className="red">−{deletions}</span>
            </div>
            {error !== undefined ? <p className="error-text">{error}</p> : null}
            {files.map((file) => (
              <ListRow
                key={file.fileId}
                name="file"
                title={file.relativePath}
                subtitle={`${file.kind} · ${file.additions === null ? '—' : `+${file.additions}`} ${file.deletions === null ? '—' : `−${file.deletions}`}`}
                onClick={() => setSelectedFileId(file.fileId)}
                trailing={file.fileId === selectedFileId ? '查看' : undefined}
              />
            ))}
            {selectedFile?.binary ? (
              <p className="muted">{selectedFile.relativePath} 是二进制文件，Host 未提供文本 Diff。</p>
            ) : selectedFile?.patch !== undefined ? (
              <MobileDiffViewer diffText={selectedFile.patch} />
            ) : (
              <p className="muted">Host 未返回所选文件的文本 Diff。</p>
            )}
            <div className="quote-note">
              执行：{result.executionStatus ?? '未知'} · 摘要：{result.summaryStatus ?? '未知'} · 合入：
              {result.integrationStatus ?? '未知'}
            </div>
            <FullButton variant="secondary" onClick={goChat}>
              继续对话
            </FullButton>
          </>
        )}
      </div>
    </>
  );
}
