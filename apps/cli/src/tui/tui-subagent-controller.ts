import type { HostPush, SessionSummary, SubagentInvocation, SubagentResultSummary } from '@piwin/contracts';
import { projectSubagentToolLine, type SubagentPreviewStatus } from '@piwin/host-client';
import { toLiveRun, type LiveSubagentRun } from './subagent-run-view.js';
import { ChoiceOverlay } from './choice-overlay.js';
import {
  childLabel,
  describeChildChange,
  describeSubagents,
  latestResultFor,
  needsDecision,
  subagentItems,
  toSubagentChild,
  type SubagentChild,
} from './subagent-view.js';
import {
  applySubagentStreamEvent,
  EMPTY_SUBAGENT_TAIL,
  runningSubagentTool,
  type SubagentLiveTail,
  type SubagentPendingPermission,
} from './subagent-live-tail.js';
import { TuiSubagentPreview, type SubagentPreviewData, type SubagentResultAction } from './tui-subagent-preview.js';
import { hostData, type TuiHostLink } from './tui-host-link.js';
import type { TuiModalStack } from './tui-modals.js';
import { ViewerOverlay } from './viewer-overlay.js';

const RESULT_PAGE_LIMIT = 100;
const FILE_PAGE_LIMIT = 200;
/** Step lines kept per child for Ctrl+O under a running fan-out row. */
const RECENT_STEPS = 3;

type ResultFile = { fileId: string; relativePath: string; kind: 'added' | 'modified' | 'deleted' };

const FILE_KIND: Record<ResultFile['kind'], string> = { added: '新增', modified: '修改', deleted: '删除' };

const PREVIEW_STATUS: Record<SubagentInvocation['status'], SubagentPreviewStatus> = {
  queued: 'queued',
  starting: 'running',
  running: 'running',
  completed: 'completed',
  'needs-integration': 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};

const CHILD_PREVIEW_STATUS: Record<NonNullable<SessionSummary['subagentStatus']>, SubagentPreviewStatus> = {
  running: 'running',
  done: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};

export type TuiSubagentControllerOptions = {
  link: TuiHostLink;
  modals: TuiModalStack;
  getSessionId: () => string | undefined;
  /** A child asks for permission: queue the regular permission dialog, naming the child. */
  askChildPermission: (request: SubagentPendingPermission, childLabel: string) => void;
  /** A permission was answered (here or elsewhere): drop its queued dialog. */
  dropPermission: (requestId: string) => void;
  onChanged: () => void;
  onHint: (text: string) => void;
  onNotice: (tone: 'info' | 'error', text: string) => void;
  onError: (error: unknown) => void;
};

/**
 * Children of the session on screen: live rows for the transcript, a dense
 * preview per child, and what to do with their results. Whether a result may
 * be applied, resolved or cleaned up is the Host's call; this shell shows the
 * Host's `availability` and sends the chosen action. Observation only: there
 * is no way into a child session and no message to a child.
 */
export class TuiSubagentController {
  private children: SubagentChild[] = [];
  private readonly summaries = new Map<string, SessionSummary>();
  private results: SubagentResultSummary[] = [];
  /** Live per-invocation state from `subagent/invocation-updated`, keyed by invocation id. */
  private readonly liveRuns = new Map<string, LiveSubagentRun>();
  private readonly invocations = new Map<string, SubagentInvocation>();
  /** What `subagent/stream` said per child since its last message. */
  private readonly tails = new Map<string, SubagentLiveTail>();
  private readonly preview: TuiSubagentPreview;
  /** Bumped whenever live run state changes, so the transcript knows to redraw. */
  public liveVersion = 0;

  public constructor(private readonly options: TuiSubagentControllerOptions) {
    this.preview = new TuiSubagentPreview({
      link: options.link,
      modals: options.modals,
      data: (childSessionId) => this.previewData(childSessionId),
      act: (action, childSessionId, result) => this.run(action, childSessionId, result),
      dropPermission: options.dropPermission,
      back: () => this.open(),
      onChanged: options.onChanged,
      onHint: options.onHint,
      onError: options.onError,
    });
  }

