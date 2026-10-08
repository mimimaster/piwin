import type { HostPush } from '@piwin/contracts';
import { describePromptExtras } from './queued-turns.js';
import type { TranscriptState } from './transcript-model.js';
import { TuiBranchController } from './tui-branch-controller.js';
import type { TuiHostLink } from './tui-host-link.js';
import type { TuiModalStack } from './tui-modals.js';
import { TuiPlanController } from './tui-plan-controller.js';
import { TuiQueueController } from './tui-queue-controller.js';
import { TuiSubagentController } from './tui-subagent-controller.js';
import { TuiTurnChangeController } from './tui-turn-change-controller.js';
import { TuiWalkthroughController } from './tui-walkthrough-controller.js';

/** What the per-session features need from the app that owns the screen. */
export type TuiSessionFeaturesPort = {
  link: TuiHostLink;
  modals: TuiModalStack;
  /** Desktop owns which session is shown when the TUI is embedded. */
  embedded: boolean;
  getSessionId: () => string | undefined;
  /** Run id of the turn in flight, when the Host has named it. */
  getRunId: () => string | undefined;
  getTranscript: () => TranscriptState;
  isRunning: () => boolean;
  openSession: (sessionId: string) => Promise<void>;
  onChanged: () => void;
  onHint: (text: string) => void;
  onNotice: (tone: 'info' | 'error', text: string) => void;
  onError: (error: unknown) => void;
  /** Show a user turn this shell did not type just now (a queued turn starting). */
  echoUser: (messageId: string, text: string, annotations: string[]) => void;
  setComposerText: (text: string) => void;
};

/**
 * Everything the Host keeps per session besides the transcript: plan, queue,
 * branches, subagents, file changes, walkthroughs. Each controller follows
 * its own pushes; the app loads, resets and asks them all through here.
 */
export class TuiSessionFeatures {
  public readonly plans: TuiPlanController;
  public readonly queue: TuiQueueController;
  public readonly branches: TuiBranchController;
  public readonly subagents: TuiSubagentController;
  public readonly turnChanges: TuiTurnChangeController;
  public readonly walkthroughs: TuiWalkthroughController;

  public constructor(port: TuiSessionFeaturesPort) {
    const { link, modals, getSessionId, onChanged, onHint, onNotice, onError } = port;
    const base = { link, modals, getSessionId, onChanged, onHint, onError };
    this.plans = new TuiPlanController({ ...base, onNotice });
    this.queue = new TuiQueueController({
      ...base,
      getRunId: port.getRunId,
      onSteered: (turn) =>
        port.echoUser(turn.userMessageId, turn.input.text, [...describePromptExtras(turn.input), '插入当前回合']),
      onStarted: (turn) => port.echoUser(turn.userMessageId, turn.input.text, describePromptExtras(turn.input)),
      onEdit: port.setComposerText,
    });
    this.branches = new TuiBranchController({ ...base, reloadSession: port.openSession });
    this.subagents = new TuiSubagentController({
      ...base,
      onNotice,
      embedded: port.embedded,
      openSession: port.openSession,
    });
    this.turnChanges = new TuiTurnChangeController({
      link,
      modals,
      getSessionId,
      getTranscript: port.getTranscript,
      isRunning: port.isRunning,
      onHint,
      onNotice,
      onError,
    });
    this.walkthroughs = new TuiWalkthroughController({ ...base, onNotice, getTranscript: port.getTranscript });
  }

  /** Read what the Host holds for a session being opened. */
  public async load(sessionId: string): Promise<void> {
    await Promise.all([
      this.plans.load(sessionId),
      this.queue.load(sessionId),
      this.branches.load(sessionId),
      this.subagents.load(sessionId),
    ]);
  }

  /** Forget the previous session; a draft has none of this yet. */
  public reset(): void {
    this.plans.reset();
    this.queue.reset();
    this.branches.reset();
    this.subagents.reset();
    this.turnChanges.reset();
    this.walkthroughs.reset();
  }

  /** True when one of the features claimed the push. */
  public handlePush(push: HostPush): boolean {
    return (
      this.plans.handlePush(push) ||
      this.queue.handlePush(push) ||
      this.branches.handlePush(push) ||
      this.subagents.handlePush(push) ||
      this.turnChanges.handlePush(push) ||
      this.walkthroughs.handlePush(push)
    );
  }

  /** Status-line parts, in display order. */
  public describe(): Array<string | undefined> {
    return [
      this.plans.describe(),
      this.queue.describe(),
      this.branches.describe(),
      this.subagents.describe(),
      this.walkthroughs.describe(),
    ];
  }
}
