import { randomUUID } from 'node:crypto';
import type { PromptInput } from '@piwin/contracts';
import { requestPromptWithForeground } from '@piwin/host-client';
import { describePromptExtras } from './queued-turns.js';
import type { ProjectFiles } from './project-files.js';
import type { TuiAttachmentController } from './tui-attachment-controller.js';
import type { TuiComposerProfile } from './tui-composer-profile.js';
import { hostData, type TuiHostLink } from './tui-host-link.js';
import type { TuiQueueController } from './tui-queue-controller.js';
import type { TuiSideChatController } from './tui-side-chat-controller.js';

export type TuiPromptSenderOptions = {
  link: TuiHostLink;
  queue: TuiQueueController;
  attachments: TuiAttachmentController;
  files: ProjectFiles;
  composer: TuiComposerProfile;
  sideChat: TuiSideChatController;
  /**
   * Identity of the conversation on screen. It changes when the user opens
   * another session or starts a new one, not when a draft gets its session.
   */
  conversation: () => object;
  ensureSession: () => Promise<string>;
  isRunning: () => boolean;
  runId: () => string | undefined;
  editingMessageId: () => string | undefined;
  clearEditing: () => void;
  echoUser: (messageId: string, text: string, annotations: string[]) => void;
  removeEcho: (messageId: string) => void;
  /** Put text back in front of whatever the composer holds now. */
  returnToComposer: (text: string) => void;
  /** After the Host took a prompt that started a turn. */
  onTurnAccepted: (sessionId: string) => Promise<void>;
  reloadSession: (sessionId: string) => Promise<void>;
  onChanged: () => void;
  onHint: (text: string) => void;
  onNotice: (tone: 'info' | 'error', text: string) => void;
};

type WaitingPrompt = {
  rawText: string;
  replaceRunning: boolean;
  conversation: object;
  /** Set once the Host took it; from then on a failure is not "unsent". */
  accepted: boolean;
  settle: (error?: unknown) => void;
};

/** Thrown for a prompt that is handed back to the composer with a hint, not an error. */
class PromptHeldBack extends Error {
  public override readonly name = 'PromptHeldBack';
}

/**
 * Sends what the user typed as turns, one at a time and in typing order: each
 * prompt waits until the Host accepted or queued the one before it, so quick
 * sends land in the same session and the later one sees the earlier one's
 * running turn. A prompt the Host did not take goes back to the composer, with
 * every prompt still waiting behind it, so nothing is sent out of context.
 */
export class TuiPromptSender {
  private readonly waiting: WaitingPrompt[] = [];
  private draining = false;

  public constructor(private readonly options: TuiPromptSenderOptions) {}

  /** Status-bar entry while typed prompts have not left yet. */
  public describe(): string | undefined {
    return this.waiting.length === 0 ? undefined : `待发送 ${this.waiting.length} 条 · Ctrl+C 取回`;
  }