  public describe(): string | undefined {
    return describeSubagents(this.children, this.results);
  }

  /** The transcript's view of a run: by invocation id, else the newest invocation of the batch run. */
  public readonly lookupRun = (invocationId: string | undefined, runId: string): LiveSubagentRun | undefined => {
    if (invocationId !== undefined) return this.liveRuns.get(invocationId);
    let found: LiveSubagentRun | undefined;
    for (const run of this.liveRuns.values()) if (run.runId === runId) found = run;
    return found;
  };

  /** A synchronous `piwin_subagent_run` row: the invocation its tool call created. */
  public readonly lookupRunByToolCall = (toolCallId: string): LiveSubagentRun | undefined => {
    for (const run of this.liveRuns.values()) if (run.parentToolCallId === toolCallId) return run;
    return undefined;
  };

  /** Whether any invocation is still going (elapsed counters need a tick). */
  public hasRunningInvocations(): boolean {
    for (const run of this.liveRuns.values()) if (run.endedAt === undefined) return true;
    return false;
  }

  public reset(): void {
    this.liveRuns.clear();
    this.invocations.clear();
    this.tails.clear();
    this.preview.close();
    this.liveVersion += 1;
    this.children = [];
    this.summaries.clear();
    this.results = [];
  }

  /** Best effort: a Host without subagent orchestration simply has none to show. */
  public async load(sessionId: string): Promise<void> {
    const [children, results] = await Promise.all([
      this.options.link.request({ type: 'session/list-children', parentSessionId: sessionId }),
      this.options.link.request({ type: 'subagent/results', parentSessionId: sessionId, limit: RESULT_PAGE_LIMIT }),
    ]);
    if (this.options.getSessionId() !== sessionId) return;
    const data = children.success
      ? (children.data as { sessions?: SessionSummary[]; invocations?: SubagentInvocation[] })
      : {};
    for (const summary of data.sessions ?? []) this.remember(summary);
    this.children = (data.sessions ?? []).map(toSubagentChild);
    for (const invocation of data.invocations ?? []) this.applyInvocation(invocation);
    this.results = results.success ? ((results.data as { items?: SubagentResultSummary[] }).items ?? []) : [];
  }

  /** Returns true when the push was about this session's children. */
  public handlePush(push: HostPush): boolean {
    const sessionId = this.options.getSessionId();
    switch (push.type) {
      case 'subagent/updated': {
        if (push.parentSessionId !== sessionId) return true;
        this.remember(push.child);
        const next = toSubagentChild(push.child);
        const previous = this.children.find((child) => child.sessionId === next.sessionId);
        this.children = [...this.children.filter((child) => child.sessionId !== next.sessionId), next];
        const notice = describeChildChange(previous, next);
        if (notice !== undefined) this.options.onNotice(next.subagentStatus === 'failed' ? 'error' : 'info', notice);
        this.options.onChanged();
        return true;
      }
      case 'subagent/invocation-updated':
        if (push.parentSessionId !== sessionId) return true;
        if (this.applyInvocation(push.invocation)) this.options.onChanged();
        return true;
      case 'subagent/result-updated':
        if (push.parentSessionId !== sessionId) return true;
        this.results = [...this.results.filter((result) => result.resultId !== push.result.resultId), push.result];
        this.options.onChanged();
        return true;
      case 'subagent/stream':
        if (push.parentSessionId === sessionId) this.applyStream(push.childSessionId, push.event);
        return true;
      default:
        return false;
    }
  }

  /** `/subagents`: pick a child, see its preview. */
  public open(): void {
    if (this.children.length === 0) {
      this.options.onHint('这个会话没有子代理');
      return;
    }
    const { modals } = this.options;
    modals.show(
      new ChoiceOverlay({
        title: '子代理',
        items: subagentItems(this.children, this.results),
        footer: '↑↓ 选择 · Enter 预览 · Esc 关闭',
        onSelect: (childSessionId) => this.preview.open(childSessionId),
        onCancel: () => modals.close(),
      }),
    );
  }

  private remember(summary: SessionSummary & { sessionId?: string }): void {
    this.summaries.set(summary.sessionId ?? summary.id, summary);
  }

