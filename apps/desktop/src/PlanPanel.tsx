import { useCallback, useEffect, useState } from 'react';
import type { HostResponse, PlanStepStatus, SessionPlan } from '@piwin/contracts';

type PlanRequest =
  | { type: 'plan/get'; sessionId: string }
  | { type: 'plan/set'; sessionId: string; plan: SessionPlan }
  | { type: 'plan/clear'; sessionId: string }
  | { type: 'plan/approve'; sessionId: string }
  | {
      type: 'plan/update-step';
      sessionId: string;
      stepId: string;
      status: PlanStepStatus;
      detail?: string;
    }
  | { type: 'plan/set-status'; sessionId: string; status: SessionPlan['status'] };

export type PlanPanelProps = {
  sessionId: string | null;
  projectPath: string | null;
  plan: SessionPlan | null;
  onPlanChange: (plan: SessionPlan | null) => void;
  request: (command: PlanRequest) => Promise<HostResponse>;
  /** Drawer mode only — omit or no-op when embedded in right panel. */
  onClose?: () => void;
  /** docked in right inspector (no chrome drawer). */
  variant?: 'drawer' | 'embedded';
};

/**
 * Session plan artifact panel (application-layer plan mode).
 * Draft → Approve → host injects plan context; step checklist for progress.
 */
