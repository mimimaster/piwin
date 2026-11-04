import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
  type ReactElement,
} from 'react';
import type { MediaPreviewReader } from '../conversation/transcript-media-preview';

type MediaPreviewReadValue = {
  sessionId: string | null;
  resourceHostKey: string | null;
  readMedia: MediaPreviewReader | null;
};

const DEFAULT_VALUE: MediaPreviewReadValue = {
  sessionId: null,
  resourceHostKey: null,
  readMedia: null,
};

const MediaPreviewReadContext = createContext<MediaPreviewReadValue>(DEFAULT_VALUE);

export type MediaPreviewReadProviderProps = PropsWithChildren<{
  sessionId: string | null;
  readMedia: MediaPreviewReader | null;
  resourceHostKey?: string;
}>;

/** Supplies transcript bubbles with session identity + media/read for Host-side thumbs. */
export function MediaPreviewReadProvider({
  sessionId,
  readMedia,
  resourceHostKey,
  children,
}: MediaPreviewReadProviderProps): ReactElement {
  const inherited = useContext(MediaPreviewReadContext);
  const ownerHost = resourceHostKey ?? inherited.resourceHostKey;
  const value = useMemo(
    () => ({ sessionId, readMedia, resourceHostKey: ownerHost }),
    [sessionId, readMedia, ownerHost],
  );
  return (
    <MediaPreviewReadContext.Provider value={value}>{children}</MediaPreviewReadContext.Provider>
  );
}

export function useMediaPreviewRead(): MediaPreviewReadValue {
  return useContext(MediaPreviewReadContext);
}
