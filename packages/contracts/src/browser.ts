/** Agent-controllable browser session contracts (ADR 0020 §4). */
import type { MediaAttachmentRef } from './host.js';

export type BrowserSnapshotNode = {
  role: string;
  name?: string;
  ref?: string;
  level?: number;
  checked?: boolean;
  children: BrowserSnapshotNode[];
};

export type WebElementPickResult = {
  url: string;
  selector: string;
  ref?: string;
  text: string;
  html?: string;
  boundingRect: { x: number; y: number; width: number; height: number };
  screenshotPath?: string;
};

export type WebElementAttachmentRef = {
  id: string;
  kind: 'web-element';
  url: string;
  selector: string;
  ref?: string;
  text: string;
  html?: string;
  screenshotPath?: string;
};

export type PromptAttachment = MediaAttachmentRef | WebElementAttachmentRef;

/** Model-facing byte caps for picked web-element payloads. */
export const MAX_WEB_ELEMENT_TEXT_BYTES = 2 * 1024; // ~2 KB
export const MAX_WEB_ELEMENT_HTML_BYTES = 8 * 1024; // ~8 KB

const TRUNCATION_MARKER = '…';

/** Truncate to a UTF-8 byte budget without splitting a multi-byte character. */
function truncateToBytes(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) {
    return value;
  }
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (encoder.encode(value.slice(0, mid)).byteLength <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return `${value.slice(0, low)}${TRUNCATION_MARKER}`;
}

/**
 * Renders a picked web element for a text-only model (no base64 dump).
 * The `html:` and `screenshot path:` lines are optional, present only when set.
 */
export function formatTextModelWebElementInjection(ref: WebElementAttachmentRef): string {
  const parts = [
    '[attached web element]',
    `url: ${ref.url}`,
    `selector: ${ref.selector}`,
    `text: ${truncateToBytes(ref.text, MAX_WEB_ELEMENT_TEXT_BYTES)}`,
  ];
  if (ref.html !== undefined) {
    parts.push(`html: ${truncateToBytes(ref.html, MAX_WEB_ELEMENT_HTML_BYTES)}`);
  }
  if (ref.screenshotPath !== undefined) {
    parts.push(`screenshot path: ${ref.screenshotPath}`);
  }
  return parts.join('\n');
}
