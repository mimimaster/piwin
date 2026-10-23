/**
 * Layout probe badge: the artifact squeezed some text into a column one glyph
 * wide. The host cannot repair that without guessing at the author's layout,
 * so it says what happened and offers to draft a fix request in the composer.
 * Never an automatic rewrite, never an automatic send.
 */
import type { ReactElement } from 'react';

type Locale = 'zh-CN' | 'en';

export function artifactLayoutBadgeCopy(locale: Locale): { label: string; action: string } {
  return locale === 'zh-CN'
    ? { label: '部分文字被挤成了窄列', action: '让模型修复' }
    : { label: 'Some text is squeezed into a narrow column', action: 'Ask for a fix' };
}

/** Composer draft that names the usual cause, so the fix lands in one turn. */
export function artifactLayoutFixProposal(locale: Locale): { text: string; label: string } {
  return locale === 'zh-CN'
    ? {
        label: '修复 Artifact 布局',
        text: '上一个 Artifact 里有文字被挤成了一个字符宽的窄列。通常是因为把一句话直接写在 flex 或 grid 行里，行内的每段文字和 `code` 各占了一格。请把整句（连同其中的 `code`、`b`、`a`）包进同一个子元素，然后重新输出这个 Artifact。',
      }
    : {
        label: 'Fix artifact layout',
        text: 'Some text in the last artifact is squeezed into a column one character wide. The usual cause is a sentence written straight into a flex or grid row, where each text run and each inline `code` becomes its own cell. Wrap the whole sentence (with its `code`, `b` and `a`) in one child element and output the artifact again.',
      };
}

export function ArtifactLayoutBadge(props: {
  /** Affected elements; the badge shows only when positive. */
  shatteredText: number;
  locale: Locale;
  onComposerProposal?: ((payload: { text: string; label?: string }) => void) | undefined;
}): ReactElement | null {
  if (props.shatteredText <= 0) return null;
  const copy = artifactLayoutBadgeCopy(props.locale);
  const propose = props.onComposerProposal;
  return (
    <p
      className="artifact-style-badge"
      data-testid="artifact-layout-badge"
      data-shattered-text={String(props.shatteredText)}
      role="status"
    >
      <span>{copy.label}</span>
      {propose ? (
        <button
          type="button"
          onClick={() => propose(artifactLayoutFixProposal(props.locale))}
          data-testid="artifact-layout-fix"
        >
          {copy.action}
        </button>
      ) : null}
    </p>
  );
}
