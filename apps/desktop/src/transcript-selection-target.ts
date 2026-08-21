/**
 * Live window selection → context-menu `selection` target for a chat bubble.
 * Transcript prose has no file path; keep `kind: 'selection'` (do not upgrade to file).
 */
import type { ContextMenuTarget } from './context-menu/types.js';

export const TRANSCRIPT_SELECTION_MAX_CHARS = 8000;
export const TRANSCRIPT_SELECTION_LABEL_MAX_CHARS = 48;

/** Nested CM hosts that keep their own menu; bubble layer must not steal them. */
export const TRANSCRIPT_SELECTION_NESTED_HOST_SELECTOR = [
  '.md-code-block',
  '[data-testid="code-fence-source"]',
  '[data-testid="code-fence-streaming"]',
  '[data-testid="tool-call-card"]',
].join(', ');

const SKIPPED_SELECTION_TAGS = new Set(['STYLE', 'SCRIPT', 'NOSCRIPT', 'TEMPLATE']);

export function formatTranscriptSelectionLabel(text: string): string {
  const firstLine = text.trim().split(/\r?\n/, 1)[0] ?? '';
  const collapsed = firstLine.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0 || looksLikeCssDump(collapsed)) {
    return 'selection';
  }
  if (collapsed.length <= TRANSCRIPT_SELECTION_LABEL_MAX_CHARS) {
    return collapsed;
  }
  return `${collapsed.slice(0, TRANSCRIPT_SELECTION_LABEL_MAX_CHARS - 1)}…`;
}

export function isTranscriptNestedHostTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(TRANSCRIPT_SELECTION_NESTED_HOST_SELECTOR) !== null
  );
}

function elementFromNode(node: Node): Element | null {
  if (node instanceof Element) {
    return node;
  }
  if (node instanceof ShadowRoot) {
    return node.host;
  }
  return node.parentElement;
}

function isSkippedSelectionNode(node: Node): boolean {
  return node instanceof Element && SKIPPED_SELECTION_TAGS.has(node.tagName);
}

function ancestorIsSkipped(node: Node): boolean {
  let current: Node | null = node;
  while (current) {
    if (isSkippedSelectionNode(current)) {
      return true;
    }
    if (current instanceof ShadowRoot) {
      current = current.host;
      continue;
    }
    current = current.parentNode;
  }
  return false;
}

/** Walk light DOM + open shadow roots; Artifact static preview lives in Shadow DOM. */
export function isNodeInsideHost(host: Node, node: Node): boolean {
  let current: Node | null = node;
  while (current) {
    if (current === host) {
      return true;
    }
    if (current instanceof ShadowRoot) {
      current = current.host;
      continue;
    }
    current = current.parentNode;
  }
  return false;
}

function sliceTextNode(node: Node, range: Range): string {
  const text = node.textContent ?? '';
  if (node === range.startContainer && node === range.endContainer) {
    return text.slice(range.startOffset, range.endOffset);
  }
  if (node === range.startContainer) {
    return text.slice(range.startOffset);
  }
  if (node === range.endContainer) {
    return text.slice(0, range.endOffset);
  }
  return text;
}

function rangeIntersects(range: Range, node: Node): boolean {
  try {
    return range.intersectsNode(node);
  } catch {
    return false;
  }
}

function walkVisibleText(node: Node, range: Range, out: string[]): void {
  if (isSkippedSelectionNode(node) || ancestorIsSkipped(node)) {
    return;
  }
  if (node.nodeType === Node.TEXT_NODE) {
    if (rangeIntersects(range, node)) {
      out.push(sliceTextNode(node, range));
    }
    return;
  }
  if (node instanceof Element && node.shadowRoot) {
    for (const child of node.shadowRoot.childNodes) {
      walkVisibleText(child, range, out);
    }
  }
  for (const child of node.childNodes) {
    walkVisibleText(child, range, out);
  }
}

/** Light-DOM range around a shadow host cannot slice shadow text nodes. */
function collectShadowVisibleText(node: Node, out: string[]): void {
  if (isSkippedSelectionNode(node)) {
    return;
  }
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(node.textContent ?? '');
    return;
  }
  if (node instanceof Element && node.shadowRoot) {
    for (const child of node.shadowRoot.childNodes) {
      collectShadowVisibleText(child, out);
    }
  }
  for (const child of node.childNodes) {
    collectShadowVisibleText(child, out);
  }
}

