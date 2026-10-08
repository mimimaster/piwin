import { randomUUID } from 'node:crypto';
import type { HostPush, PromptInput, QueuedTurnRecord } from '@piwin/contracts';
import { ChoiceOverlay } from './choice-overlay.js';
import {
  applyQueuedTurn,
  describeQueue,
  moveQueuedTurn,
  pendingQueuedTurns,
  queuedTurnItems,
  type QueueMove,
} from './queued-turns.js';
import { hostData, type TuiHostLink } from './tui-host-link.js';
import type { TuiModalStack } from './tui-modals.js';

export type TuiQueueControllerOptions = {
  link: TuiHostLink;
  modals: TuiModalStack;
  getSessionId: () => string | undefined;
  /** Run id of the turn in flight, when the Host has named it. */
  getRunId: () => string | undefined;
  onChanged: () => void;
  onHint: (text: string) => void;
  /** A queued turn became a run: its prompt belongs in the transcript now. */
  onStarted: (turn: QueuedTurnRecord) => void;
  /** A queued turn was moved into the running turn instead of waiting. */
  onSteered: (turn: QueuedTurnRecord) => void;
  /** Put a withdrawn turn's text back in the composer. */
  onEdit: (text: string) => void;
  onError: (error: unknown) => void;
};

/**
 * The session's next-turn queue. It lives on the Host, so a turn queued here
 * also shows in Desktop's composer and runs even if this shell exits.
 */
export class TuiQueueController {
  private pending: QueuedTurnRecord[] = [];

  public constructor(private readonly options: TuiQueueControllerOptions) {}

  public describe(): string | undefined {
    return describeQueue(this.pending);
  }

  public reset(): void {
    this.pending = [];
  }

  public async load(sessionId: string): Promise<void> {
    const response = await this.options.link.request({ type: 'session/queued-turn-list', sessionId });
    if (this.options.getSessionId() !== sessionId) return;
    this.pending = response.success
      ? pendingQueuedTurns((response.data as { queuedTurns?: QueuedTurnRecord[] }).queuedTurns ?? [])
      : [];
  }

  /** Queue a prompt behind the running turn; resolves to its place in line. */
  public async submit(sessionId: string, input: PromptInput, userMessageId: string): Promise<number> {
    const data = hostData<{ queuedTurn: QueuedTurnRecord }>(
      await this.options.link.request({
        type: 'session/queued-turn-submit',
        sessionId,
        queuedTurnId: randomUUID(),
        userMessageId,
        input,
      }),
    );
    this.apply(data.queuedTurn);
    return Math.max(1, this.pending.findIndex((turn) => turn.queuedTurnId === data.queuedTurn.queuedTurnId) + 1);
  }

  /** Returns true when the push was about this session's queue. */
  public handlePush(push: HostPush): boolean {
    if (push.type !== 'session/queued-turn-updated') return false;
    if (push.queuedTurn.sessionId !== this.options.getSessionId()) return true;
    this.apply(push.queuedTurn);
    return true;
  }