  /** Revisions are monotonic per invocation; a replayed or late push is ignored. */
  private applyInvocation(invocation: SubagentInvocation): boolean {
    const known = this.invocations.get(invocation.id);
    if (known !== undefined && known.revision >= invocation.revision) return false;
    this.invocations.set(invocation.id, invocation);
    this.liveRuns.set(invocation.id, toLiveRun(invocation, this.liveRuns.get(invocation.id)));
    this.liveVersion += 1;
    return true;
  }

  private applyStream(childSessionId: string, event: Extract<HostPush, { type: 'subagent/stream' }>['event']): void {
    const before = this.tails.get(childSessionId) ?? EMPTY_SUBAGENT_TAIL;
    const after = applySubagentStreamEvent(before, event);
    if (after === before) return;
    this.tails.set(childSessionId, after);
    if (event.type === 'permission/request' && after.permission !== null) {
      this.options.askChildPermission(after.permission, `子代理「${this.labelOf(childSessionId)}」`);
    } else if (event.type === 'permission/resolved') {
      this.options.dropPermission(event.requestId);
    }
    const stepChanged = event.type === 'tool/start' || event.type === 'tool/end' || event.type === 'message/start';
    if (stepChanged) this.updateStep(childSessionId, after);
    this.preview.childUpdated(childSessionId, after);
    if (stepChanged && !this.preview.isOpenFor(childSessionId)) this.options.onChanged();
  }

  /** The fan-out row shows the call a child is running now, worded like the preview. */
  private updateStep(childSessionId: string, tail: SubagentLiveTail): void {
    const entry = [...this.liveRuns.entries()].find(([, run]) => run.childSessionId === childSessionId);
    if (entry === undefined) return;
    const [invocationId, run] = entry;
    const root = this.summaries.get(childSessionId)?.workingDirectory;
    const describe = (tool: SubagentLiveTail['tools'][number]): string => {
      const line = projectSubagentToolLine(tool, Number.NaN, root);
      return `${line.verb} ${line.target}`.trim();
    };
    const running = runningSubagentTool(tail);
    const recent = tail.tools.slice(-RECENT_STEPS).map((tool) => {
      const mark = tool.status === 'running' ? '…' : tool.status === 'error' ? '✗' : '✓';
      return `${mark} ${describe(tool)}`;
    });
    const { step: _previousStep, ...rest } = run;
    this.liveRuns.set(invocationId, {
      ...rest,
      ...(running === undefined ? {} : { step: describe(running) }),
      ...(recent.length === 0 ? {} : { recentSteps: recent }),
    });
    this.liveVersion += 1;
  }

  private labelOf(childSessionId: string): string {
    const run = [...this.liveRuns.values()].find((candidate) => candidate.childSessionId === childSessionId);
    return run?.title ?? childLabel(this.children.find((child) => child.sessionId === childSessionId), '子代理');
  }

  private previewData(childSessionId: string): SubagentPreviewData {
    const invocation = [...this.invocations.values()]
      .filter((candidate) => candidate.childSessionId === childSessionId)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
    const child = this.summaries.get(childSessionId);
    const childStatus = this.children.find((entry) => entry.sessionId === childSessionId)?.subagentStatus;
    const result = latestResultFor(childSessionId, this.results);
    return {
      label: this.labelOf(childSessionId),
      status:
        invocation !== undefined
          ? PREVIEW_STATUS[invocation.status]
          : childStatus !== undefined
            ? CHILD_PREVIEW_STATUS[childStatus]
            : 'running',
      ...(invocation === undefined ? {} : { invocation }),
      ...(child === undefined ? {} : { child }),
      tail: this.tails.get(childSessionId) ?? EMPTY_SUBAGENT_TAIL,
      ...(result === undefined ? {} : { result }),
      pendingDecision: result !== undefined && needsDecision(result),
    };
  }

