/**
 * PermissionBar — docked permission prompt using the shared
 * AgentInterruptionFrame (ADR 0024). Sits above the composer so the approval
 * surface stays visible while the user scrolls the transcript.
 *
 * Structure:
 *   AgentInterruptionFrame (warning/danger tone)
 *     .permission-bar-subject   — one-line visible fact (command/path/host)
 *     .permission-bar-detail    — collapsible full facts (PermissionFacts)
 *     .permission-bar-actions   — Allow session / once / project / Deny
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Button, Collapse } from '@piwin/ui-kit';
import type { PermissionDecision, PermissionRememberScope } from '@piwin/contracts';
import type { PermissionPromptUi } from './chat-reducer';
import { PermissionFacts, canRememberPermissionForProject } from './permission-request-card';
import { AgentInterruptionFrame, type AgentInterruptionTone } from './agent-interruption-frame';
import { useDesktopLocale } from './desktop-locale-context';
import { IconChevronDown } from './shell-icons';
import { getBehaviorActivitySpec } from './behavior-activity.js';

export type PermissionBarProps = {
  prompt: PermissionPromptUi;
  /** Current project path; when absent, "allow for project" is hidden. */
  projectPath: string | null;
  /** Existing respond handler from use-session-actions (allow / deny / ask). */
  onPermission: (decision: PermissionDecision, rememberScope?: PermissionRememberScope) => void;
  /** Remaining prompts after the one currently shown. */
  queuedRemaining?: number;
  /**
   * Set when the prompt belongs to another session (a subagent child or a
   * background session). The workspace fact then shows where that session runs.
   */
  origin?: { kind: 'subagent' | 'session'; name: string; workingDirectory?: string };
};

/**
 * The shortcuts are document-wide so they work while reading the transcript,
 * but a focused control or an open dialog owns its own keys: Enter on a
 * focused Deny button must not grant, and Esc closing a dialog must not deny.
 */
function isKeyOwnedByTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'INPUT' ||
    target.tagName === 'SELECT' ||
    target.tagName === 'BUTTON' ||
    target.tagName === 'A' ||
    target.isContentEditable
  ) {
    return true;
  }
  return target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null;
}

/**
 * The same child prompt can render twice (the docked panel and an open
 * subagent inspector). Only the first mounted bar owns the keyboard for a
 * request, so one Enter never resolves it twice.
 */
const keyboardOwners = new Map<string, symbol>();

