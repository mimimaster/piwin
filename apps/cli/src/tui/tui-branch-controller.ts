import type { HostPush, SessionBranchListData, SessionBranchSwitchData, TranscriptBranchPoint } from '@piwin/contracts';
import { branchPointItems, branchSiblingItems, describeBranches, describeOffPathWrites } from './branch-view.js';
import { ChoiceOverlay } from './choice-overlay.js';
import { hostData, type TuiHostLink } from './tui-host-link.js';
import type { TuiModalStack } from './tui-modals.js';

export type TuiBranchControllerOptions = {
  link: TuiHostLink;
  modals: TuiModalStack;
  getSessionId: () => string | undefined;
  /** The active path changed: the transcript on screen is no longer it. */
  reloadSession: (sessionId: string) => Promise<void>;
  onChanged: () => void;
  onHint: (text: string) => void;
  onError: (error: unknown) => void;
};

/**
 * Switching between the branches of a session's conversation tree. The tree
 * is the Host's; this shell only lists forks along the active path and asks
 * the Host to move the active leaf.
 */
export class TuiBranchController {
  private branchPointCount = 0;
  /** The session `branchPointCount` belongs to. */
  private countedSessionId: string | undefined;
  /** A switch this shell asked for reloads on its own; the push must not reload twice. */
  private switching = false;

  public constructor(private readonly options: TuiBranchControllerOptions) {}

  public describe(): string | undefined {
    return describeBranches(this.branchPointCount);
  }

  public reset(): void {
    this.branchPointCount = 0;
    this.countedSessionId = undefined;
  }

  /**
   * Best effort. A failed read keeps the count this session already had: a
   * reload after a branch push must not turn "分支 2" into none.
   */
  public async load(sessionId: string): Promise<void> {
    const points = await this.list(sessionId).catch(() => undefined);
    if (this.options.getSessionId() !== sessionId) return;
    if (points !== undefined) this.branchPointCount = points.length;
    else if (this.countedSessionId !== sessionId) this.branchPointCount = 0;
    this.countedSessionId = sessionId;
  }

  /** Returns true when the push was a branch update. */
  public handlePush(push: HostPush): boolean {
    if (push.type !== 'session/branch-updated') return false;
    const sessionId = this.options.getSessionId();
    if (push.sessionId !== sessionId || sessionId === undefined) return true;
    this.branchPointCount = push.branchPointCount;
    this.countedSessionId = sessionId;
    this.options.onChanged();
    // Another shell moved the leaf: follow it, or this transcript shows a path nobody is on.
    if (!this.switching) this.options.reloadSession(sessionId).catch(this.options.onError);
    return true;
  }

  public async open(): Promise<void> {
    const sessionId = this.options.getSessionId();
    if (sessionId === undefined) {
      this.options.onHint('当前还没有会话');
      return;
    }
    const points = await this.list(sessionId);
    this.branchPointCount = points.length;
    this.options.onChanged();
    if (points.length === 0) {
      this.options.onHint('这个会话没有分支。/edit 改写上一条提问，/retry keep 保留旧回答再生成，都会产生分支');
      return;
    }
    const { modals } = this.options;
    const [only] = points;
    if (points.length === 1 && only !== undefined) {
      this.openPoint(sessionId, only);
      return;
    }
    modals.show(
      new ChoiceOverlay({
        title: '分支',
        message: '当前路径上的分叉点，从早到晚。',
        items: branchPointItems(points),
        onSelect: (value) => {
          modals.close();
          const point = points[Number(value)];
          if (point !== undefined) this.openPoint(sessionId, point);
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  private openPoint(sessionId: string, point: TranscriptBranchPoint): void {
    const { modals } = this.options;
    const active = point.siblings[point.activeIndex]?.headMessageId;
    modals.show(
      new ChoiceOverlay({
        title: '切换到哪个分支',
        ...(point.promptPreview === undefined ? {} : { message: point.promptPreview }),
        items: branchSiblingItems(point),
        ...(active === undefined ? {} : { initialValue: active }),
        onSelect: (targetMessageId) => {
          modals.close();
          if (targetMessageId === active) return;
          this.switchTo(sessionId, targetMessageId, false).catch(this.options.onError);
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  private async switchTo(sessionId: string, targetMessageId: string, confirm: boolean): Promise<void> {
    this.switching = true;
    try {
      const result = hostData<SessionBranchSwitchData>(
        await this.options.link.request({
          type: 'session/branch-switch',
          sessionId,
          targetMessageId,
          messageProjection: 'none',
          ...(confirm ? { confirm: true } : {}),
        }),
      );
      if (result.status === 'run-active') {
        this.options.onHint('运行中不能切换分支，先按 Esc 中断');
        return;
      }
      if (result.status === 'needs-confirmation') {
        this.confirmSwitch(sessionId, targetMessageId, describeOffPathWrites(result.offPathWrites));
        return;
      }
      await this.options.reloadSession(sessionId);
    } finally {
      this.switching = false;
    }
  }

  private confirmSwitch(sessionId: string, targetMessageId: string, message: string): void {
    const { modals } = this.options;
    modals.show(
      new ChoiceOverlay({
        title: '切换会留下文件改动',
        message,
        items: [
          { value: 'cancel', label: '不切换' },
          { value: 'confirm', label: '仍然切换', description: '文件保持现在的样子' },
        ],
        onSelect: (value) => {
          modals.close();
          if (value === 'confirm') this.switchTo(sessionId, targetMessageId, true).catch(this.options.onError);
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  private async list(sessionId: string): Promise<TranscriptBranchPoint[]> {
    return hostData<SessionBranchListData>(
      await this.options.link.request({ type: 'session/branch-list', sessionId }),
    ).branchPoints;
  }
}
