import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
  type ReactElement,
} from 'react';
import type { MediaPreviewReader } from './transcript-media-preview';

type MediaPreviewReadValue = {
  sessionId: string | null;
  readMedia: MediaPreviewReader | null;
};

const DEFAULT_VALUE: MediaPreviewReadValue = {
  sessionId: null,
  readMedia: null,
};

const MediaPreviewReadContext = createContext<MediaPreviewReadValue>(DEFAULT_VALUE);

export type MediaPreviewReadProviderProps = PropsWithChildren<{
  sessionId: string | null;
  readMedia: MediaPreviewReader | null;
}>;

/** Supplies transcript bubbles with session identity + media/read for Host-side thumbs. */
export function MediaPreviewReadProvider({
  sessionId,
  readMedia,
  children,
}: MediaPreviewReadProviderProps): ReactElement {
  const value = useMemo(
    () => ({ sessionId, readMedia }),
    [sessionId, readMedia],
  );
  return (
    <MediaPreviewReadContext.Provider value={value}>{children}</MediaPreviewReadContext.Provider>
  );
}

export function useMediaPreviewRead(): MediaPreviewReadValue {
  return useContext(MediaPreviewReadContext);
}
