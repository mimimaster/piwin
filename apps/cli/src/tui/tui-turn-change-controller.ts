import type {
  HostPush,
  TurnChangeDirection,
  TurnChangeFileDiff,
  TurnChangeFilePage,
  TurnChangeOperationEntry,
  TurnChangeRepairPreview,
  TurnChangeSummary,
} from '@piwin/contracts';
import { ChoiceOverlay } from './choice-overlay.js';
import type { TranscriptState } from './transcript-model.js';
import { hostData, type TuiHostLink } from './tui-host-link.js';
import type { TuiModalStack } from './tui-modals.js';
import {
  describeBlocked,
  describeDispositionChange,
  describeRefusal,
  renderRepairPreview,
  transcriptRunIds,
  turnChangeActionItems,
  turnChangeItems,
  turnsWithChanges,
  type TurnChangeAction,
} from './turn-changes-view.js';
import { ViewerOverlay } from './viewer-overlay.js';

/** Enough to cover the transcript page on screen; older turns need `/older` first. */
const MAX_RUNS_QUERIED = 50;
const FILE_PAGE_LIMIT = 200;
const FILE_KIND = { added: '新增', modified: '修改', deleted: '删除' } as const;

export type TuiTurnChangeControllerOptions = {
  link: TuiHostLink;
  modals: TuiModalStack;
  getSessionId: () => string | undefined;
  getTranscript: () => TranscriptState;
  isRunning: () => boolean;
  onHint: (text: string) => void;
  onNotice: (tone: 'info' | 'error', text: string) => void;
  onError: (error: unknown) => void;
};

/**
 * What each turn changed on disk, and taking it back. The Host records the
 * changes and writes every file of an undo or redo; this shell lists turns,
 * shows their diffs and asks.
 */
export class TuiTurnChangeController {
  /** Last state seen per change set, to tell an undo from a first sighting. */
  private readonly known = new Map<string, TurnChangeSummary>();

  public constructor(private readonly options: TuiTurnChangeControllerOptions) {}

  public reset(): void {
    this.known.clear();
  }

  /** Returns true when the push was a turn-change update. */
  public handlePush(push: HostPush): boolean {
    if (push.type === 'turn-changes/operation-updated') return true;
    if (push.type !== 'turn-changes/updated') return false;
    if (push.summary.sessionId === this.options.getSessionId()) this.remember(push.summary);
    return true;
  }

