/**
 * Standalone preview page for the unified interruption UI.
 * Mount via a separate Vite entry to see the components in isolation.
 */
import { useState, type ReactElement } from 'react';
import { Button, Collapse, PiwinUiProvider, StatusBadge, Surface } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { IconChevronDown } from './shell-icons';

// ── Shared frame (inline copy for standalone preview) ──

type Tone = 'question' | 'warning' | 'danger';

function Frame({
  tone,
  statusLabel,
  title,
  description,
  children,
}: {
  tone: Tone;
  statusLabel: string;
  title: string;
  description?: string;
  children: ReactElement | ReactElement[];
}): ReactElement {
  const badgeTone = tone === 'question' ? 'running' : tone;
  return (
    <Surface
      tone="raised"
      className={`agent-interruption agent-interruption--${tone}`}
    >
      <header className="agent-interruption-header">
        <StatusBadge tone={badgeTone as 'running' | 'warning' | 'danger'} label={statusLabel} />
        <h2 className="agent-interruption-title">{title}</h2>
        {description ? (
          <p className="agent-interruption-description">{description}</p>
        ) : null}
      </header>
      <div className="agent-interruption-content">{children}</div>
    </Surface>
  );
}

// ── Mock data ──

export function PreviewInterruption(): ReactElement {
  const [expanded1, setExpanded1] = useState(false);
  const [expanded2, setExpanded2] = useState(true);

  return (
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <div style={{ maxWidth: '740px', margin: '40px auto', padding: '0 20px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <h1 style={{ fontSize: '18px', color: 'var(--text)', marginBottom: '8px' }}>
          统一中断 UI 预览 — Agent Interruption Dock
        </h1>

        {/* 1. Select question */}
        <Frame
          tone="question"
          statusLabel="Agent 正等待你的回答"
          title="Which branch should I create the PR from?"
          description="Pick an option below, or cancel to skip."
        >
          <div className="agent-interruption-choices" role="group">
            {['main', 'develop', 'feature/auth-refactor'].map((opt) => (
              <button key={opt} type="button" className="agent-interruption-choice">
                <span>{opt}</span>
              </button>
            ))}
          </div>
          <div className="agent-interruption-footer">
            <Button variant="ghost" size="compact">取消问题</Button>
          </div>
        </Frame>

        {/* 2. Confirm question */}
        <Frame
          tone="question"
          statusLabel="Agent 正等待你的回答"
          title="Proceed with deleting 3 unused files?"
        >
          <div className="agent-interruption-actions">
            <Button variant="secondary">取消</Button>
            <Button variant="primary">继续</Button>
          </div>
          <div className="agent-interruption-footer">
            <Button variant="ghost" size="compact">取消问题</Button>
          </div>
        </Frame>

        {/* 3. Input question */}
        <Frame
          tone="question"
          statusLabel="Agent 正等待你的回答"
          title="Describe the bug you're seeing"
          description="在下方输入框中回答"
        >
          <div style={{ padding: '8px 0', color: 'var(--muted)', fontSize: '12.5px' }}>
            ↓ composer textarea below is active for input
          </div>
        </Frame>

        {/* 4. Permission (warning, non-destructive) */}
        <Frame
          tone="warning"
          statusLabel="需要你的批准"
          title="bash: npm install"
        >
          <button
            type="button"
            className="permission-bar-disclosure"
            aria-expanded={expanded1}
            onClick={() => setExpanded1((p) => !p)}
          >
            <span>{expanded1 ? '收起详情' : '展开详情'}</span>
            <IconChevronDown className={`permission-bar-chevron${expanded1 ? ' is-expanded' : ''}`} />
          </button>
          <Collapse expanded={expanded1}>
            <div className="permission-bar-detail-inner">
              <dl className="permission-facts">
                <dt>Command</dt>
                <dd><pre className="permission-detail">npm install express dotenv</pre></dd>
              </dl>
            </div>
          </Collapse>
          <div className="permission-bar-actions">
            <Button variant="primary" size="compact" className="permission-bar-btn-allow-session">允许本次会话</Button>
            <Button variant="secondary" size="compact">仅允许这一次</Button>
            <Button variant="secondary" size="compact">允许此项目</Button>
            <Button variant="danger" size="compact">拒绝</Button>
          </div>
        </Frame>

        {/* 5. Permission (danger, destructive, auto-expanded) */}
        <Frame
          tone="danger"
          statusLabel="需要你的批准"
          title="bash: rm -rf node_modules dist"
        >
          <button
            type="button"
            className="permission-bar-disclosure"
            aria-expanded={expanded2}
            onClick={() => setExpanded2((p) => !p)}
          >
            <span>{expanded2 ? '收起详情' : '展开详情'}</span>
            <IconChevronDown className={`permission-bar-chevron${expanded2 ? ' is-expanded' : ''}`} />
          </button>
          <Collapse expanded={expanded2}>
            <div className="permission-bar-detail-inner">
              <dl className="permission-facts">
                <dt>Command</dt>
                <dd><pre className="permission-detail">rm -rf node_modules dist</pre></dd>
                <dt>Risk</dt>
                <dd style={{ color: 'var(--danger, #ef4444)' }}>Destructive — removes directories recursively</dd>
              </dl>
            </div>
          </Collapse>
          <div className="permission-bar-actions">
            <Button variant="primary" size="compact" className="permission-bar-btn-allow-session">允许本次会话</Button>
            <Button variant="secondary" size="compact">仅允许这一次</Button>
            <Button variant="danger" size="compact">拒绝</Button>
          </div>
        </Frame>
      </div>
    </PiwinUiProvider>
  );
}