  /**
   * Send the text as a turn. While another turn runs it is queued behind it
   * on the Host, unless `replaceRunning` asks the Host to stop that turn and
   * run this one instead.
   */
  public send(rawText: string, replaceRunning: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.waiting.push({
        rawText,
        replaceRunning,
        conversation: this.options.conversation(),
        accepted: false,
        settle: (error) => (error === undefined ? resolve() : reject(error)),
      });
      // Shows the count while an earlier prompt is still on its way.
      this.options.onChanged();
      this.drain().catch(reject);
    });
  }

  /** Take back the prompts that have not left yet. False when there are none. */
  public cancelWaiting(): boolean {
    if (this.waiting.length === 0) return false;
    const taken = this.waiting.splice(0);
    this.handBack(taken);
    this.options.onHint(`已取回 ${taken.length} 条未发出的消息`);
    return true;
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let next = this.waiting.shift(); next !== undefined; next = this.waiting.shift()) {
        this.options.onChanged();
        try {
          await this.sendNow(next);
          next.settle();
        } catch (error) {
          if (!next.accepted) this.handBack([next, ...this.waiting.splice(0)]);
          if (error instanceof PromptHeldBack) {
            this.options.onHint(error.message);
            next.settle();
          } else {
            next.settle(error);
          }
        }
      }
    } finally {
      this.draining = false;
      this.options.onChanged();
    }
  }

  private handBack(prompts: WaitingPrompt[]): void {
    const [first, ...rest] = prompts;
    if (first === undefined) return;
    this.options.returnToComposer(prompts.map((prompt) => prompt.rawText).join('\n'));
    // The first one is settled by whoever took it out of the line.
    for (const prompt of rest) prompt.settle();
    this.options.onChanged();
  }

  private requireSameConversation(prompt: WaitingPrompt): void {
    if (prompt.conversation !== this.options.conversation()) {
      throw new PromptHeldBack('会话已切换，未发出的消息已放回输入框');
    }
  }

  private async sendNow(prompt: WaitingPrompt): Promise<void> {
    const { link, queue, attachments, files, composer, sideChat } = this.options;
    const typedText = prompt.rawText.trim();
    this.requireSameConversation(prompt);
    if (attachments.isUploading) throw new PromptHeldBack('附件还在上传，稍后再发');
    const sessionId = await this.options.ensureSession();
    this.requireSameConversation(prompt);
    const clientMessageId = randomUUID();
    const text = await attachments.adoptDroppedImages(sessionId, typedText);
    const attached = attachments.take();
    // A refused prompt keeps what it carried: the user fixes the cause and resends.
    let handedOff: ReturnType<TuiSideChatController['takeRefs']> = [];
    let echoed = false;
    try {
      const mentions = await files.resolveMentions(text);
      this.requireSameConversation(prompt);
      if (mentions.overLimit.length > 0) {
        this.options.onNotice(
          'error',
          `一条消息最多引用 ${mentions.refs.length} 个文件，未带上：${mentions.overLimit.join('、')}`,
        );
      }
      if (mentions.unresolved.length > 0) {
        this.options.onHint(
          `项目里没有 ${mentions.unresolved.map((path) => `@${path}`).join('、')}，按普通文字发送`,
        );
      }
      const branchFromMessageId = this.options.editingMessageId();
      if (branchFromMessageId !== undefined && this.options.isRunning()) {
        throw new PromptHeldBack('运行中不能改写提问，先按 Esc 中断');
      }
      const skillId = composer.takeSkillId();
      // Answers carried back from a side chat ride on this session's next prompt.
      handedOff = sideChat.takeRefs();
      const contextRefs = [...handedOff, ...mentions.refs];
      const input: PromptInput = {
        text,
        clientMessageId,
        ...(branchFromMessageId === undefined ? {} : { branchFromMessageId }),
        ...(attached.length === 0 ? {} : { attachments: attached.map((entry) => entry.attachment) }),
        ...(skillId === undefined ? {} : { skillId }),
        ...(contextRefs.length === 0 ? {} : { contextRefs }),
        ...composer.promptFields(),
      };
      const replacedRunId = prompt.replaceRunning ? this.options.runId() : undefined;
      if (this.options.isRunning() && replacedRunId === undefined) {
        // A turn is running: this one waits its turn on the Host and is
        // echoed when it starts. `/steer` is the way into the running turn.
        const place = await queue.submit(sessionId, input, clientMessageId);
        prompt.accepted = true;
        this.options.onHint(`已排队（第 ${place} 条），/queue 查看`);
        return;
      }
      this.options.echoUser(clientMessageId, text, describePromptExtras(input));
      echoed = true;
      const response =
        replacedRunId === undefined
          ? // A turn this shell has not heard about yet (its running push is still
            // on the way) makes the Host refuse an if-idle send; the shared
            // admission then queues it, exactly as Desktop's composer does.
            await requestPromptWithForeground({
              request: (command) => link.request(command),
              sessionId,
              input,
              queueWhenBusy: true,
              onQueue: () => {
                this.options.removeEcho(clientMessageId);
                echoed = false;
                return queue.request(sessionId, input, clientMessageId);
              },
            })
          : // Naming the run makes the Host refuse if a different turn is running by now.
            await link.request({
              type: 'session/prompt',
              sessionId,
              input,
              foreground: { kind: 'replace-run', runId: replacedRunId },
            });
      if (response.command === 'session/queued-turn-submit') {
        const place = queue.accept(response);
        prompt.accepted = true;
        this.options.onHint(`已排队（第 ${place} 条），/queue 查看`);
        return;
      }
      hostData(response);
      prompt.accepted = true;
      if (branchFromMessageId !== undefined) {
        // The old turn and its answer left the active path; reload rather than patch rows.
        this.options.clearEditing();
        await this.options.reloadSession(sessionId);
        return;
      }
    } catch (error) {
      if (!prompt.accepted) {
        attachments.restore(attached);
        sideChat.restoreRefs(handedOff);
        // The text returns to the composer; an echo beside it would show it twice.
        if (echoed) this.options.removeEcho(clientMessageId);
      }
      throw error;
    }
    await this.options.onTurnAccepted(sessionId);
  }
}