  private async run(action: SubagentResultAction, childSessionId: string, result: SubagentResultSummary): Promise<void> {
    const { resultId, revision } = result;
    const { link } = this.options;
    switch (action) {
      case 'files':
        await this.showFiles(result, childSessionId);
        return;
      case 'apply':
        hostData(await link.request({ type: 'subagent/worktree-action', action: 'apply', resultId, expectedRevision: revision }));
        this.options.onNotice('info', '子代理的改动已应用到工作区');
        return;
      case 'retain':
        hostData(await link.request({ type: 'subagent/worktree-action', action: 'retain', resultId, expectedRevision: revision }));
        this.options.onHint('已保留，改动仍在子代理的副本里');
        return;
      case 'resolve':
        hostData(await link.request({ type: 'subagent/request-resolution', resultId, expectedRevision: revision, purpose: 'resolve' }));
        this.options.onNotice('info', '已请主会话处理冲突');
        return;
      case 'discard':
        await this.discard(result, childSessionId);
        return;
    }
  }

  /** Cleanup is two-step on the Host: plan it, then spend the plan's token. */
  private async discard(result: SubagentResultSummary, childSessionId: string): Promise<void> {
    const { link, modals } = this.options;
    const plan = hostData<{ token: string }>(
      await link.request({ type: 'subagent/cleanup-plan', resultId: result.resultId, expectedRevision: result.revision }),
    );
    modals.show(
      new ChoiceOverlay({
        title: '丢弃子代理的副本',
        message: '会删除这个子代理的工作副本。已冻结的结果仍可查看；没应用的改动不会进入工作区。',
        items: [
          { value: 'cancel', label: '不丢弃' },
          { value: 'discard', label: '丢弃副本' },
        ],
        onSelect: (value) => {
          this.preview.open(childSessionId);
          if (value !== 'discard') return;
          link
            .request({
              type: 'subagent/worktree-action',
              action: 'discard',
              resultId: result.resultId,
              expectedRevision: result.revision,
              cleanupToken: plan.token,
            })
            .then(hostData)
            .then(() => this.options.onHint('副本已丢弃'))
            .catch(this.options.onError);
        },
        onCancel: () => this.preview.open(childSessionId),
      }),
    );
  }

  private async showFiles(result: SubagentResultSummary, childSessionId: string): Promise<void> {
    const { link, modals } = this.options;
    const page = hostData<{ files: ResultFile[]; nextCursor?: string }>(
      await link.request({
        type: 'subagent/result-files',
        resultId: result.resultId,
        revision: result.revision,
        limit: FILE_PAGE_LIMIT,
      }),
    );
    if (page.files.length === 0) {
      this.options.onHint('这个结果没有改动文件');
      return;
    }
    modals.show(
      new ChoiceOverlay({
        title: `改动的文件（${page.files.length}${page.nextCursor === undefined ? '' : '+'}）`,
        items: page.files.map((file) => ({
          value: file.fileId,
          label: file.relativePath,
          description: FILE_KIND[file.kind],
        })),
        onSelect: (fileId) => {
          const file = page.files.find((entry) => entry.fileId === fileId);
          if (file !== undefined) this.showDiff(result, file, childSessionId).catch(this.options.onError);
        },
        // Back to the preview the list was opened from.
        onCancel: () => this.preview.open(childSessionId),
      }),
    );
  }

  private async showDiff(result: SubagentResultSummary, file: ResultFile, childSessionId: string): Promise<void> {
    const { link, modals } = this.options;
    const diff = hostData<{ additions: number; deletions: number; binary: boolean; patch?: string }>(
      await link.request({
        type: 'subagent/result-diff',
        resultId: result.resultId,
        revision: result.revision,
        fileId: file.fileId,
      }),
    );
    const lines = diff.binary
      ? ['二进制文件，不显示内容']
      : (diff.patch ?? '').length === 0
        ? ['没有可显示的差异']
        : (diff.patch ?? '').split('\n');
    modals.show(
      new ViewerOverlay({
        title: `${file.relativePath}  +${diff.additions} −${diff.deletions}`,
        lines,
        // Back to the file list: reviewing a result means reading several files.
        onClose: () => {
          this.showFiles(result, childSessionId).catch(this.options.onError);
        },
      }),
    );
  }
}