export function PlanPanel(props: PlanPanelProps) {
  const [title, setTitle] = useState('New plan');
  const [goal, setGoal] = useState('');
  const [stepsText, setStepsText] = useState('1. Investigate\n2. Implement\n3. Verify');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isDraft = !props.plan || props.plan.status === 'draft';

  const reload = useCallback(async () => {
    if (!props.sessionId) {
      setError('Create or select a session first');
      return;
    }
    setBusy(true);
    setError(null);
    const response = await props.request({ type: 'plan/get', sessionId: props.sessionId });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const plan = (response.data as { plan: SessionPlan | null }).plan;
    props.onPlanChange(plan);
    if (plan) {
      setTitle(plan.title);
      setGoal(plan.goal);
      setStepsText(plan.steps.map((step, index) => `${index + 1}. ${step.title}`).join('\n'));
    }
  }, [props]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.sessionId]);

  useEffect(() => {
    if (props.plan) {
      setTitle(props.plan.title);
      setGoal(props.plan.goal);
      setStepsText(
        props.plan.steps.map((step, index) => `${index + 1}. ${step.title}`).join('\n'),
      );
    }
  }, [props.plan]);

  function parseSteps(raw: string): SessionPlan['steps'] {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const cleaned = line.replace(/^\d+[.)]\s*/, '').replace(/^[-*]\s*/, '');
        return {
          id: String(index + 1),
          title: cleaned || `Step ${index + 1}`,
          status: 'pending' as const,
        };
      });
  }

  async function handleSaveDraft(): Promise<void> {
    if (!props.sessionId || !props.projectPath) {
      setError('Session and project required');
      return;
    }
    const now = new Date().toISOString();
    const steps = parseSteps(stepsText);
    if (steps.length === 0) {
      setError('Add at least one step');
      return;
    }
    if (!goal.trim()) {
      setError('Goal is required');
      return;
    }
    const plan: SessionPlan = {
      id: props.plan?.id ?? `plan-${Date.now().toString(36)}`,
      sessionId: props.sessionId,
      projectPath: props.projectPath,
      status: 'draft',
      title: title.trim() || 'Untitled plan',
      goal: goal.trim(),
      steps,
      revision: props.plan?.revision ?? 0,
      createdAt: props.plan?.createdAt ?? now,
      updatedAt: now,
      source: 'user',
    };
    setBusy(true);
    setError(null);
    const response = await props.request({
      type: 'plan/set',
      sessionId: props.sessionId,
      plan,
    });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    props.onPlanChange((response.data as { plan: SessionPlan }).plan);
  }

  async function handleApprove(): Promise<void> {
    if (!props.sessionId) return;
    if (!props.plan) {
      await handleSaveDraft();
    }
    setBusy(true);
    const response = await props.request({ type: 'plan/approve', sessionId: props.sessionId });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    props.onPlanChange((response.data as { plan: SessionPlan }).plan);
  }

  async function handleClear(): Promise<void> {
    if (!props.sessionId) return;
    setBusy(true);
    const response = await props.request({ type: 'plan/clear', sessionId: props.sessionId });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    props.onPlanChange(null);
    setGoal('');
  }

  async function handleStepToggle(stepId: string, current: PlanStepStatus): Promise<void> {
    if (!props.sessionId) return;
    const next: PlanStepStatus =
      current === 'done' ? 'pending' : current === 'active' ? 'done' : 'done';
    setBusy(true);
    const response = await props.request({
      type: 'plan/update-step',
      sessionId: props.sessionId,
      stepId,
      status: next,
    });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    props.onPlanChange((response.data as { plan: SessionPlan }).plan);
  }

  async function handleStepStatus(stepId: string, status: PlanStepStatus): Promise<void> {
    if (!props.sessionId) return;
    setBusy(true);
    const response = await props.request({
      type: 'plan/update-step',
      sessionId: props.sessionId,
      stepId,
      status,
    });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    props.onPlanChange((response.data as { plan: SessionPlan }).plan);
  }

  async function handleMarkNextActive(): Promise<void> {
    if (!props.sessionId || !props.plan) return;
    const previousActive = props.plan.steps.find((step) => step.status === 'active');
    if (previousActive) {
      await handleStepStatus(previousActive.id, 'done');
    }
    // After marking previous active as done, prefer next pending from optimistic local state.
    const planAfter =
      previousActive && props.plan
        ? {
            ...props.plan,
            steps: props.plan.steps.map((step) =>
              step.id === previousActive.id ? { ...step, status: 'done' as const } : step,
            ),
          }
        : props.plan;
    const nextPending = planAfter.steps.find((step) => step.status === 'pending');
    if (!nextPending) {
      setError('No pending steps');
      return;
    }
    await handleStepStatus(nextPending.id, 'active');
  }

  const embedded = props.variant === 'embedded';

  return (
    <div
      className={embedded ? 'embedded-panel plan-panel' : 'drawer-panel plan-panel'}
      role={embedded ? 'region' : 'dialog'}
      aria-label="Session plan"
    >
      {embedded ? null : (
        <header className="drawer-header">
          <strong>Plan</strong>
          <button type="button" className="btn" onClick={() => props.onClose?.()}>
            Close
          </button>
        </header>
      )}
      <div className={embedded ? 'embedded-body' : 'drawer-body'}>
        {embedded ? null : (
          <p className="muted">
            Application-layer plan mode. Approving injects the plan into model context. Check off
            steps manually or let the model call piwin_plan_set_step (SDK).
          </p>
        )}
        {props.plan ? (
          <div className="plan-status">
            Status: <strong>{props.plan.status}</strong> · rev {props.plan.revision}
          </div>
        ) : (
          <div className="muted">No plan for this session yet.</div>
        )}
        {isDraft ? (
          <>
            <label className="field">
              <span>Title</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="field">
              <span>Goal</span>
              <textarea rows={3} value={goal} onChange={(event) => setGoal(event.target.value)} />
            </label>
            <label className="field">
              <span>Steps (one per line)</span>
              <textarea
                rows={6}
                value={stepsText}
                onChange={(event) => setStepsText(event.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            <div>
              <strong>{props.plan?.title}</strong>
            </div>
            <p className="muted">{props.plan?.goal}</p>
          </>
        )}
        {error ? <div className="error-banner">{error}</div> : null}
        <div className="drawer-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void reload()}>
            Reload
          </button>
          {isDraft ? (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void handleSaveDraft()}
            >
              Save draft
            </button>
          ) : null}
          <button
            type="button"
            className="btn primary"
            disabled={busy || !props.sessionId}
            onClick={() => void handleApprove()}
          >
            Approve
          </button>
          {!isDraft && props.plan ? (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void handleMarkNextActive()}
            >
              Mark next active
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            disabled={busy || !props.plan}
            onClick={() => void handleClear()}
          >
            Clear
          </button>
        </div>
        {props.plan ? (
          <ol className="plan-step-list">
            {props.plan.steps.map((step) => (
              <li key={step.id}>
                <label className="checkbox-row" style={{ alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={step.status === 'done' || step.status === 'skipped'}
                    disabled={busy}
                    onChange={() => void handleStepToggle(step.id, step.status)}
                  />
                  <span>
                    <span className="muted">[{step.status}]</span> {step.title}
                    {step.detail ? (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {step.detail}
                      </div>
                    ) : null}
                  </span>
                </label>
                <select
                  value={step.status}
                  disabled={busy}
                  onChange={(event) =>
                    void handleStepStatus(step.id, event.target.value as PlanStepStatus)
                  }
                  aria-label={`Status for step ${step.id}`}
                >
                  <option value="pending">pending</option>
                  <option value="active">active</option>
                  <option value="done">done</option>
                  <option value="skipped">skipped</option>
                </select>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
