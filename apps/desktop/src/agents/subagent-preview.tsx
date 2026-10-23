/**
 * Dense subagent preview (Inkstone proto-14 ③), opened by clicking a row.
 *
 *   scout · sonnet · 14 次工具调用 · 31k tok · 1m 12s · 运行中
 *   任务 <full task text>
 *   0:03 read  packages/auth/refresh.ts       ✓ 212 行     (one line per step)
 *   需要权限 <action>  [允许] [本会话总是允许] [拒绝]       (only while pending)
 *   结论 <final report, plain text>
 *
 * Its own renderer on purpose: no Markdown, tool cards, diffs or artifacts,
 * and no way into the child session. The pending permission gate is the only
 * control and is never folded away.
 */
import { useLayoutEffect, useMemo, useRef, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { useDesktopLocale } from '../i18n/desktop-locale-context';
import {
  useSubagentInspectorPanel,
  useSubagentInspectorToggle,
} from './subagent-inspector-context';
import { deriveSubagentPreview, type SubagentPreviewLine } from './subagent-preview-model';
import { SubagentElapsed } from './subagent-card-parts';
import { firstTextLine } from '@piwin/host-client';

const SCROLL_FOLLOW_THRESHOLD_PX = 40;

function PreviewLine(props: { line: SubagentPreviewLine; zh: boolean }): ReactElement {
  const { line, zh } = props;
  if (line.kind === 'tool') {
    return (
      <div className="subagent-preview-line" data-kind="tool" data-status={line.status}>
        <span className="subagent-preview-time">{line.offset}</span>
        <span className="subagent-preview-verb">{line.verb}</span>
        <span className="subagent-preview-text" title={line.target}>
          {line.target}
        </span>
        <span className="subagent-preview-result">{line.result}</span>
      </div>
    );
  }
  const verb = line.kind === 'say' ? (zh ? '说' : 'say') : zh ? '想' : 'think';
  return (
    <div className="subagent-preview-line" data-kind={line.kind}>
      <span className="subagent-preview-time">{line.offset}</span>
      <span className="subagent-preview-verb">{verb}</span>
      <span className="subagent-preview-text" title={line.text}>
        {line.text}
      </span>
      <span className="subagent-preview-result" />
    </div>
  );
}

export function SubagentPreview(): ReactElement | null {
  const { locale } = useDesktopLocale();
  const zh = locale === 'zh-CN';
  const toggle = useSubagentInspectorToggle();
  const panel = useSubagentInspectorPanel();
  const selection = toggle?.selection ?? null;

  const view = useMemo(
    () =>
      panel === null
        ? null
        : deriveSubagentPreview({
            status: panel.status,
            messages: panel.messages,
            liveTail: panel.liveTail,
            invocation: panel.invocation,
            child: panel.child,
            taskSummary: selection?.taskSummary,
            modelOptions: panel.modelOptions,
            showThinking: panel.showThinking === true,
            locale,
          }),
    [panel, selection?.taskSummary, locale],
  );

  // Follow the newest step while the reader sits at the bottom; scrolling up
  // stops following until they return.
  const logRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(true);
  const lastKey = view?.lines[view.lines.length - 1]?.key;
  useLayoutEffect(() => {
    const element = logRef.current;
    if (element !== null && followRef.current) element.scrollTop = element.scrollHeight;
  }, [lastKey, view?.lines.length]);

  if (selection === null || panel === null || view === null) return null;

  const prompt = panel.liveTail?.permissionPrompt ?? null;
  const onPermission = panel.onPermission;
  const emptyText = panel.loading
    ? zh
      ? '加载中…'
      : 'Loading…'
    : view.live
      ? zh
        ? '还没有步骤'
        : 'No steps yet'
      : null;

  return (
    <section
      className="subagent-preview"
      data-testid="subagent-preview"
      data-status={panel.status}
      data-child-session-id={selection.childSessionId}
      aria-label={zh ? '子代理预览' : 'Subagent preview'}
    >
      <div className="subagent-preview-meta" data-testid="subagent-preview-meta">
        {view.meta.map((item) => (
          <span key={item}>{item}</span>
        ))}
        <SubagentElapsed
          startedAt={view.startedAt}
          endedAt={view.endedAt}
          active={view.live}
          testId="subagent-preview-elapsed"
        />
        <span className="subagent-preview-status" data-live={view.live}>
          {view.statusLabel}
        </span>
      </div>
      {view.task ? (
        <p className="subagent-preview-task" data-testid="subagent-preview-task">
          <span className="subagent-preview-key">{zh ? '任务' : 'Task'}</span>
          {view.task}
        </p>
      ) : null}
      <div
        className="subagent-preview-log"
        data-testid="subagent-preview-log"
        ref={logRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          followRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            SCROLL_FOLLOW_THRESHOLD_PX;
        }}
      >
        {view.elidedCount > 0 ? (
          <div className="subagent-preview-note">
            {zh ? `… 前 ${view.elidedCount} 步已省略` : `… ${view.elidedCount} earlier steps`}
          </div>
        ) : null}
        {view.lines.map((line) => (
          <PreviewLine key={line.key} line={line} zh={zh} />
        ))}
        {view.lines.length === 0 && emptyText !== null ? (
          <div className="subagent-preview-note">{emptyText}</div>
        ) : null}
        {panel.error !== null ? (
          <div className="subagent-preview-note is-error" data-testid="subagent-preview-error">
            {panel.error}{' '}
            <button type="button" className="subagent-preview-retry" onClick={panel.onRetry}>
              {zh ? '重试' : 'Retry'}
            </button>
          </div>
        ) : null}
      </div>
      {prompt !== null && onPermission !== undefined ? (
        <div className="subagent-preview-permission" data-testid="subagent-preview-permission">
          <span className="subagent-preview-key">{zh ? '需要权限' : 'Permission'}</span>
          <span className="subagent-preview-text" title={prompt.detail}>
            {[prompt.action, firstTextLine(prompt.detail)].filter(Boolean).join('  ')}
          </span>
          <Button size="compact" variant="primary" onClick={() => onPermission(prompt, 'allow')}>
            {zh ? '允许' : 'Allow'}
          </Button>
          <Button size="compact" onClick={() => onPermission(prompt, 'allow', 'session')}>
            {zh ? '本会话总是允许' : 'Always this session'}
          </Button>
          <Button size="compact" variant="ghost" onClick={() => onPermission(prompt, 'deny')}>
            {zh ? '拒绝' : 'Deny'}
          </Button>
        </div>
      ) : null}
      {view.outcome !== undefined ? (
        <div
          className="subagent-preview-outcome"
          data-testid="subagent-preview-outcome"
          data-tone={view.outcome.tone}
        >
          <span className="subagent-preview-key">{view.outcome.label}</span>
          {view.outcome.text}
        </div>
      ) : null}
    </section>
  );
}
