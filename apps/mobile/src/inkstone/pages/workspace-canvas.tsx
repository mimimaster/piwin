import { useMemo, type ReactElement } from 'react';
import type { MobileTranscriptMessage } from '../../mobile-transcript.js';
import type { MobileArtifactPreview } from '../../mobile-artifact-preview.js';
import { partitionMobileTranscript } from '../../mobile-transcript-segments.js';
import { MobileArtifactStage } from '../../components/chat/MobileArtifactStage.js';
import { ScreenHeading } from '../inkstone-ui.js';

/**
 * Workspace › 画布: every artifact this session produced, newest first, each in
 * the same sandboxed stage the transcript uses. Nothing is re-derived: the
 * fences come straight from the Host transcript.
 */
export function WorkspaceCanvas({ messages }: { messages: readonly MobileTranscriptMessage[] }): ReactElement {
  const previews = useMemo(() => collectArtifacts(messages), [messages]);
  return (
    <>
      <ScreenHeading title="画布" subtitle={previews.length === 0 ? '这个会话还没有网页产物' : `${previews.length} 个网页产物`} />
      {previews.length === 0 ? (
        <p className="muted">让 Agent 画一个页面、图表或动画，它会出现在这里，也可以全屏打开。</p>
      ) : null}
      {previews.map((preview) => (
        <MobileArtifactStage key={preview.id} preview={preview} />
      ))}
    </>
  );
}

export function collectArtifacts(messages: readonly MobileTranscriptMessage[]): MobileArtifactPreview[] {
  const previews: MobileArtifactPreview[] = [];
  const seen = new Set<string>();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || message.role !== 'assistant' || message.status === 'streaming') continue;
    for (const segment of partitionMobileTranscript(message.text, false)) {
      if (segment.kind === 'artifact' && !seen.has(segment.preview.id)) {
        seen.add(segment.preview.id);
        previews.push(segment.preview);
      }
    }
  }
  return previews;
}
