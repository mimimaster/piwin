import type { ReactElement } from 'react';
import { CollapsibleContentBlock } from '../conversation/collapsible-content-block';
import { useLazyToolOutput } from './tool-output-reader.js';

const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export type LazyToolOutputPreProps = {
  toolCallId: string;
  maxChars: number;
  locale: 'zh-CN' | 'en';
};

/**
 * Lazy-load persisted shell output for non-ShellToolBody cards (e.g. curl
 * fetch-style bash or legacy shell cards without a command string).
 */
export function LazyToolOutputPre(props: LazyToolOutputPreProps): ReactElement | null {
  const lazy = useLazyToolOutput(props.toolCallId, true);
  if (lazy.status === 'loading') {
    return (
      <pre className="tool-call-output is-loading" data-testid="tool-call-output-loading">
        {props.locale === 'zh-CN' ? '读取输出…' : 'Loading output…'}
      </pre>
    );
  }
  if (lazy.status !== 'ready') {
    return null;
  }
  const text = lazy.output.replace(ANSI_PATTERN, '');
  if (!text.trim()) {
    return null;
  }
  return (
    <CollapsibleContentBlock maxCollapsedHeight={130} defaultCollapsed>
      <pre className="tool-call-output">{text.slice(0, props.maxChars)}</pre>
    </CollapsibleContentBlock>
  );
}
