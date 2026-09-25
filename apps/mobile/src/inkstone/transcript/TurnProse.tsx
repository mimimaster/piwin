import { useMemo, type ReactElement } from 'react';
import { MobileMarkdown } from '../../components/chat/MobileMarkdown.js';
import { MobileArtifactPending, MobileArtifactStage } from '../../components/chat/MobileArtifactStage.js';
import { partitionMobileTranscript } from '../../mobile-transcript-segments.js';

/**
 * The turn's answer. Artifact fences never reach Markdown: they become a
 * sandboxed stage (or a "preparing" card while the fence is still streaming).
 */
export function TurnProse({ text, streaming }: { text: string; streaming: boolean }): ReactElement {
  const segments = useMemo(() => partitionMobileTranscript(text, streaming), [text, streaming]);
  if (segments.length === 0) {
    return (
      <div className="modern-streaming-placeholder">
        <span className="modern-streaming-cursor" />
      </div>
    );
  }
  const lastMarkdown = segments.reduce((found, segment, index) => (segment.kind === 'markdown' ? index : found), -1);
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === 'markdown') {
          return (
            <MobileMarkdown key={index} content={segment.text} isStreaming={streaming && index === lastMarkdown} />
          );
        }
        if (segment.kind === 'artifact-pending') {
          return <MobileArtifactPending key={index} title={segment.title} />;
        }
        return <MobileArtifactStage key={segment.preview.id} preview={segment.preview} />;
      })}
    </>
  );
}
