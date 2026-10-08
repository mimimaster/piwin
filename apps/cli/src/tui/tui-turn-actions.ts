import { randomUUID } from 'node:crypto';
import type { HostCommand, HostResponse, PromptInput } from '@piwin/contracts';
import type { TranscriptState } from './transcript-model.js';
import { findLastUserMessage } from './tui-composer-options.js';
import { hostData } from './tui-host-link.js';

/** What the turn actions need from the app that owns the session on screen. */
export type TuiTurnPort = {
  request: (command: HostCommand) => Promise<HostResponse>;
  /** Desktop owns which session is shown when the TUI is embedded. */
  embedded: boolean;
  sessionId: () => string | undefined;
  /** Run id of the turn in flight, when the Host has named it. */
  runId: () => string | undefined;
  isRunning: () => boolean;
  transcript: () => TranscriptState;
  /** Model, thinking level and Run Mode for a prompt sent now. */
  promptFields: () => Partial<PromptInput>;
  hint: (text: string) => void;
  notice: (tone: 'info' | 'error', text: string) => void;
  echoUser: (messageId: string, text: string, annotations: string[]) => void;
  /** Reload the session's transcript from the Host. */
  openSession: (sessionId: string) => Promise<void>;
  /** Put a turn in the composer so the next prompt replaces it as a branch. */
  beginEdit: (messageId: string, text: string) => void;
};

/**
 * Things done to a turn or the whole conversation rather than typed into it:
 * interrupt, steer, compact, retry, rewrite, fork. Each is one Host command;
 * what changes on screen comes back through pushes or a reload.
 */
export class TuiTurnActions {
  public constructor(private readonly port: TuiTurnPort) {}

  public async abort(): Promise<void> {
    const sessionId = this.port.sessionId();
    if (sessionId === undefined) return;
    const runId = this.port.runId();
    hostData(
      await this.port.request({ type: 'session/abort', sessionId, ...(runId === undefined ? {} : { runId }) }),
    );
  }

  /** Put a sentence into the turn that is running, instead of queueing a new one. */
  public async steer(text: string): Promise<void> {
    const sessionId = this.port.sessionId();
    const runId = this.port.runId();
    if (sessionId === undefined || runId === undefined) {
      this.port.hint('没有正在运行的回合，直接发送即可');
      return;
    }
    if (text.length === 0) {
      this.port.hint('用法：/steer <要插入的话>');
      return;
    }
    const clientMessageId = randomUUID();
    this.port.echoUser(clientMessageId, text, ['插入当前回合']);
    hostData(await this.port.request({ type: 'session/steer', sessionId, message: text, runId, clientMessageId }));
  }

  public async compact(customInstructions: string): Promise<void> {
    const sessionId = this.requireIdleSession('压缩');
    if (sessionId === undefined) return;
    // Progress and the outcome arrive as compaction/start and compaction/end events.
    hostData(
      await this.port.request({
        type: 'session/compact',
        sessionId,
        ...(customInstructions.length === 0 ? {} : { customInstructions }),
      }),
    );
  }

  /**
   * Re-run the last user turn in place. By default the Host drops the previous
   * answer; `keepPrevious` leaves it as a sibling branch to switch back to.
   */
  public async retry(keepPrevious: boolean): Promise<void> {
    const last = findLastUserMessage(this.port.transcript());
    if (this.port.sessionId() === undefined || last === undefined) {
      this.port.hint('没有可以重试的消息');
      return;
    }
    const sessionId = this.requireIdleSession('重试');
    if (sessionId === undefined) return;
    hostData(
      await this.port.request({
        type: 'session/prompt',
        sessionId,
        input: {
          // The Host re-reads the stored turn; text sent here is ignored.
          text: '',
          retryUserMessageId: last.id,
          ...(keepPrevious ? { keepPreviousAttempt: true } : {}),
          ...this.port.promptFields(),
        },
        foreground: { kind: 'if-idle' },
      }),
    );
    // The retried answer replaces the old one; reload rather than patch rows.
    await this.port.openSession(sessionId);
  }

  /** Load the last prompt into the composer; sending it branches from that turn. */
  public beginEditingLastTurn(): void {
    const last = findLastUserMessage(this.port.transcript());
    if (this.port.sessionId() === undefined || last === undefined) {
      this.port.hint('没有可以改写的提问');
      return;
    }
    if (this.requireIdleSession('改写提问') === undefined) return;
    this.port.beginEdit(last.id, last.text);
  }

  /** A linked copy of the conversation up to the latest answer; this session is untouched. */
  public async fork(name: string): Promise<void> {
    const sessionId = this.port.sessionId();
    if (sessionId === undefined) {
      this.port.hint('当前还没有会话');
      return;
    }
    const forked = hostData<{ sessionId: string; session?: { name?: string } }>(
      await this.port.request({
        type: 'session/fork',
        sessionId,
        workspaceStrategy: 'shared',
        messageProjection: 'none',
        ...(name.length === 0 ? {} : { name }),
      }),
    );
    const label = forked.session?.name ?? name;
    if (this.port.embedded) {
      this.port.notice('info', `已分叉为「${label}」，在侧栏打开`);
      return;
    }
    await this.port.openSession(forked.sessionId);
    this.port.notice('info', `这是分叉出的会话「${label}」，原会话没有变化`);
  }

  private requireIdleSession(action: string): string | undefined {
    const sessionId = this.port.sessionId();
    if (sessionId === undefined) {
      this.port.hint('当前还没有会话');
      return undefined;
    }
    if (this.port.isRunning()) {
      this.port.hint(`运行中不能${action}，先按 Esc 中断`);
      return undefined;
    }
    return sessionId;
  }
}
