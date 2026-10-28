/**
 * DOM-side state of the capture editor: the stage's measured size and the
 * lazily built mosaic preview. Kept apart from the gesture/drawing logic.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createMosaicPreview } from './annotation-export.js';
import type { ImageSize } from './annotation-model.js';

export type StageMeasurement = {
  stageRef: RefObject<HTMLDivElement | null>;
  /** Callback ref: a modal host may attach the stage after the first layout pass. */
  attachStage: (element: HTMLDivElement | null) => void;
  stageSize: ImageSize;
};

export function useStageMeasurement(): StageMeasurement {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageElement, setStageElement] = useState<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState<ImageSize>({ width: 0, height: 0 });
  const attachStage = useCallback((element: HTMLDivElement | null): void => {
    stageRef.current = element;
    setStageElement(element);
  }, []);

  useLayoutEffect(() => {
    const stage = stageElement;
    if (stage === null) {
      return undefined;
    }
    const measure = (): void => {
      setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stageElement]);

  return { stageRef, attachStage, stageSize };
}

/**
 * Object URL of the pixelated screenshot, built the first time `wanted` is
 * true (the mosaic tool is picked) at about screen resolution.
 */
export function useMosaicPreview(args: {
  wanted: boolean;
  imageRef: RefObject<HTMLImageElement | null>;
  image: ImageSize;
  blockSize: number;
  viewScale: number;
}): string | null {
  const { wanted, imageRef, image, blockSize, viewScale } = args;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const element = imageRef.current;
    if (!wanted || url !== null || element === null) {
      return;
    }
    try {
      const pixelsPerBlock = blockSize * viewScale * window.devicePixelRatio;
      createMosaicPreview(element, image, blockSize, pixelsPerBlock).toBlob((blob) => {
        if (blob !== null) setUrl(URL.createObjectURL(blob));
      });
    } catch (error) {
      console.error('[piwin] screenshot mosaic preview unavailable', error);
    }
  }, [blockSize, image, imageRef, url, viewScale, wanted]);

  useEffect(() => {
    if (url === null) return undefined;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  return url;
}