function hasOpenModal(): boolean {
  // Radix dialogs mark themselves with role + data-state rather than aria-modal.
  return (
    document.querySelector(
      '[aria-modal="true"], dialog[open], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    ) !== null
  );
}

/** Compact one-line subject shown before the details disclosure. */
function permissionSubject(
  prompt: PermissionPromptUi,
): string {
  const context = prompt.context;
  if (context?.summary) return context.summary;
  if (context?.command) return context.command;
  if (context?.host) return context.host;
  if (context?.paths && context.paths.length > 0) return context.paths[0]!;
  return prompt.action;
}

/** High-risk requests should start with details expanded. */
function shouldDefaultExpand(prompt: PermissionPromptUi): boolean {
  const context = prompt.context;
  if (!context) return false;
  return (
    context.destructive === true ||
    context.secretRelated === true ||
    context.kind === 'unknown'
  );
}

export function PermissionBar(props: PermissionBarProps): ReactElement {
  const { prompt, projectPath, origin } = props;
  const workspacePath = origin?.workingDirectory ?? projectPath;
  const { translator, locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const copy = translator.interruption;
  const [expanded, setExpanded] = useState(() => shouldDefaultExpand(prompt));
  const [stamping, setStamping] = useState(false);
  const context = prompt.context ?? null;
  const canRemember =
    canRememberPermissionForProject(context, prompt.action) && Boolean(projectPath);
  const isDanger = context?.destructive === true || context?.secretRelated === true;
  const tone: AgentInterruptionTone = isDanger ? 'danger' : 'warning';
  const subject = permissionSubject(prompt);
  const detailId = `permission-detail-${prompt.requestId}`;
  const queuedRemaining = props.queuedRemaining ?? 0;

  // Seal-stamp keyboard contract: Enter grants (session-scoped) with a stamp
  // flourish before the decision fires, Esc denies immediately. Skipped while
  // focus is in an editable field so it never fights the composer or an
  // in-place edit textarea. Each prompt (keyed by requestId) re-arms once.
  const onPermissionRef = useRef(props.onPermission);
  onPermissionRef.current = props.onPermission;
  useEffect(() => {
    setStamping(false);
    const requestId = prompt.requestId;
    if (keyboardOwners.has(requestId)) return;
    const owner = Symbol(requestId);
    keyboardOwners.set(requestId, owner);
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || isKeyOwnedByTarget(event.target) || hasOpenModal()) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        setStamping(true);
        window.setTimeout(() => {
          onPermissionRef.current('allow', 'session');
        }, 160);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onPermissionRef.current('deny');
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (keyboardOwners.get(requestId) === owner) keyboardOwners.delete(requestId);
    };
  }, [prompt.requestId]);

  const queueBadge =
    queuedRemaining > 0 ? (
      <span className="permission-queue-pill" data-testid="permission-queue-badge">
        {copy.queuedRemaining(queuedRemaining)}
      </span>
    ) : null;

  return (
    <AgentInterruptionFrame
      tone={tone}
      statusLabel={copy.approvalRequired}
      title={subject}
      badgeTrailing={queueBadge}
      testId="permission-bar"
      activityId="permission"
      activityAnimation={getBehaviorActivitySpec('permission').animation}
      activityStatus="running"
    >
      <div className="permission-bar-quick-facts">
        {origin ? (
          <span className="permission-fact-item" data-testid="permission-bar-origin">
            {origin.kind === 'subagent'
              ? isZh
                ? '子代理'
                : 'Subagent'
              : isZh
                ? '其他会话'
                : 'Other session'}{' '}
            · <strong>{origin.name}</strong>
          </span>
        ) : null}
        {workspacePath ? (
          <span className="permission-fact-item">
            {isZh ? '工作目录' : 'Workspace'} · <code>{workspacePath}</code>
          </span>
        ) : null}
        <span className="permission-fact-item">
          {isZh ? '规则' : 'Rule'} · <code>{prompt.defaultDecision}</code>
        </span>
        {context?.destructive ? (
          <span className="permission-fact-item permission-risk-danger">
            {isZh ? '风险 · 破坏性操作' : 'Risk · Destructive'}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        className="permission-bar-disclosure"
        aria-expanded={expanded}
        aria-controls={detailId}
        data-testid="permission-bar-toggle"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="permission-bar-disclosure-label">
          {expanded ? copy.collapseDetails : copy.expandDetails}
        </span>
        <IconChevronDown
          className={`permission-bar-chevron${expanded ? ' is-expanded' : ''}`}
        />
      </button>

      <Collapse expanded={expanded} testId="permission-bar-detail">
        <div id={detailId} className="permission-bar-detail-inner">
          <PermissionFacts action={prompt.action} detail={prompt.detail} context={context} />
        </div>
      </Collapse>

      <div className="permission-bar-actions">
        <Button
          variant="primary"
          size="compact"
          className={`permission-bar-btn-allow-session permission-bar-seal${stamping ? ' is-stamping' : ''}`}
          data-testid="permission-bar-allow-session"
          title={`${copy.allowForSession} (Enter)`}
          onClick={() => {
            setStamping(true);
            window.setTimeout(() => props.onPermission('allow', 'session'), 160);
          }}
        >
          <span className="agent-interruption-choice-badge">A</span>
          <span>{copy.allowForSession}</span>
        </Button>
        <Button
          variant="secondary"
          size="compact"
          className="permission-bar-btn-allow-once"
          data-testid="permission-bar-allow-once"
          onClick={() => props.onPermission('allow', 'once')}
        >
          <span className="agent-interruption-choice-badge">B</span>
          <span>{copy.allowOnce}</span>
        </Button>
        {canRemember ? (
          <Button
            variant="secondary"
            size="compact"
            className="permission-bar-btn-allow-project"
            data-testid="permission-bar-allow-project"
            title={copy.allowForProject}
            onClick={() => props.onPermission('allow', 'project')}
          >
            <span className="agent-interruption-choice-badge">C</span>
            <span>{copy.allowForProject}</span>
          </Button>
        ) : null}
        <Button
          variant="danger"
          size="compact"
          className="permission-bar-btn-deny"
          data-testid="permission-bar-deny"
          title={`${copy.deny} (Esc)`}
          onClick={() => props.onPermission('deny')}
        >
          <span className="agent-interruption-choice-badge">{canRemember ? 'D' : 'C'}</span>
          <span>{copy.deny}</span>
        </Button>
      </div>
      <p className="permission-bar-kbd-hint" aria-hidden="true">
        <kbd>Enter</kbd> {copy.allowForSession} · <kbd>Esc</kbd> {copy.deny}
      </p>
    </AgentInterruptionFrame>
  );
}
