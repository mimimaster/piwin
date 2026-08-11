import { useEffect, useMemo, useState } from 'react';
import type { PetSummary } from '@piwin/contracts';
import {
  PET_CELL_HEIGHT,
  PET_CELL_WIDTH,
  PET_SPRITE_COLS,
  PET_SPRITE_ROWS,
} from '@piwin/contracts';
import { convertPetAssetPath } from './pet-asset-url.js';
import './pet-thumbnail.css';

export type PetThumbnailProps = {
  pet: Pick<PetSummary, 'id' | 'spritesheetAbsolutePath' | 'manifest'>;
  size?: number;
};

function positiveOrFallback(value: number | undefined, fallback: number): number {
  return value && value > 0 ? value : fallback;
}

/**
 * Shows the first idle frame from a pet atlas inside a compact list avatar.
 * The full PetSprite remains responsible for animation; this component only
 * clips the first cell so the settings list stays lightweight and stable.
 */
export function PetThumbnail({ pet, size = 48 }: PetThumbnailProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [imageDimensions, setImageDimensions] = useState<
    { width: number; height: number } | undefined
  >();
  const sourcePath = pet.spritesheetAbsolutePath.trim();
  const sourceUrl = useMemo(
    () => (sourcePath ? convertPetAssetPath(sourcePath) : ''),
    [sourcePath],
  );

  useEffect(() => {
    setImageFailed(false);
    setImageDimensions(undefined);
  }, [sourceUrl]);

  const cellWidth = positiveOrFallback(pet.manifest?.cellWidth, PET_CELL_WIDTH);
  const cellHeight = positiveOrFallback(pet.manifest?.cellHeight, PET_CELL_HEIGHT);
  const inferredCols = imageDimensions ? imageDimensions.width / cellWidth : PET_SPRITE_COLS;
  const inferredRows = imageDimensions ? imageDimensions.height / cellHeight : PET_SPRITE_ROWS;
  const cols = positiveOrFallback(pet.manifest?.cols, Math.round(inferredCols));
  const rows = positiveOrFallback(pet.manifest?.rows, Math.round(inferredRows));
  const inset = Math.max(2, Math.round(size * 0.06));
  const scale = Math.min((size - inset * 2) / cellWidth, (size - inset * 2) / cellHeight);
  const frameWidth = cellWidth * scale;
  const frameHeight = cellHeight * scale;

  if (!sourceUrl || imageFailed) {
    return (
      <span
        aria-hidden="true"
        className="pet-thumbnail pet-thumbnail-fallback"
        data-testid={`pet-thumbnail-${pet.id}`}
        style={{ width: size, height: size }}
      >
        {pet.id === 'piwin-default' ? 'π' : '🐾'}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="pet-thumbnail"
      data-testid={`pet-thumbnail-${pet.id}`}
      style={{ width: size, height: size }}
    >
      <img
        alt=""
        draggable={false}
        src={sourceUrl}
        style={{
          width: frameWidth * cols,
          height: frameHeight * rows,
          left: (size - frameWidth) / 2,
          top: (size - frameHeight) / 2,
        }}
        onLoad={(event) => {
          setImageDimensions({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          });
        }}
        onError={() => setImageFailed(true)}
      />
    </span>
  );
}
