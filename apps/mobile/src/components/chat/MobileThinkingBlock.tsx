import { useState, type ReactElement } from 'react';
import { IconChevronDown, IconChevronRight } from '@piwin/ui-kit';

export type MobileThinkingBlockProps = {
  thinking: string;
  isStreaming?: boolean | undefined;
};

export function MobileThinkingBlock({
  thinking,
  isStreaming = false,
}: MobileThinkingBlockProps): ReactElement | null {
  const [expanded, setExpanded] = useState(isStreaming);
  const trimmed = thinking.trim();

  if (trimmed.length === 0 && !isStreaming) {
    return null;
  }

  return (
    <div className={`modern-thinking-pill-container ${expanded ? 'expanded' : ''}`}>
      <button
        type="button"
        className="modern-thinking-pill-trigger"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className="modern-thinking-spark">💭</span>
        <span className="modern-thinking-label">
          {isStreaming ? '正在深度推理…' : '思考过程'}
        </span>
        {isStreaming ? <span className="modern-pulse-dot inline" /> : null}
        <span className="modern-thinking-chevron">
          {expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        </span>
      </button>

      {expanded ? (
        <div className="modern-thinking-dropdown">
          <pre className="modern-thinking-body">{trimmed || '正在分析任务细节…'}</pre>
        </div>
      ) : null}
    </div>
  );
}
