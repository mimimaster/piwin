import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { fileNameFromPath, PathChip } from './path-chip.js';
import {
  isLocalPathChipCandidate,
  MARKDOWN_LOCAL_PATH_TEXT_PATTERN,
} from './markdown-local-links.js';

export type MarkdownDocumentReference = {
  title: string;
  path?: string;
  content?: string;
};

export function mergeMarkdownClassNames(base: string, className?: string): string {
  return className ? `${base} ${className}` : base;
}

export function plainTextFromReactNode(value: ReactNode): string {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(plainTextFromReactNode).join('');
  if (isValidElement(value)) {
    const element = value as ReactElement<{ children?: ReactNode }>;
    return plainTextFromReactNode(element.props.children);
  }
  return '';
}

export function renderMarkdownText(
  text: string,
  onOpenDocument: ((doc: MarkdownDocumentReference) => void) | undefined,
  keyPrefix = 'text',
  projectPath?: string | null,
): ReactNode {
  if (!onOpenDocument) return text;

  const parts: Array<string | ReactElement> = [];
  let lastIndex = 0;
  let partIndex = 0;
  MARKDOWN_LOCAL_PATH_TEXT_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(MARKDOWN_LOCAL_PATH_TEXT_PATTERN)) {
    const fullPath = match[0];
    if (!isLocalPathChipCandidate(fullPath)) {
      continue;
    }
    const matchIndex = match.index ?? 0;
    if (matchIndex < lastIndex) {
      continue;
    }
    if (matchIndex > lastIndex) {
      parts.push(text.slice(lastIndex, matchIndex));
    }
    parts.push(
      <PathChip
        key={`${keyPrefix}-path-${partIndex++}`}
        fullPath={fullPath}
        {...(projectPath ? { projectPath } : {})}
        onOpen={() => onOpenDocument({ title: fileNameFromPath(fullPath), path: fullPath })}
      />,
    );
    lastIndex = matchIndex + fullPath.length;
  }

  if (parts.length === 0) return text;
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

const REACT_PORTAL_TYPE = Symbol.for('react.portal');

/**
 * Only a leaked parser node (a bare MDAST `{ type, value }` object) can never
 * render. Portals and React 19 thenables are objects too, so they are matched
 * out before the prototype check.
 */
function isLeakedParserNode(value: object): boolean {
  if ((value as { $$typeof?: unknown }).$$typeof === REACT_PORTAL_TYPE) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

/**
 * Drop one leaked node so a single bad child cannot take down the whole reply
 * mid-stream. Everything React can render passes through untouched.
 */
export function sanitizeMarkdownChild(value: ReactNode): ReactNode {
  if (value === null || value === undefined || typeof value === 'boolean') return value;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map(sanitizeMarkdownChild);
  if (isValidElement(value)) return value;
  if (typeof value === 'object' && isLeakedParserNode(value)) return null;
  return value;
}

export function renderMarkdownChildren(
  children: ReactNode,
  onOpenDocument: ((doc: MarkdownDocumentReference) => void) | undefined,
  projectPath?: string | null,
): ReactNode {
  if (typeof children === 'string')
    return renderMarkdownText(children, onOpenDocument, 'text', projectPath);
  if (Array.isArray(children)) {
    return children.map((child, index) =>
      typeof child === 'string'
        ? renderMarkdownText(child, onOpenDocument, `text-${index}`, projectPath)
        : sanitizeMarkdownChild(child),
    );
  }
  return sanitizeMarkdownChild(children);
}

export function stripLeadingCalloutMarker(value: ReactNode): ReactNode {
  let removed = false;
  const markerPattern = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

  const strip = (current: ReactNode): ReactNode => {
    if (removed) return current;
    if (typeof current === 'string') {
      const next = current.replace(markerPattern, '');
      if (next !== current) removed = true;
      return next;
    }
    if (Array.isArray(current)) return current.map(strip);
    if (isValidElement(current)) {
      const element = current as ReactElement<{ children?: ReactNode }>;
      return cloneElement(element, { children: strip(element.props.children) });
    }
    return current;
  };

  return strip(value);
}
