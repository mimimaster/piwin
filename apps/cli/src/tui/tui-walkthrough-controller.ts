import type { HostPush, WalkthroughArtifact, WalkthroughListData } from '@piwin/contracts';
import { ChoiceOverlay } from './choice-overlay.js';
import type { TranscriptState } from './transcript-model.js';
import { hostData, type TuiHostLink } from './tui-host-link.js';
import type { TuiModalStack } from './tui-modals.js';
import { ViewerOverlay } from './viewer-overlay.js';

export type TuiWalkthroughControllerOptions = {
  link: TuiHostLink;
  modals: TuiModalStack;
  getSessionId: () => string | undefined;
  getTranscript: () => TranscriptState;
  onChanged: () => void;
  onHint: (text: string) => void;
  onNotice: (tone: 'info' | 'error', text: string) => void;
  onError: (error: unknown) => void;
};

/** The assistant answer a walkthrough is written about: the latest finished one. */
export function findLatestAnswer(transcript: TranscriptState): { messageId: string; runId?: string } | undefined {
  for (let index = transcript.entries.length - 1; index >= 0; index -= 1) {
    const entry = transcript.entries[index];
    if (entry?.kind === 'message' && entry.role === 'assistant' && entry.status === 'done') {
      return { messageId: entry.id, ...(entry.runId === undefined ? {} : { runId: entry.runId }) };
    }
  }
  return undefined;
}

/** The newest walkthrough for a message; a regeneration supersedes the earlier one. */
export function pickWalkthrough(
  artifacts: readonly WalkthroughArtifact[],
  messageId: string,
): WalkthroughArtifact | undefined {
  return artifacts
    .filter((artifact) => artifact.messageId === messageId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

/**
 * Walkthroughs: the Host's evidence-based delivery report for an answer. The
 * Host writes them with a separate model call; this shell asks for one,
 * follows `walkthrough/updated`, and shows the Markdown.
 */
export class TuiWalkthroughController {
  /** Messages whose walkthrough this shell asked for, to announce when it lands. */
  private readonly awaited = new Set<string>();
  private generating = 0;

  public constructor(private readonly options: TuiWalkthroughControllerOptions) {}

  public describe(): string | undefined {
    return this.generating > 0 ? '报告生成中…' : undefined;
  }

  public reset(): void {
    this.awaited.clear();
    this.generating = 0;
  }

  /** Returns true when the push was a walkthrough update. */
  public handlePush(push: HostPush): boolean {
    if (push.type !== 'walkthrough/updated') return false;
    const { artifact } = push;
    if (push.sessionId !== this.options.getSessionId() || !this.awaited.has(artifact.messageId)) return true;
    if (artifact.status === 'generating') return true;
    this.awaited.delete(artifact.messageId);
    this.generating = Math.max(0, this.generating - 1);
    if (artifact.status === 'ready') this.options.onNotice('info', '交付报告已生成 · /walkthrough 查看');
    else if (artifact.error.code !== 'cancelled') this.options.onNotice('error', `交付报告没有生成 — ${artifact.error.message}`);
    this.options.onChanged();
    return true;
  }

  /** `/walkthrough`: show the latest answer's report, or write one. `force` writes a new one. */
  public async open(force: boolean): Promise<void> {
    const sessionId = this.options.getSessionId();
    const answer = findLatestAnswer(this.options.getTranscript());
    if (sessionId === undefined || answer === undefined) {
      this.options.onHint('还没有可以写报告的回答');
      return;
    }
    const { artifacts } = hostData<WalkthroughListData>(
      await this.options.link.request({ type: 'walkthrough/list', sessionId }),
    );
    const existing = pickWalkthrough(artifacts, answer.messageId);
    if (existing?.status === 'generating') {
      this.offerCancel(sessionId, existing);
      return;
    }
    if (existing?.status === 'ready' && !force) {
      this.show(existing.markdown, existing.truncated === true);
      return;
    }
    await this.generate(sessionId, answer, force || existing !== undefined);
  }

  private async generate(
    sessionId: string,
    answer: { messageId: string; runId?: string },
    force: boolean,
  ): Promise<void> {
    this.awaited.add(answer.messageId);
    this.generating += 1;
    this.options.onChanged();
    const response = await this.options.link.request({
      type: 'walkthrough/generate',
      sessionId,
      messageId: answer.messageId,
      ...(answer.runId === undefined ? {} : { runId: answer.runId }),
      ...(force ? { force: true } : {}),
    });
    if (response.success) {
      this.options.onHint('正在写交付报告，写好会提示');
      return;
    }
    this.awaited.delete(answer.messageId);
    this.generating = Math.max(0, this.generating - 1);
    this.options.onNotice('error', `交付报告没有生成 — ${response.error}`);
    this.options.onChanged();
  }

  private offerCancel(sessionId: string, artifact: Extract<WalkthroughArtifact, { status: 'generating' }>): void {
    const { link, modals } = this.options;
    modals.show(
      new ChoiceOverlay({
        title: '交付报告',
        message: '这份报告还在写。',
        items: [
          { value: 'wait', label: '继续等' },
          { value: 'cancel', label: '取消生成' },
        ],
        onSelect: (value) => {
          modals.close();
          if (value !== 'cancel') return;
          link
            .request({
              type: 'walkthrough/cancel',
              sessionId,
              messageId: artifact.messageId,
              generationId: artifact.generationId,
            })
            .then(hostData)
            .then(() => this.options.onHint('已取消'))
            .catch(this.options.onError);
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  private show(markdown: string, truncated: boolean): void {
    const { modals } = this.options;
    modals.show(
      new ViewerOverlay({
        title: truncated ? '交付报告（已截断）' : '交付报告',
        lines: markdown.split('\n'),
        onClose: () => modals.close(),
      }),
    );
  }
}