  /** `/changes`: every turn on screen that touched files. */
  public async open(): Promise<void> {
    const turns = await this.loadTurns();
    if (turns === undefined) return;
    if (turns.length === 0) {
      this.options.onHint('当前这页对话里没有改动文件的回合');
      return;
    }
    const { modals } = this.options;
    modals.show(
      new ChoiceOverlay({
        title: '各轮的文件改动',
        message: '从新到旧。选一轮查看改了什么，或撤销它。',
        items: turnChangeItems(turns, this.options.getTranscript()),
        onSelect: (changeSetId) => {
          modals.close();
          const summary = turns.find((turn) => turn.changeSetId === changeSetId);
          if (summary !== undefined) this.openTurn(summary);
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  /** `/undo`: take back the most recent turn that still has its changes applied. */
  public async undoLatest(): Promise<void> {
    const turns = await this.loadTurns();
    if (turns === undefined) return;
    const latest = turns.find((turn) => turn.disposition !== 'undone');
    if (latest === undefined) {
      this.options.onHint('没有可以撤销的改动');
      return;
    }
    const blocked = describeBlocked(latest.undo);
    if (blocked !== undefined) {
      this.options.onNotice('error', `上一轮的改动不能撤销 — ${blocked}`);
      return;
    }
    this.confirm(latest, 'undo');
  }

  private async loadTurns(): Promise<TurnChangeSummary[] | undefined> {
    const sessionId = this.options.getSessionId();
    if (sessionId === undefined) {
      this.options.onHint('当前还没有会话');
      return undefined;
    }
    const runOrder = transcriptRunIds(this.options.getTranscript());
    if (runOrder.length === 0) return [];
    const response = await this.options.link.request({
      type: 'turn-changes/list-by-runs',
      sessionId,
      runIds: runOrder.slice(-MAX_RUNS_QUERIED),
    });
    if (!response.success) {
      this.options.onHint(describeRefusal(response.error));
      return undefined;
    }
    const { summaries } = response.data as { summaries: TurnChangeSummary[] };
    for (const summary of summaries) this.known.set(summary.changeSetId, summary);
    return turnsWithChanges(summaries, runOrder);
  }

  private openTurn(summary: TurnChangeSummary): void {
    const { modals } = this.options;
    modals.show(
      new ChoiceOverlay({
        title: '这一轮的改动',
        items: turnChangeActionItems(summary),
        onSelect: (value) => {
          modals.close();
          const action = value as TurnChangeAction;
          if (action === 'files') this.showFiles(summary).catch(this.options.onError);
          else if (action === 'undo' || action === 'redo') this.confirm(summary, action);
          else if (action === 'repair') this.repair(summary).catch(this.options.onError);
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  private confirm(summary: TurnChangeSummary, direction: TurnChangeDirection): void {
    const { modals } = this.options;
    if (this.options.isRunning()) {
      this.options.onHint('运行中不能改动文件，先按 Esc 中断');
      return;
    }
    const undo = direction === 'undo';
    const count = summary.fileCount === null ? '这一轮改过的文件' : `${summary.fileCount} 个文件`;
    modals.show(
      new ChoiceOverlay({
        title: undo ? '撤销这一轮的改动' : '恢复这一轮的改动',
        message: undo
          ? `会把${count}改回这一轮开始前的样子。对话记录不变，之后可以再恢复。`
          : `会把${count}改回这一轮结束时的样子。`,
        items: [
          { value: 'cancel', label: '取消' },
          { value: 'go', label: undo ? '撤销' : '恢复' },
        ],
        onSelect: (value) => {
          modals.close();
          if (value === 'go') this.apply(summary, direction).catch(this.options.onError);
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  /** `expectedRevision` makes the Host refuse if the record moved since it was shown. */
  private async apply(summary: TurnChangeSummary, direction: TurnChangeDirection): Promise<void> {
    const { link } = this.options;
    const undo = direction === 'undo';
    const response = await link.request({
      type: undo ? 'turn-changes/undo' : 'turn-changes/redo',
      changeSetId: summary.changeSetId,
      expectedRevision: summary.revision,
    });
    if (!response.success) {
      this.options.onNotice('error', `${undo ? '撤销' : '恢复'}没有执行 — ${describeRefusal(response.error)}`);
      return;
    }
    // The outcome also arrives as a push, but that push is filed under the
    // workspace, not the session; ask once so the result is never missed.
    const listed = await link.request({
      type: 'turn-changes/list-by-runs',
      sessionId: summary.sessionId,
      runIds: summary.runIds,
    });
    const refreshed = listed.success
      ? (listed.data as { summaries?: TurnChangeSummary[] }).summaries?.find(
          (candidate) => candidate.changeSetId === summary.changeSetId,
        )
      : undefined;
    this.remember(refreshed ?? { ...summary, disposition: undo ? 'undone' : 'applied' });
  }

  /**
   * Finish an undo or redo that stopped half way. The Host previews what it
   * would write, hands back a token bound to that preview, and refuses the
   * run if the files moved in between; nothing is overwritten on a guess.
   */
  private async repair(summary: TurnChangeSummary): Promise<void> {
    const { link, modals } = this.options;
    const operationId = summary.latestOperationId;
    if (operationId === null) return;
    if (this.options.isRunning()) {
      this.options.onHint('运行中不能改动文件，先按 Esc 中断');
      return;
    }
    // Repair commands are addressed by the revision the stuck operation targeted.
    const operation = hostData<TurnChangeOperationEntry>(
      await link.request({ type: 'turn-changes/operation', operationId }),
    );
    const expectedRevision = operation.revision;
    const preview = hostData<TurnChangeRepairPreview>(
      await link.request({ type: 'turn-changes/recovery-preview', operationId, expectedRevision }),
    );
    modals.show(
      new ChoiceOverlay({
        title: '修复没完成的操作',
        message: renderRepairPreview(preview),
        items: [
          { value: 'cancel', label: '先不修复' },
          { value: 'go', label: '修复' },
        ],
        onSelect: (value) => {
          modals.close();
          if (value !== 'go') return;
          this.runRepair(operationId, expectedRevision, preview.confirmationToken).catch(this.options.onError);
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  private async runRepair(operationId: string, expectedRevision: number, confirmationToken: string): Promise<void> {
    const { link } = this.options;
    const ran = await link.request({
      type: 'turn-changes/recovery-run',
      operationId,
      expectedRevision,
      confirmationToken,
    });
    if (!ran.success) {
      this.options.onNotice('error', `修复没有执行 — ${describeRefusal(ran.error)}`);
      return;
    }
    const verified = hostData<{ verified: boolean }>(
      await link.request({ type: 'turn-changes/recovery-verify', operationId, expectedRevision }),
    );
    this.options.onNotice(
      verified.verified ? 'info' : 'error',
      verified.verified
        ? '已修复，这一轮可以重新撤销或恢复'
        : '还有文件没回到操作前的样子，处理后再用 /changes 修复一次',
    );
  }

  private remember(next: TurnChangeSummary): void {
    const notice = describeDispositionChange(this.known.get(next.changeSetId), next);
    this.known.set(next.changeSetId, next);
    if (notice !== undefined) this.options.onNotice('info', notice);
  }

  private async showFiles(summary: TurnChangeSummary): Promise<void> {
    const { link, modals } = this.options;
    const page = hostData<TurnChangeFilePage>(
      await link.request({
        type: 'turn-changes/files',
        changeSetId: summary.changeSetId,
        revision: summary.revision,
        limit: FILE_PAGE_LIMIT,
      }),
    );
    if (page.files.length === 0) {
      this.options.onHint('这一轮没有可显示的改动文件');
      return;
    }
    modals.show(
      new ChoiceOverlay({
        title: `改动的文件（${page.files.length}${page.nextCursor === null ? '' : '+'}）`,
        items: page.files.map((file) => ({
          value: file.fileId,
          label: file.relativePath,
          description: file.binary
            ? `${FILE_KIND[file.kind]} · 二进制`
            : `${FILE_KIND[file.kind]} +${file.additions ?? 0} −${file.deletions ?? 0}`,
        })),
        onSelect: (fileId) => {
          modals.close();
          this.showDiff(summary, fileId).catch(this.options.onError);
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  private async showDiff(summary: TurnChangeSummary, fileId: string): Promise<void> {
    const { link, modals } = this.options;
    const diff = hostData<TurnChangeFileDiff>(
      await link.request({
        type: 'turn-changes/diff',
        changeSetId: summary.changeSetId,
        revision: summary.revision,
        fileId,
      }),
    );
    const patch = diff.patch ?? '';
    modals.show(
      new ViewerOverlay({
        title: `${diff.relativePath}  +${diff.additions ?? 0} −${diff.deletions ?? 0}`,
        lines: diff.binary ? ['二进制文件，不显示内容'] : patch.length === 0 ? ['没有可显示的差异'] : patch.split('\n'),
        // Back to the file list: a turn usually changed more than one file.
        onClose: () => {
          modals.close();
          this.showFiles(summary).catch(this.options.onError);
        },
      }),
    );
  }
}
