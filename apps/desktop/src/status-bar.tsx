/**
 * Status bar — persistent bottom strip showing agent state, skills/MCP counts,
 * model info, and context usage at a glance.
 */
import type { ReactElement } from 'react';
import { IconSpark, IconMcp, IconSkill } from './shell-icons';

export type StatusBarProps = {
  /** Active model label */
  modelLabel?: string;
  /** Number of enabled skills */
  skillsCount?: number;
  /** Number of running MCP servers */
  mcpCount?: number;
  /** Number of enabled extensions */
  extensionsCount?: number;
  /** Agent run state */
  agentState?: 'idle' | 'running' | 'error';
  /**
   * Quiet workbench: terminal produced output while the work panel is on
   * directory home or collapsed — pulse the ready dot; never auto-open panel.
   */
  terminalAttention?: boolean;
  /** Current branch name */
  branch?: string;
  /**
   * Context usage percent (0–100). Omit until the first Host usage sample so
   * empty sessions do not show a fake 0% ring.
   */
  contextPercent?: number;
  /** Click handlers */
  onOpenSkills?: () => void;
  onOpenMcp?: () => void;
  onOpenExtensions?: () => void;
  locale?: 'zh-CN' | 'en';
};

export function StatusBar(props: StatusBarProps): ReactElement {
  const locale = props.locale ?? 'zh-CN';
  const contextPercent =
    typeof props.contextPercent === 'number' ? props.contextPercent : undefined;
  const contextTone =
    contextPercent === undefined
      ? 'ok'
      : contextPercent >= 90
        ? 'critical'
        : contextPercent >= 70
          ? 'warn'
          : 'ok';

  const agentState = props.agentState ?? 'idle';
  const terminalAttention = props.terminalAttention === true && agentState !== 'running';

  return (
    <footer
      className="status-bar"
      data-testid="status-bar"
      data-terminal-attention={terminalAttention ? 'true' : 'false'}
    >
      <div className="status-bar-left">
        {/* Agent state */}
        <span
          className={`status-bar-agent state-${agentState}${
            terminalAttention ? ' has-terminal-attention' : ''
          }`}
        >
          <i className="status-bar-dot" aria-hidden />
          <span>
            {agentState === 'running'
              ? locale === 'zh-CN' ? '运行中' : 'Running'
              : agentState === 'error'
                ? locale === 'zh-CN' ? '异常' : 'Error'
                : locale === 'zh-CN' ? '就绪' : 'Ready'}
          </span>
        </span>

        {/* Branch */}
        {props.branch ? (
          <span className="status-bar-branch" title={props.branch}>
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
              <circle cx="4" cy="4" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="4" cy="12" r="1.5" />
              <path d="M4 5.5v5M4 8h5.5a2.5 2.5 0 0 1 2.5 2.5" />
            </svg>
            {props.branch}
          </span>
        ) : null}
      </div>

      <div className="status-bar-right">
        {/* Context usage — only after the first measured usage sample */}
        {typeof contextPercent === 'number' ? (
          <span
            className={`status-bar-context tone-${contextTone}`}
            title={`Context ${contextPercent}%`}
            data-testid="status-bar-context"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
              <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
              <circle
                cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5"
                strokeDasharray={`${2 * Math.PI * 6}`}
                strokeDashoffset={`${2 * Math.PI * 6 * (1 - contextPercent / 100)}`}
                strokeLinecap="round"
                transform="rotate(-90 8 8)"
              />
            </svg>
            {contextPercent}%
          </span>
        ) : null}

        {/* Skills count */}
        <button
          type="button"
          className="status-bar-chip"
          title={locale === 'zh-CN' ? `技能: ${props.skillsCount ?? 0}` : `Skills: ${props.skillsCount ?? 0}`}
          onClick={props.onOpenSkills}
        >
          <IconSkill width={14} height={14} />
          <span>{props.skillsCount ?? 0}</span>
        </button>

        {/* MCP count */}
        <button
          type="button"
          className="status-bar-chip"
          title={locale === 'zh-CN' ? `MCP 服务: ${props.mcpCount ?? 0}` : `MCP servers: ${props.mcpCount ?? 0}`}
          onClick={props.onOpenMcp}
        >
          <IconMcp width={14} height={14} />
          <span>{props.mcpCount ?? 0}</span>
        </button>

        {/* Model label */}
        {props.modelLabel ? (
          <span className="status-bar-model" title={props.modelLabel}>
            <IconSpark width={12} height={12} />
            {props.modelLabel}
          </span>
        ) : null}
      </div>
    </footer>
  );
}
