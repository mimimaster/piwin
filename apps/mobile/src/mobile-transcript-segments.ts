import { splitMarkdownBlocks, type ParsedMarkdownBlock } from '@piwin/artifact';
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
    const joined = markdownParts.join('\n\n').trim();
    if (joined.length > 0) {
      segments.push({ kind: 'markdown', text: joined });
    }
    markdownParts.length = 0;
  };

  for (const block of splitMarkdownBlocks(text)) {
    if (block.type !== 'code') {
      markdownParts.push(serializeMarkdownBlock(block));
      continue;
    }

    const decision = evaluateMobileArtifactFence(block.language, block.source);
    if (decision.kind === 'code') {
      markdownParts.push(serializeMarkdownBlock(block));
      continue;
    }

    flushMarkdown();
    if (isStreaming || decision.kind === 'preparing') {
      segments.push({ kind: 'artifact-pending', title: decision.descriptor.title });
      continue;
    }
    segments.push({
      kind: 'artifact',
      preview: {
        id: decision.descriptor.id,
        title: decision.descriptor.title,
        language: decision.descriptor.alias || block.language,
        decision,
      },
    });
  }

  flushMarkdown();
  return segments;
}

function serializeMarkdownBlock(block: ParsedMarkdownBlock): string {
  switch (block.type) {
    case 'paragraph':
      return block.value;
    case 'heading':
      return `${'#'.repeat(block.level)} ${block.text}`;
    case 'blockquote':
      return block.text
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    case 'list':
      return block.items
        .map((item, index) => (block.ordered ? `${index + 1}. ${item}` : `- ${item}`))
        .join('\n');
    case 'table': {
      const header = `| ${block.headers.join(' | ')} |`;
      const divider = `| ${block.alignments
        .map((alignment) => {
          if (alignment === 'center') {
            return ':---:';
          }
          if (alignment === 'right') {
            return '---:';
          }
          return '---';
        })
        .join(' | ')} |`;
      const rows = block.rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
      return `${header}\n${divider}\n${rows}`;
    }
    case 'code':
      return `\`\`\`${block.language}\n${block.source}\n\`\`\``;
  }
}
