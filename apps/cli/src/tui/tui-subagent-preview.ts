import type {
  PermissionDecision,
  PermissionRememberScope,
  SessionSummary,
  SessionTranscriptMessage,
  SubagentInvocation,
  SubagentResultSummary,
} from '@piwin/contracts';
import {
  deriveSubagentPreview,
  type SubagentPreviewStatus,
  type SubagentStepMessage,
} from '@piwin/host-client';
import { SubagentPreviewOverlay, type SubagentPreviewFrame } from './subagent-preview-overlay.js';
import { paintSubagentPreview } from './subagent-preview-view.js';
import { subagentTailForPreview, type SubagentLiveTail, type SubagentPendingPermission } from './subagent-live-tail.js';
import { hostData, type TuiHostLink } from './tui-host-link.js';
import type { TuiModalStack } from './tui-modals.js';
import { style } from './tui-style.js';

/** History refetches at most this often while the child streams. */
const REFETCH_THROTTLE_MS = 500;

export type SubagentResultAction = 'apply' | 'files' | 'resolve' | 'retain' | 'discard';

/** Single keys, chosen to avoid the scroll keys (j k g G space q). */
const ACTION_KEYS: ReadonlyArray<{ key: string; action: SubagentResultAction; label: string }> = [
  { key: 'a', action: 'apply', label: '应用' },
  { key: 'f', action: 'files', label: '改动文件' },
  { key: 'r', action: 'resolve', label: '交主会话处理冲突' },
  { key: 'p', action: 'retain', label: '先保留' },
  { key: 'd', action: 'discard', label: '丢弃副本' },
];

/** What the preview reads about one child, assembled by the subagent controller. */
export type SubagentPreviewData = {
  label: string;
  status: SubagentPreviewStatus;
  invocation?: SubagentInvocation;
  child?: SessionSummary;
  tail: SubagentLiveTail;
  result?: SubagentResultSummary;
  /** Whether the result's changes still wait for a decision (offers 先保留). */
  pendingDecision: boolean;
};

export type TuiSubagentPreviewOptions = {
  link: TuiHostLink;
  modals: TuiModalStack;
  data: (childSessionId: string) => SubagentPreviewData;
  act: (action: SubagentResultAction, childSessionId: string, result: SubagentResultSummary) => Promise<void>;
  /** The permission was answered here: take its queued dialog down. */
  dropPermission: (requestId: string) => void;
  /** Esc: back to the child list. */
  back: () => void;
  onChanged: () => void;
  onHint: (text: string) => void;
  onError: (error: unknown) => void;
};

function toStepMessage(message: SessionTranscriptMessage): SubagentStepMessage {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    thinking: message.thinking ?? '',
    tools: message.tools ?? [],
  };
}

/**
 * One child's dense preview at a time (shared projection, terminal paint).
 * Observation plus the result decisions the Host allows — never a way into
 * the child session, and never a message to the child.
 */
export class TuiSubagentPreview {
  private childSessionId: string | null = null;
  private history: SubagentStepMessage[] = [];
  private historyIds = new Set<string>();
  private loading = false;
  private error: string | null = null;
  private loadedRevision = -1;
  private requestSeq = 0;
  private refetchTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor(private readonly options: TuiSubagentPreviewOptions) {}

  public isOpenFor(childSessionId: string): boolean {
    return this.childSessionId === childSessionId;
  }

  public open(childSessionId: string): void {
    const switching = this.childSessionId !== childSessionId;
    this.childSessionId = childSessionId;
    if (switching) {
      this.history = [];
      this.historyIds = new Set();
      this.loadedRevision = -1;
      this.error = null;
    }
    this.options.modals.show(
      new SubagentPreviewOverlay({
        title: `子代理 · ${this.options.data(childSessionId).label}`,
        frame: (width) => this.frame(childSessionId, width),
        onKey: (key) => this.handleKey(childSessionId, key),
        onClose: () => {
          this.close();
          this.options.modals.close();
          this.options.back();
        },
      }),
    );
    this.load(childSessionId);
  }

  /** Forget the open child (session switch, list closed). */
  public close(): void {
    this.childSessionId = null;
    this.requestSeq += 1;
    if (this.refetchTimer !== undefined) clearTimeout(this.refetchTimer);
    this.refetchTimer = undefined;
  }

  /** Live tail changed; a finished message means history has news. */
  public childUpdated(childSessionId: string, tail: SubagentLiveTail): void {
    if (!this.isOpenFor(childSessionId)) return;
    if (tail.completedMessages !== this.loadedRevision && this.refetchTimer === undefined) {
      this.refetchTimer = setTimeout(() => {
        this.refetchTimer = undefined;
        if (this.isOpenFor(childSessionId)) this.load(childSessionId);
      }, REFETCH_THROTTLE_MS);
    }
    this.options.onChanged();
  }

