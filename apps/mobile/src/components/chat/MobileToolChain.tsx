import { useState, type ReactElement } from 'react';
import { IconChevronDown } from '@piwin/ui-kit';
import type { FlashcardDisplayPayload } from '@piwin/contracts';
import type { MobileToolCall } from '../../hooks/use-mobile-host.js';
import { MobileToolCallCard } from './MobileToolCallCard.js';

export type MobileToolChainProps = {
  tools?: MobileToolCall[] | undefined;
  isStreaming?: boolean | undefined;
  onEnterFlashcardStudy?: ((payload: FlashcardDisplayPayload) => void) | undefined;
};

export function MobileToolChain({
  tools,
  onEnterFlashcardStudy,
}: MobileToolChainProps): ReactElement | null {
  if (!tools || tools.length === 0) {
    return null;
  }

  const [batchOpen, setBatchOpen] = useState(true);

  // If only 1 tool, render it directly without batch capsule
  if (tools.length === 1 && tools[0] !== undefined) {
    return (
      <div className="mobile-tool-chain-container single" data-testid="mobile-tool-chain">
        <MobileToolCallCard
          tool={tools[0]}
          defaultExpanded={tools[0].status === 'running'}
          {...(onEnterFlashcardStudy !== undefined ? { onEnterFlashcardStudy } : {})}
        />
      </div>
    );
  }

  const runningCount = tools.filter((t) => t.status === 'running').length;
  const errorCount = tools.filter((t) => t.status === 'error').length;
  const doneCount = tools.filter((t) => t.status === 'done').length;

  return (
    <div className="mobile-tool-chain-container batch" data-testid="mobile-tool-chain">
      {/* Batch Header Capsule */}
      <button
        type="button"
        className="mobile-tool-batch-header-btn"
        onClick={() => setBatchOpen((prev) => !prev)}
        aria-expanded={batchOpen}
        aria-label={`执行链：共 ${tools.length} 项工具操作`}
      >
        <div className="mobile-batch-left">
          <span className="mobile-batch-icon">⚙️</span>
          <span className="mobile-batch-title">工具调用链</span>
          <span className="mobile-batch-count-pill">{tools.length} 项操作</span>
        </div>

        <div className="mobile-batch-right">
          {runningCount > 0 ? (
            <span className="mobile-batch-status running">
              <span className="mobile-tool-pulse-dot" />
              <span>{runningCount} 项执行中</span>
            </span>
          ) : errorCount > 0 ? (
            <span className="mobile-batch-status error">
              <span>{errorCount} 项失败</span>
            </span>
          ) : (
            <span className="mobile-batch-status done">
              <span>{doneCount} 项已完成 ✓</span>
            </span>
          )}

          <span className={`mobile-tool-chevron ${batchOpen ? 'open' : ''}`}>
            <IconChevronDown size={14} />
          </span>
        </div>
      </button>

      {/* Expanded List of Tool Cards */}
      {batchOpen ? (
        <div className="mobile-tool-batch-list">
          {tools.map((tool) => (
            <MobileToolCallCard
              key={tool.id}
              tool={tool}
              {...(onEnterFlashcardStudy !== undefined ? { onEnterFlashcardStudy } : {})}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
