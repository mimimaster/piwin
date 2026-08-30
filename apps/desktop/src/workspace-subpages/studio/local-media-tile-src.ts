import {
  mediaThumbFileName,
  type MediaLibraryItem,
  type MediaThumbEdge,
} from '@piwin/contracts';

function siblingVaultThumbPath(
  originalAbsolutePath: string,
  assetId: string,
  edge: MediaThumbEdge,
): string {
  const slash = Math.max(
    originalAbsolutePath.lastIndexOf('/'),
    originalAbsolutePath.lastIndexOf('\\'),
  );
  const dir = slash === -1 ? '' : originalAbsolutePath.slice(0, slash + 1);
  return `${dir}${mediaThumbFileName(assetId, edge)}`;
}

/**
 * Local thumb path only when Host said a sidecar exists.
 * convertFileSrc of a guessed sibling looks like success and paints a blank tile.
 */
export function localThumbPathForItem(
  item: Pick<MediaLibraryItem, 'absolutePath' | 'assetId' | 'hasThumb' | 'thumbAbsolutePath'>,
  edge: MediaThumbEdge,
): string {
  if (item.hasThumb !== true) {
    return '';
  }
  if (item.absolutePath) {
    return siblingVaultThumbPath(item.absolutePath, item.assetId, edge);
  }
  return item.thumbAbsolutePath ?? '';
}
