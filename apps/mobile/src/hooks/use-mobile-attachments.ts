/**
 * Composer attachment picking for the mobile shell: one image at a time,
 * uploaded to the Host on the active session, held in memory until the next
 * prompt carries it. Split out of `use-mobile-host` to keep that hook small.
 */
import { useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import type { HostClient } from '@piwin/host-client';
import { uploadMobileImage } from './mobile-media-upload.js';
import type { MobileMediaAttachment } from '../mobile-transcript.js';

export type MobileAttachments = {
  isUploadingMedia: boolean;
  handleFileSelected: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  removeAttachment: (id: string) => void;
};

export function useMobileAttachments(input: {
  clientRef: { current: HostClient | undefined };
  activeSessionRef: { current: string | undefined };
  setAttachments: Dispatch<SetStateAction<MobileMediaAttachment[]>>;
  setErrorMessage: (message: string | undefined) => void;
}): MobileAttachments {
  const { clientRef, activeSessionRef, setAttachments, setErrorMessage } = input;
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    const client = clientRef.current;
    const sessionId = activeSessionRef.current;
    if (file === undefined || client === undefined || sessionId === undefined) {
      return;
    }
    setIsUploadingMedia(true);
    setErrorMessage(undefined);
    try {
      const result = await uploadMobileImage(client, sessionId, file);
      if (result.ok) {
        setAttachments((current) => [...current, result.attachment]);
      } else {
        setErrorMessage(result.message);
      }
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const removeAttachment = (id: string): void => {
    setAttachments((current) => current.filter((item) => item.id !== id));
  };

  return { isUploadingMedia, handleFileSelected, removeAttachment };
}
