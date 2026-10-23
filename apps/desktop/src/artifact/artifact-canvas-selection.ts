/**
 * Host-side view of a Canvas text selection reported by the sandbox.
 *
 * The frame reports its selection box in its own viewport; the host maps it
 * into window coordinates through the iframe's box (and any CSS scale the
 * viewer stage applies) so trusted chrome can anchor a button beside it.
 */
import {
  ARTIFACT_BRIDGE_SELECTION_CLEAR_TYPE,
  type ArtifactSelectionMessage,
} from '@piwin/artifact';
import type { VirtualAnchorRect } from '@piwin/ui-kit';

export type ArtifactTextSelection = {
  text: string;
  anchor: VirtualAnchorRect;
  /** Ask the frame to drop its selection once the host has used it. */
  clear: () => void;
};

export function toArtifactTextSelection(
  message: ArtifactSelectionMessage,
  iframe: HTMLIFrameElement | null,
): ArtifactTextSelection | null {
  const rect = message.rect;
  if (!iframe || rect === null || message.text.trim().length === 0) return null;
  return {
    text: message.text,
    anchor: {
      // Read lazily: the pane can move or resize while the button is open.
      getBoundingClientRect: () => {
        const frame = iframe.getBoundingClientRect();
        const scaleX = iframe.clientWidth > 0 ? frame.width / iframe.clientWidth : 1;
        const scaleY = iframe.clientHeight > 0 ? frame.height / iframe.clientHeight : 1;
        return new DOMRect(
          frame.left + rect.left * scaleX,
          frame.top + rect.top * scaleY,
          Math.max(1, rect.width * scaleX),
          Math.max(1, rect.height * scaleY),
        );
      },
    },
    clear: () => {
      iframe.contentWindow?.postMessage(
        { type: ARTIFACT_BRIDGE_SELECTION_CLEAR_TYPE, channelId: message.channelId },
        '*',
      );
    },
  };
}
