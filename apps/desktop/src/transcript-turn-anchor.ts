import { messageAnchorId } from './transcript-outline.js';

/** Prompt position inside the transcript viewport while a new turn is live. */
export const TURN_ANCHOR_TOP_OFFSET_PX = 28;

export type TranscriptTurnAnchorControllerOptions = {
  getContainer: () => HTMLDivElement | null;
  beginProgrammaticScroll: () => void;
  updateMetrics: (element: HTMLElement) => void;
  recordGeometry: (element: HTMLElement) => void;
  onRelease: () => void;
};

/** Resolve the scrollTop that places one prompt at the stable turn offset. */
export function computeTurnAnchorScrollTop(options: {
  currentScrollTop: number;
  containerTop: number;
  targetTop: number;
  topOffset?: number;
}): number {
  return Math.max(
    0,
    options.currentScrollTop +
      options.targetTop -
      options.containerTop -
      (options.topOffset ?? TURN_ANCHOR_TOP_OFFSET_PX),
  );
}

/** Grow the temporary tail reserve only as much as the desired anchor needs. */
export function computeTurnAnchorSpacerHeight(options: {
  currentSpacerHeight: number;
  desiredScrollTop: number;
  maximumScrollTop: number;
}): number {
  const missingTailSpace = Math.max(0, options.desiredScrollTop - options.maximumScrollTop);
  if (missingTailSpace === 0) {
    return options.currentSpacerHeight;
  }
  return Math.ceil(options.currentSpacerHeight + missingTailSpace + 1);
}

/**
 * Imperative controller for the one active prompt anchor. React owns when an
 * anchor exists; this object owns DOM geometry and adjacent-frame settling.
 */
export class TranscriptTurnAnchorController {
  private messageId: string | null = null;
  private detached = false;
  private frameIds: number[] = [];

  constructor(private readonly options: TranscriptTurnAnchorControllerOptions) {}

  setMessageId(nextMessageId: string | null): boolean {
    if (nextMessageId === null) {
      this.messageId = null;
      this.detached = false;
      this.cancel();
      return false;
    }
    const changed = this.messageId !== nextMessageId;
    if (changed) {
      this.messageId = nextMessageId;
      this.detached = false;
      // React retains the spacer node between consecutive turns. Discard the
      // previous turn's measured inline height before measuring this prompt.
      this.options
        .getContainer()
        ?.querySelector<HTMLElement>('.transcript-turn-anchor-spacer')
        ?.style.removeProperty('height');
    }
    return changed;
  }

  isAttached(): boolean {
    return this.messageId !== null && !this.detached;
  }

  release(): boolean {
    if (this.messageId === null || this.detached) {
      return false;
    }
    this.detached = true;
    this.cancel();
    this.options.onRelease();
    return true;
  }

  cancel(): void {
    for (const frameId of this.frameIds) {
      window.cancelAnimationFrame(frameId);
    }
    this.frameIds = [];
  }

  anchorAcrossFrames(): void {
    if (!this.isAttached()) {
      return;
    }
    this.cancel();
    this.anchorOnce();
    const firstFrameId = window.requestAnimationFrame(() => {
      this.anchorOnce();
      const secondFrameId = window.requestAnimationFrame(() => {
        this.anchorOnce();
        const element = this.options.getContainer();
        if (element) {
          this.options.updateMetrics(element);
        }
        this.frameIds = this.frameIds.filter(
          (frameId) => frameId !== firstFrameId && frameId !== secondFrameId,
        );
      });
      this.frameIds.push(secondFrameId);
    });
    this.frameIds.push(firstFrameId);
  }

  private anchorOnce(): void {
    const element = this.options.getContainer();
    if (!element || !this.messageId || this.detached) {
      return;
    }
    const target = document.getElementById(messageAnchorId(this.messageId));
    if (!target || !element.contains(target)) {
      return;
    }
    const containerBounds = element.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    const desiredScrollTop = computeTurnAnchorScrollTop({
      currentScrollTop: element.scrollTop,
      containerTop: containerBounds.top,
      targetTop: targetBounds.top,
    });
    const maximumScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    const spacer = element.querySelector<HTMLElement>('.transcript-turn-anchor-spacer');
    if (spacer) {
      // Grow only by the measured deficit; viewport-size guesses fail once a
      // long history precedes the newly submitted prompt.
      const currentSpacerHeight = spacer.getBoundingClientRect().height;
      const nextSpacerHeight = computeTurnAnchorSpacerHeight({
        currentSpacerHeight,
        desiredScrollTop,
        maximumScrollTop,
      });
      if (nextSpacerHeight > currentSpacerHeight) {
        spacer.style.height = `${nextSpacerHeight}px`;
      }
    }
    this.options.beginProgrammaticScroll();
    element.scrollTop = desiredScrollTop;
    this.options.recordGeometry(element);
  }
}
