import { type ComponentProps, type JSX, type ReactElement } from 'react';
import { type Components, type ExtraProps } from 'streamdown';
import { mergeMarkdownClassNames } from './markdown-streamdown-nodes.js';

type MarkdownInlineElementProps<Tag extends keyof JSX.IntrinsicElements> = ComponentProps<Tag> &
  ExtraProps;

function renderStrong({
  children,
  node: _node,
  className,
  ...props
}: MarkdownInlineElementProps<'strong'>): ReactElement {
  return (
    <strong {...props} className={mergeMarkdownClassNames('md-strong', className)}>
      {children}
    </strong>
  );
}

function renderEmphasis({
  children,
  node: _node,
  className,
  ...props
}: MarkdownInlineElementProps<'em'>): ReactElement {
  return (
    <em {...props} className={mergeMarkdownClassNames('md-em', className)}>
      {children}
    </em>
  );
}

function renderStrikethrough({
  children,
  node: _node,
  className,
  ...props
}: MarkdownInlineElementProps<'s'>): ReactElement {
  return (
    <s {...props} className={mergeMarkdownClassNames('md-del', className)}>
      {children}
    </s>
  );
}

function renderMark({
  children,
  node: _node,
  className,
  ...props
}: MarkdownInlineElementProps<'mark'>): ReactElement {
  return (
    <mark {...props} className={mergeMarkdownClassNames('md-mark', className)}>
      {children}
    </mark>
  );
}

function renderKeyboardInput({
  children,
  node: _node,
  className,
  ...props
}: MarkdownInlineElementProps<'kbd'>): ReactElement {
  return (
    <kbd {...props} className={mergeMarkdownClassNames('md-kbd', className)}>
      {children}
    </kbd>
  );
}

function renderSuperscript({
  children,
  node: _node,
  className,
  ...props
}: MarkdownInlineElementProps<'sup'>): ReactElement {
  return (
    <sup {...props} className={mergeMarkdownClassNames('md-sup', className)}>
      {children}
    </sup>
  );
}

function renderSubscript({
  children,
  node: _node,
  className,
  ...props
}: MarkdownInlineElementProps<'sub'>): ReactElement {
  return (
    <sub {...props} className={mergeMarkdownClassNames('md-sub', className)}>
      {children}
    </sub>
  );
}

/** Restore semantic inline elements so Markdown does not depend on Tailwind. */
export function createMarkdownInlineRenderers(): Components {
  return {
    strong: renderStrong,
    em: renderEmphasis,
    s: renderStrikethrough,
    mark: renderMark,
    kbd: renderKeyboardInput,
    sup: renderSuperscript,
    sub: renderSubscript,
  };
}
