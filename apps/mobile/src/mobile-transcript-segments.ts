import { indexArtifactFences } from '@piwin/artifact';
import {
  evaluateMobileArtifactFence,
  type MobileArtifactPreview,
} from './mobile-artifact-preview.js';

export type MobileTranscriptSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'artifact'; preview: MobileArtifactPreview }
  | { kind: 'artifact-pending'; title: string };

/**
 * Split assistant text so Artifact fences never reach Streamdown.
 * HTML source in the transcript is what made iOS look like the page
 * "became" the chat — and it raced the session scroller.
 */
export function partitionMobileTranscript(
  text: string,
  isStreaming: boolean,
): MobileTranscriptSegment[] {
  const segments: MobileTranscriptSegment[] = [];
  const markdownParts: string[] = [];

  const flushMarkdown = () => {
    const joined = markdownParts.join('').trim();
    if (joined.length > 0) {
      segments.push({ kind: 'markdown', text: joined });
    }
    markdownParts.length = 0;
  };

  let copiedTo = 0;
  for (const fence of indexArtifactFences(text)) {
    const removalStart = getFenceRemovalStart(text, fence.startOffset);
    const fenceEnd = fence.endOffset ?? text.length;
    markdownParts.push(text.slice(copiedTo, removalStart));

    const decision = evaluateMobileArtifactFence(fence, isStreaming);
    if (decision.kind === 'code') {
      markdownParts.push(text.slice(removalStart, fenceEnd));
      copiedTo = fenceEnd;
      continue;
    }

    flushMarkdown();
    if (decision.kind === 'preparing') {
      segments.push({ kind: 'artifact-pending', title: decision.title });
      copiedTo = fenceEnd;
      continue;
    }
    segments.push({ kind: 'artifact', preview: decision.preview });
    copiedTo = fenceEnd;
  }

  markdownParts.push(text.slice(copiedTo));
  flushMarkdown();
  return segments;
}

function getFenceRemovalStart(text: string, fenceStart: number): number {
  const lineStart = text.lastIndexOf('\n', fenceStart - 1) + 1;
  const linePrefix = text.slice(lineStart, fenceStart);
  if (/^(?: {0,3}> ?)*(?:(?: {0,3})(?:[-+*]|\d+[.)]) )? *$/.test(linePrefix)) {
    return lineStart;
  }
  return fenceStart;
}
