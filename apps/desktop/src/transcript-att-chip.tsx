/**
 * Sent-message attachment capsules from proto-01 `.atts` / `.att`.
 * Composer pending chips stay on `.ref` (slab); history on the paper card
 * uses this row: file icon, image thumb, or `@` mention.
 */
import type { ReactElement } from 'react';
import type { MediaAttachmentRef, PromptContextRef } from '@piwin/contracts';
import { IconFile } from './shell-icons';

export type TranscriptAttVariant = 'file' | 'image' | 'mention';

export type TranscriptAttModel = {
  variant: TranscriptAttVariant;
  text: string;
};

function fileName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

export function transcriptAttFromContextRef(ref: PromptContextRef): TranscriptAttModel {
  if (ref.kind === 'file' || ref.kind === 'folder') {
    const name = fileName(ref.relativePath) || ref.label;
    return { variant: 'file', text: name };
  }
  const raw =
    'label' in ref && typeof ref.label === 'string' && ref.label.length > 0
      ? ref.label
      : ref.kind === 'selection' && ref.relativePath
        ? fileName(ref.relativePath)
        : ref.kind;
  const text = raw.startsWith('@') ? raw : `@ ${raw}`;
  return { variant: 'mention', text };
}

export function transcriptAttFromMedia(attachment: MediaAttachmentRef): TranscriptAttModel {
  return {
    variant: 'image',
    text: attachment.name || fileName(attachment.path) || 'image',
  };
}

export function TranscriptAttChip(props: TranscriptAttModel & { title?: string }): ReactElement {
  return (
    <span
      className={`att att-${props.variant}`}
      data-testid="transcript-att-chip"
      data-att-variant={props.variant}
      {...(props.title ? { title: props.title } : {})}
    >
      {props.variant === 'file' ? (
        <span className="att-ic" aria-hidden>
          <IconFile width={12} height={12} />
        </span>
      ) : null}
      {props.variant === 'image' ? <span className="th" aria-hidden /> : null}
      <span className="att-text">{props.text}</span>
    </span>
  );
}
