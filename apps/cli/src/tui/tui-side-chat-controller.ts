import type { PromptContextRef, SessionSummary, SideChatOpenData } from '@piwin/contracts';
import { ChoiceOverlay } from './choice-overlay.js';
import type { TranscriptState } from './transcript-model.js';
import { hostData, type TuiHostLink } from './tui-host-link.js';
import type { TuiModalStack } from './tui-modals.js';

const NEW_SIDE_CHAT = '';
const LABEL_CHARS = 40;

export type TuiSideChatControllerOptions = {
  link: TuiHostLink;
  modals: TuiModalStack;
  getSessionId: () => string | undefined;
  getTranscript: () => TranscriptState;
  isRunning: () => boolean;
  openSession: (sessionId: string) => Promise<void>;
  onChanged: () => void;
  onHint: (text: string) => void;
  onNotice: (tone: 'info' | 'error', text: string) => void;
  onError: (error: unknown) => void;
};

type ListedSideChat = Pick<SessionSummary, 'name'> & { id?: string; sessionId?: string };

/** The latest finished answer of the side chat on screen: what a handoff carries back. */
export function findHandoffMessage(transcript: TranscriptState): { messageId: string; preview: string } | undefined {
  for (let index = transcript.entries.length - 1; index >= 0; index -= 1) {
    const entry = transcript.entries[index];
    if (entry?.kind === 'message' && entry.role === 'assistant' && entry.status === 'done' && entry.text.trim().length > 0) {
      const flat = entry.text.replace(/\s+/g, ' ').trim();
      return { messageId: entry.id, preview: flat.length > LABEL_CHARS ? `${flat.slice(0, LABEL_CHARS)}…` : flat };
    }
  }
  return undefined;
}

/**
 * Side chat: a linked session that starts from a snapshot of the main
 * conversation and never writes to it. This shell steps into one, and can
 * carry an answer back as a context ref on the main session's next prompt.
 *
 * It outlives session switches, unlike the per-session features: stepping in
 * and out *is* a session switch.
 */
export class TuiSideChatController {
  /** Set while a side chat this shell stepped into is on screen. */
  private inside: { sideChatSessionId: string; sourceSessionId: string } | undefined;
  /** Answers carried back, waiting for the main session's next prompt. */
  private handoff: { sourceSessionId: string; refs: PromptContextRef[] } | undefined;

  public constructor(private readonly options: TuiSideChatControllerOptions) {}

  private current(): { sideChatSessionId: string; sourceSessionId: string } | undefined {
    // The user may have switched sessions some other way; then this is no longer "inside".
    return this.inside?.sideChatSessionId === this.options.getSessionId() ? this.inside : undefined;
  }

  public describe(): string | undefined {
    if (this.current() !== undefined) return '侧聊 · /back 返回';
    const pending = this.pendingRefs().length;
    return pending === 0 ? undefined : `带回侧聊回答 ${pending}`;
  }