  private load(childSessionId: string): void {
    const seq = ++this.requestSeq;
    const revision = this.options.data(childSessionId).tail.completedMessages;
    this.loading = true;
    this.options.link
      .request({ type: 'session/messages', sessionId: childSessionId })
      .then((response) => hostData<{ messages?: SessionTranscriptMessage[] }>(response))
      .then(
        (data) => {
          if (seq !== this.requestSeq) return;
          this.history = (data.messages ?? []).map(toStepMessage);
          this.historyIds = new Set(this.history.map((message) => message.id));
          this.loadedRevision = revision;
          this.error = null;
        },
        (error: unknown) => {
          if (seq !== this.requestSeq) return;
          this.error = error instanceof Error ? error.message : String(error);
        },
      )
      .finally(() => {
        if (seq !== this.requestSeq) return;
        this.loading = false;
        this.options.onChanged();
      });
  }

  private frame(childSessionId: string, width: number): SubagentPreviewFrame {
    const data = this.options.data(childSessionId);
    const view = deriveSubagentPreview({
      status: data.status,
      messages: this.history,
      liveTail: subagentTailForPreview(data.tail, this.historyIds),
      invocation: data.invocation,
      child: data.child,
      showThinking: false,
      locale: 'zh-CN',
    });
    const painted = paintSubagentPreview(view, data.label, width);
    const body = [...painted.body];
    if (this.loading && view.lines.length === 0) body.unshift(style.gray('     加载中…'));
    if (this.error !== null) body.push(style.red(`     读取过程失败：${this.error}`));
    const permission = data.tail.permission;
    const sticky = permission === null ? [] : [permissionLine(permission)];
    return { header: painted.header, body, sticky, footer: footerFor(data) };
  }

  private handleKey(childSessionId: string, key: string): boolean {
    const data = this.options.data(childSessionId);
    const permission = data.tail.permission;
    if (permission !== null && answerable(permission)) {
      const answer = PERMISSION_KEYS[key];
      if (answer !== undefined) {
        this.answer(permission, answer.decision, answer.scope);
        return true;
      }
    }
    const binding = ACTION_KEYS.find((candidate) => candidate.key === key);
    if (binding === undefined) return false;
    const result = data.result;
    if (result === undefined) {
      this.options.onHint('这个子代理还没有结果');
      return true;
    }
    const refusal = refusalOf(binding.action, result, data.pendingDecision);
    if (refusal !== undefined) {
      this.options.onHint(refusal);
      return true;
    }
    this.options.act(binding.action, childSessionId, result).catch(this.options.onError);
    return true;
  }

  private answer(permission: SubagentPendingPermission, decision: PermissionDecision, scope?: PermissionRememberScope): void {
    this.options.link
      .request({
        type: 'permission/resolve',
        requestId: permission.requestId,
        decision,
        ...(decision === 'allow' && scope !== undefined ? { rememberScope: scope } : {}),
      })
      .then(hostData)
      .then(() => this.options.dropPermission(permission.requestId), this.options.onError);
  }
}

const PERMISSION_KEYS: Readonly<Record<string, { decision: PermissionDecision; scope?: PermissionRememberScope }>> = {
  y: { decision: 'allow', scope: 'once' },
  s: { decision: 'allow', scope: 'session' },
  n: { decision: 'deny' },
};

/** An external agent's own choices (ADR 0082) are answered in the full dialog only. */
function answerable(permission: SubagentPendingPermission): boolean {
  return (permission.context?.backendOptions?.length ?? 0) === 0;
}

function permissionLine(permission: SubagentPendingPermission): string {
  const detail = permission.detail.replace(/\s+/g, ' ').trim();
  const keys = answerable(permission) ? 'y 允许 · s 本会话总是允许 · n 拒绝' : '在确认框里回答';
  return `${style.yellow('需要权限')} ${permission.action}${detail.length > 0 ? `  ${style.gray(detail)}` : ''}  ${style.gray(keys)}`;
}

/** Why an action cannot run now; undefined when it can. */
function refusalOf(action: SubagentResultAction, result: SubagentResultSummary, pendingDecision: boolean): string | undefined {
  const { availability } = result;
  const gate = (allowed: boolean, reason: string | undefined, label: string): string | undefined =>
    allowed ? undefined : reason ?? `现在不能${label}`;
  switch (action) {
    case 'apply':
      return gate(availability.apply.allowed, availability.apply.reason, '应用');
    case 'files':
      return gate(availability.view.allowed, availability.view.reason, '查看改动');
    case 'resolve':
      return gate(availability.resolve.allowed, availability.resolve.reason, '交给主会话处理');
    case 'retain':
      return pendingDecision ? undefined : '这份结果已经处理过了';
    case 'discard':
      return gate(availability.cleanup.allowed, availability.cleanup.reason, '丢弃副本');
  }
}

function footerFor(data: SubagentPreviewData): string {
  const result = data.result;
  const keys =
    result === undefined
      ? []
      : ACTION_KEYS.filter((binding) => refusalOf(binding.action, result, data.pendingDecision) === undefined).map(
          (binding) => `${binding.key} ${binding.label}`,
        );
  return [...keys, 'Esc 返回'].join(' · ');
}
