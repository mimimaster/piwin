import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { MediaAttachmentRef, MediaLibraryItem } from '@piwin/contracts';
import {
  appendQuotedComposerText,
  focusComposerInput,
} from '../context-menu/desktop-context-menu-value.js';
import { mediaAttachmentFromLibraryItem } from '../media-image-target.js';

export function useWorkbenchMedia({
  streaming,
  addExistingMediaAttachment,
  setComposer,
  closeSubPage,
}: {
  streaming: boolean;
  addExistingMediaAttachment: (attachment: MediaAttachmentRef) => void;
  setComposer: Dispatch<SetStateAction<string>>;
  closeSubPage: () => void;
}) {
  const [mediaLibraryEpoch, setMediaLibraryEpoch] = useState(0);
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (wasStreamingRef.current && !streaming) {
      setMediaLibraryEpoch((epoch) => epoch + 1);
    }
    wasStreamingRef.current = streaming;
  }, [streaming]);
  const handleRemixToComposer = useCallback(
    (input: { text: string; item?: MediaLibraryItem }) => {
      if (input.item) {
        addExistingMediaAttachment(mediaAttachmentFromLibraryItem(input.item));
      }
      const draft = input.text.trim();
      if (draft) {
        setComposer((current) => appendQuotedComposerText(current, draft));
      }
      closeSubPage();
      window.setTimeout(() => focusComposerInput(), 0);
    },
    [addExistingMediaAttachment, setComposer, closeSubPage],
  );
  return { mediaLibraryEpoch, handleRemixToComposer };
}