  public open(): void {
    const { modals } = this.options;
    if (this.pending.length === 0) {
      this.options.onHint('没有排队的消息');
      return;
    }
    modals.show(
      new ChoiceOverlay({
        title: '排队的消息',
        message: '当前这一轮结束后按顺序发送。选一条来取回或取消。',
        items: queuedTurnItems(this.pending),
        onSelect: (queuedTurnId) => {
          modals.close();
          const turn = this.pending.find((entry) => entry.queuedTurnId === queuedTurnId);
          if (turn !== undefined) this.openTurnActions(turn);
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  private openTurnActions(turn: QueuedTurnRecord): void {
    const { modals } = this.options;
    const carriesMore = (turn.input.attachments?.length ?? 0) > 0 || (turn.input.contextRefs?.length ?? 0) > 0;
    const index = this.pending.findIndex((entry) => entry.queuedTurnId === turn.queuedTurnId);
    const canMoveUp = index > 0;
    const canMoveDown = index !== -1 && index < this.pending.length - 1;
    modals.show(
      new ChoiceOverlay({
        title: '排队的消息',
        message: turn.input.text,
        items: [
          ...(this.options.getRunId() === undefined
            ? []
            : [{ value: 'steer', label: '现在就插入当前这一轮', description: '不再等这一轮结束' }]),
          ...(canMoveUp ? [{ value: 'top', label: '移到最前' }] : []),
          ...(canMoveUp ? [{ value: 'up', label: '上移一位' }] : []),
          ...(canMoveDown ? [{ value: 'down', label: '下移一位' }] : []),
          {
            value: 'edit',
            label: '取回到输入框',
            description: carriesMore ? '只取回文字，附件和引用需重新添加' : '从队列移除，改完再发',
          },
          { value: 'cancel', label: '取消这条' },
          { value: 'close', label: '关闭' },
        ],
        onSelect: (action) => {
          modals.close();
          this.runTurnAction(action, turn).catch(this.options.onError);
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  private async runTurnAction(action: string, turn: QueuedTurnRecord): Promise<void> {
    switch (action) {
      case 'steer':
        await this.steerNow(turn);
        return;
      case 'top':
      case 'up':
      case 'down':
        await this.move(turn, action);
        return;
      case 'edit':
        await this.cancel(turn);
        this.options.onEdit(turn.input.text);
        return;
      case 'cancel':
        await this.cancel(turn);
        return;
      default:
    }
  }

  /**
   * Turn a waiting message into an intervention on the running turn. The Host
   * cancels the queued turn and creates the intervention in one transaction,
   * so it is never both queued and steered.
   */
  private async steerNow(turn: QueuedTurnRecord): Promise<void> {
    const runId = this.options.getRunId();
    if (runId === undefined) {
      this.options.onHint('没有正在运行的回合，它会自动开始');
      return;
    }
    const { text, attachments, contextRefs } = turn.input;
    hostData(
      await this.options.link.request({
        type: 'run/intervention-submit',
        sessionId: turn.sessionId,
        runId,
        interventionId: randomUUID(),
        userMessageId: turn.userMessageId,
        input: {
          text,
          ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
          ...(contextRefs !== undefined && contextRefs.length > 0 ? { contextRefs } : {}),
        },
        adoptQueuedTurn: { queuedTurnId: turn.queuedTurnId, expectedRevision: turn.revision },
      }),
    );
    this.pending = this.pending.filter((entry) => entry.queuedTurnId !== turn.queuedTurnId);
    this.options.onSteered(turn);
    this.options.onChanged();
  }

  /** Reordering is checked against the queue's revision, so read the queue fresh first. */
  private async move(turn: QueuedTurnRecord, move: QueueMove): Promise<void> {
    const { link } = this.options;
    const listed = hostData<{ queueRevision: number; queuedTurns: QueuedTurnRecord[] }>(
      await link.request({ type: 'session/queued-turn-list', sessionId: turn.sessionId }),
    );
    this.pending = pendingQueuedTurns(listed.queuedTurns);
    const orderedQueuedTurnIds = moveQueuedTurn(this.pending, turn.queuedTurnId, move);
    if (orderedQueuedTurnIds === undefined) {
      this.options.onChanged();
      return;
    }
    hostData(
      await link.request({
        type: 'session/queued-turn-reorder',
        sessionId: turn.sessionId,
        expectedQueueRevision: listed.queueRevision,
        orderedQueuedTurnIds,
      }),
    );
    // The Host renumbers the turns; show its order, not a local guess.
    await this.load(turn.sessionId);
    this.options.onChanged();
    this.open();
  }

  /** `expectedRevision` makes the Host refuse if the turn started or changed meanwhile. */
  private async cancel(turn: QueuedTurnRecord): Promise<void> {
    hostData(
      await this.options.link.request({
        type: 'session/queued-turn-cancel',
        sessionId: turn.sessionId,
        queuedTurnId: turn.queuedTurnId,
        expectedRevision: turn.revision,
      }),
    );
  }

  private apply(record: QueuedTurnRecord): void {
    const wasPending = this.pending.some((turn) => turn.queuedTurnId === record.queuedTurnId);
    this.pending = applyQueuedTurn(this.pending, record);
    if (record.status === 'started' && (wasPending || record.mode === 'next')) this.options.onStarted(record);
    this.options.onChanged();
  }
}
