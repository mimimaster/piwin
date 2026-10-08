import type { HostCommand, HostPush, SessionPlan } from '@piwin/contracts';
import { ChoiceOverlay } from './choice-overlay.js';
import {
  describePlan,
  describePlanChange,
  planActionItems,
  renderPlanText,
  type PlanAction,
} from './plan-view.js';
import { hostData, type TuiHostLink } from './tui-host-link.js';
import type { TuiModalStack } from './tui-modals.js';

export type TuiPlanControllerOptions = {
  link: TuiHostLink;
  modals: TuiModalStack;
  getSessionId: () => string | undefined;
  onChanged: () => void;
  onHint: (text: string) => void;
  onNotice: (tone: 'info' | 'error', text: string) => void;
  onError: (error: unknown) => void;
};

/**
 * The session plan as the Host holds it. The TUI never edits the document:
 * it shows it and asks the Host to approve, execute, stop or clear it, and
 * follows `plan/updated` for everything that happens next.
 */
export class TuiPlanController {
  private plan: SessionPlan | null = null;

  public constructor(private readonly options: TuiPlanControllerOptions) {}

  public describe(): string | undefined {
    return describePlan(this.plan);
  }

  public reset(): void {
    this.plan = null;
  }

  /** Read the plan of a session being opened; announces nothing, it is not news. */
  public async load(sessionId: string): Promise<void> {
    const response = await this.options.link.request({ type: 'plan/get', sessionId });
    if (this.options.getSessionId() !== sessionId) return;
    this.plan = response.success ? ((response.data as { plan?: SessionPlan | null }).plan ?? null) : null;
  }

  /** Returns true when the push was about this session's plan. */
  public handlePush(push: HostPush): boolean {
    const sessionId = this.options.getSessionId();
    if (sessionId === undefined) return false;
    if (push.type === 'plan/updated' && push.sessionId === sessionId) {
      this.replace(push.plan);
      return true;
    }
    if (push.type === 'plan/execution-updated' && push.state.sessionId === sessionId) {
      if (this.plan !== null && this.plan.id === push.state.planId) {
        this.replace({ ...this.plan, execution: push.state });
      }
      return true;
    }
    return false;
  }

  public open(): void {
    const plan = this.plan;
    if (plan === null) {
      this.options.onHint('这个会话还没有计划');
      return;
    }
    const { modals } = this.options;
    modals.show(
      new ChoiceOverlay({
        title: '计划',
        message: renderPlanText(plan),
        items: planActionItems(plan),
        onSelect: (value) => {
          modals.close();
          this.run(value as PlanAction, plan);
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  private replace(next: SessionPlan | null): void {
    const notice = describePlanChange(this.plan, next);
    this.plan = next;
    if (notice !== undefined) {
      this.options.onNotice(next?.execution?.status === 'failed' ? 'error' : 'info', notice);
    }
    this.options.onChanged();
  }

  private run(action: PlanAction, plan: SessionPlan): void {
    const command = commandFor(action, plan);
    if (command === undefined) return;
    this.options.link.request(command).then(hostData).catch(this.options.onError);
  }
}

/** `expectedRevision` makes the Host refuse to act on a plan that changed under the overlay. */
function commandFor(action: PlanAction, plan: SessionPlan): HostCommand | undefined {
  const { sessionId, id: planId, revision } = plan;
  switch (action) {
    case 'execute-inline':
    case 'execute-subagents':
      return {
        type: 'plan/execute',
        request: {
          sessionId,
          planId,
          mode: action === 'execute-inline' ? 'inline' : 'subagent-driven',
          expectedRevision: revision,
          ...(plan.status === 'draft' ? { approveDraft: true } : {}),
        },
      };
    case 'approve':
      return { type: 'plan/approve', sessionId };
    case 'abandon':
      return { type: 'plan/set-status', sessionId, status: 'abandoned' };
    case 'abort':
      return { type: 'plan/abort', sessionId, planId };
    case 'clear':
      return { type: 'plan/clear', sessionId, expected: { planId, revision } };
    case 'close':
      return undefined;
  }
}