/**
 * Serialized HTML leaked into a selection (innerHTML / fence source). Visible
 * Artifact markup must not become the capsule snapshot.
 */
export function looksLikeCssDump(text: string): boolean {
  return /[{};]/.test(text) && /:host\b|font-size\s*:|display\s*:/.test(text);
}

export function looksLikeSerializedHtml(text: string): boolean {
  return /<[a-zA-Z][^>]*>/.test(text) && /<\/[a-zA-Z]+>|\sstyle\s*=|<style[\s>]/i.test(text);
}

export function stripSerializedHtml(text: string): string {
  if (!looksLikeSerializedHtml(text)) {
    return text;
  }
  const template = document.createElement('template');
  template.innerHTML = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  return template.content.textContent ?? '';
}

/**
 * Plain visible text for a live selection. Skips `<style>` / `<script>` (Artifact
 * static preview stores theme CSS in Shadow DOM) and strips serialized HTML.
 */
export function visibleTextFromSelection(selection: Selection): string {
  if (selection.rangeCount === 0) {
    return '';
  }
  const parts: string[] = [];
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    const walked: string[] = [];
    walkVisibleText(range.commonAncestorContainer, range, walked);
    if (walked.join('').trim().length === 0) {
      const host = elementFromNode(range.commonAncestorContainer);
      const candidates = host
        ? [host, ...host.querySelectorAll('*')].filter((element) => element.shadowRoot)
        : [];
      for (const shadowHost of candidates) {
        if (shadowHost.shadowRoot && rangeIntersects(range, shadowHost)) {
          for (const child of shadowHost.shadowRoot.childNodes) {
            collectShadowVisibleText(child, walked);
          }
        }
      }
    }
    const walkedText = walked.join('');
    parts.push(walkedText.length > 0 ? walkedText : range.toString());
  }
  return stripSerializedHtml(parts.join(''));
}

function isNestedSurfaceSelection(bubbleRoot: Element, range: Range): boolean {
  const host = elementFromNode(range.commonAncestorContainer);
  if (!host || !isNodeInsideHost(bubbleRoot, host)) {
    return false;
  }
  const nested = host.closest(TRANSCRIPT_SELECTION_NESTED_HOST_SELECTOR);
  return nested !== null && isNodeInsideHost(bubbleRoot, nested);
}

export function computeTranscriptSelectionTarget(
  bubbleRoot: Element,
  selection: Selection | null = typeof window === 'undefined' ? null : window.getSelection(),
): ContextMenuTarget | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!isNodeInsideHost(bubbleRoot, range.commonAncestorContainer)) {
    return null;
  }
  if (isNestedSurfaceSelection(bubbleRoot, range)) {
    return null;
  }
  const selectedText = visibleTextFromSelection(selection).slice(
    0,
    TRANSCRIPT_SELECTION_MAX_CHARS,
  );
  if (!selectedText.trim()) {
    return null;
  }
  return {
    surface: 'selection',
    selectedText,
    label: formatTranscriptSelectionLabel(selectedText),
  };
}

export function resolveBubbleContextMenuTarget(
  bubbleRoot: Element,
  messageTarget: ContextMenuTarget,
  selection: Selection | null = typeof window === 'undefined' ? null : window.getSelection(),
): ContextMenuTarget {
  return computeTranscriptSelectionTarget(bubbleRoot, selection) ?? messageTarget;
}

/**
 * Code fences wrap Artifact preview. A live visible selection wins; otherwise
 * the fence source stays the code-block target (Show code / no selection).
 */
export function resolveCodeFenceContextMenuTarget(
  host: Element,
  source: string,
  language: string,
  selection: Selection | null = typeof window === 'undefined' ? null : window.getSelection(),
): ContextMenuTarget {
  return (
    computeTranscriptSelectionTarget(host, selection) ?? {
      surface: 'code-block',
      selectedText: source,
      label: language || 'code',
    }
  );
}
