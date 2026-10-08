import type { HostPush, SessionSummary, SubagentResultSummary } from '@piwin/contracts';
import { ChoiceOverlay } from './choice-overlay.js';
import {
  childActionItems,
  childLabel,
  describeChildChange,
  describeSubagents,
  latestResultFor,
  subagentItems,
  toSubagentChild,
  type ResultAction,
  type SubagentChild,
} from './subagent-view.js';
import { hostData, type TuiHostLink } from './tui-host-link.js';
import type { TuiModalStack } from './tui-modals.js';
import { ViewerOverlay } from './viewer-overlay.js';

const RESULT_PAGE_LIMIT = 100;
const FILE_PAGE_LIMIT = 200;

type ResultFile = { fileId: string; relativePath: string; kind: 'added' | 'modified' | 'deleted' };

const FILE_KIND: Record<ResultFile['kind'], string> = { added: '新增', modified: '修改', deleted: '删除' };

export type TuiSubagentControllerOptions = {
  link: TuiHostLink;
  modals: TuiModalStack;
  /** Desktop owns which session is on screen when embedded. */
  embedded: boolean;
  getSessionId: () => string | undefined;
  openSession: (sessionId: string) => Promise<void>;
  onChanged: () => void;
  onHint: (text: string) => void;
  onNotice: (tone: 'info' | 'error', text: string) => void;
  onError: (error: unknown) => void;
};

/**
 * Child sessions of the session on screen and what to do with their results.
 * Whether a result may be applied, resolved or cleaned up is the Host's call;
 * this shell shows the Host's `availability` and sends the chosen action.
 */
export class TuiSubagentController {
  private children: SubagentChild[] = [];
  private results: SubagentResultSummary[] = [];

  public constructor(private readonly options: TuiSubagentControllerOptions) {}

  public describe(): string | undefined {
    return describeSubagents(this.children, this.results);
  }

  public reset(): void {
    this.children = [];
    this.results = [];
  }

  /** Best effort: a Host without subagent orchestration simply has none to show. */
  public async load(sessionId: string): Promise<void> {
    const [children, results] = await Promise.all([
      this.options.link.request({ type: 'session/list-children', parentSessionId: sessionId }),
      this.options.link.request({ type: 'subagent/results', parentSessionId: sessionId, limit: RESULT_PAGE_LIMIT }),
    ]);
    if (this.options.getSessionId() !== sessionId) return;
    this.children = children.success
      ? ((children.data as { sessions?: SessionSummary[] }).sessions ?? []).map(toSubagentChild)
      : [];
    this.results = results.success ? ((results.data as { items?: SubagentResultSummary[] }).items ?? []) : [];
  }

  /** Returns true when the push was about this session's children. */
  public handlePush(push: HostPush): boolean {
    const sessionId = this.options.getSessionId();
    if (push.type === 'subagent/updated') {
      if (push.parentSessionId !== sessionId) return true;
      const next = toSubagentChild(push.child);
      const previous = this.children.find((child) => child.sessionId === next.sessionId);
      this.children = [...this.children.filter((child) => child.sessionId !== next.sessionId), next];
      const notice = describeChildChange(previous, next);
      if (notice !== undefined) this.options.onNotice(next.subagentStatus === 'failed' ? 'error' : 'info', notice);
      this.options.onChanged();
      return true;
    }
    if (push.type === 'subagent/result-updated') {
      if (push.parentSessionId !== sessionId) return true;
      this.results = [...this.results.filter((result) => result.resultId !== push.result.resultId), push.result];
      this.options.onChanged();
      return true;
    }
    return false;
  }

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
        onSelect: (childSessionId) => {
          modals.close();
          this.openChild(childSessionId);
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  private openChild(childSessionId: string): void {
    const { modals } = this.options;
    const child = this.children.find((entry) => entry.sessionId === childSessionId);
    const result = latestResultFor(childSessionId, this.results);
    modals.show(
      new ChoiceOverlay({
        title: childLabel(child, '子代理'),
        items: childActionItems(result, !this.options.embedded),
        onSelect: (value) => {
          modals.close();
          this.run(value as ResultAction, childSessionId, result).catch(this.options.onError);
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  private async run(action: ResultAction, childSessionId: string, result: SubagentResultSummary | undefined): Promise<void> {
    if (action === 'close') return;
    if (action === 'open-child') {
      await this.options.openSession(childSessionId);
      return;
    }
    if (result === undefined) return;
    const { resultId, revision } = result;
    const { link } = this.options;
    switch (action) {
      case 'files':
        await this.showFiles(result);
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
        await this.discard(result);
        return;
    }
  }

  /** Cleanup is two-step on the Host: plan it, then spend the plan's token. */
  private async discard(result: SubagentResultSummary): Promise<void> {
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
          modals.close();
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
        onCancel: () => modals.close(),
      }),
    );
  }

  private async showFiles(result: SubagentResultSummary): Promise<void> {
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
          modals.close();
          const file = page.files.find((entry) => entry.fileId === fileId);
          if (file !== undefined) this.showDiff(result, file).catch(this.options.onError);
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  private async showDiff(result: SubagentResultSummary, file: ResultFile): Promise<void> {
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
          modals.close();
          this.showFiles(result).catch(this.options.onError);
        },
      }),
    );
  }
}