  /** `/side [name]`: step into a side chat of the session on screen. */
  public async open(name: string): Promise<void> {
    const sourceSessionId = this.options.getSessionId();
    if (sourceSessionId === undefined) {
      this.options.onHint('先有一段对话，才能开侧聊');
      return;
    }
    if (this.current() !== undefined) {
      this.options.onHint('已经在侧聊里，/back 返回主会话');
      return;
    }
    if (name.length > 0) {
      await this.create(sourceSessionId, name);
      return;
    }
    const listed = hostData<{ sessions?: ListedSideChat[] }>(
      await this.options.link.request({ type: 'side-chat/list', sourceSessionId }),
    ).sessions ?? [];
    const existing = listed.flatMap((session) => {
      const id = session.sessionId ?? session.id;
      return id === undefined ? [] : [{ id, name: session.name ?? '未命名侧聊' }];
    });
    if (existing.length === 0) {
      await this.create(sourceSessionId, '');
      return;
    }
    const { modals } = this.options;
    modals.show(
      new ChoiceOverlay({
        title: '侧聊',
        message: '侧聊从主会话当前的内容出发，但不会写回主会话。',
        items: [
          { value: NEW_SIDE_CHAT, label: '新开一个侧聊' },
          ...existing.map((session) => ({ value: session.id, label: session.name })),
        ],
        onSelect: (value) => {
          modals.close();
          const entering =
            value === NEW_SIDE_CHAT ? this.create(sourceSessionId, '') : this.enter(sourceSessionId, value);
          entering.catch(this.options.onError);
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  /** `/back`: return to the session the side chat was opened from. */
  public async back(): Promise<void> {
    const inside = this.current();
    if (inside === undefined) {
      this.options.onHint('现在不在侧聊里');
      return;
    }
    this.inside = undefined;
    await this.options.openSession(inside.sourceSessionId);
  }

  /** `/sync`: give the side chat what the main conversation has said since. */
  public async sync(): Promise<void> {
    const inside = this.current();
    if (inside === undefined) {
      this.options.onHint('只有在侧聊里才需要同步');
      return;
    }
    if (this.options.isRunning()) {
      this.options.onHint('运行中不能同步，先按 Esc 中断');
      return;
    }
    hostData(await this.options.link.request({ type: 'side-chat/sync', sideChatSessionId: inside.sideChatSessionId }));
    this.options.onNotice('info', '已同步主会话的最新内容');
  }

  /** `/handoff`: carry the side chat's latest answer back to the main session's next prompt. */
  public async handoffLatest(): Promise<void> {
    const inside = this.current();
    if (inside === undefined) {
      this.options.onHint('只有在侧聊里才能把回答带回主会话');
      return;
    }
    const answer = findHandoffMessage(this.options.getTranscript());
    if (answer === undefined) {
      this.options.onHint('侧聊里还没有可以带回的回答');
      return;
    }
    const ref: PromptContextRef = {
      kind: 'side-chat-message',
      sideChatSessionId: inside.sideChatSessionId,
      messageId: answer.messageId,
      label: answer.preview,
    };
    const pending = this.handoff?.sourceSessionId === inside.sourceSessionId ? this.handoff.refs : [];
    const alreadyCarried = pending.some((entry) => entry.kind === 'side-chat-message' && entry.messageId === answer.messageId);
    this.handoff = { sourceSessionId: inside.sourceSessionId, refs: alreadyCarried ? pending : [...pending, ref] };
    await this.back();
    this.options.onNotice('info', `侧聊的回答会随下一条消息带给主会话：${answer.preview}`);
  }

  /** Refs for a prompt being sent in the session on screen; taking them clears them. */
  public takeRefs(): PromptContextRef[] {
    const refs = this.pendingRefs();
    if (refs.length > 0) this.handoff = undefined;
    return refs;
  }

  /** A prompt that carried them was refused: keep them for the retry. */
  public restoreRefs(refs: readonly PromptContextRef[]): void {
    const sourceSessionId = this.options.getSessionId();
    if (refs.length > 0 && sourceSessionId !== undefined) this.handoff = { sourceSessionId, refs: [...refs] };
  }

  /** Only the session they were carried back to may spend them. */
  private pendingRefs(): PromptContextRef[] {
    const handoff = this.handoff;
    return handoff !== undefined && handoff.sourceSessionId === this.options.getSessionId() ? handoff.refs : [];
  }

  private async create(sourceSessionId: string, name: string): Promise<void> {
    const opened = hostData<SideChatOpenData>(
      await this.options.link.request({
        type: 'side-chat/open',
        sourceSessionId,
        ...(name.length === 0 ? {} : { name }),
      }),
    );
    await this.enter(sourceSessionId, opened.sideChatSessionId);
  }

  private async enter(sourceSessionId: string, sideChatSessionId: string): Promise<void> {
    this.inside = { sideChatSessionId, sourceSessionId };
    await this.options.openSession(sideChatSessionId);
    this.options.onNotice(
      'info',
      '这是侧聊：知道主会话到目前为止的内容，但不会写回去。/sync 同步主会话的新内容 · /handoff 把最新回答带回主会话 · /back 返回',
    );
    this.options.onChanged();
  }
}
