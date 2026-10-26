/**
 * Screenshot entry point: capture → annotate → composer attachment.
 * Shared by the shortcut, the command palette and the composer "+" menu.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import type { DesktopLocale } from '../i18n/desktop-locale.js';
import {
  pushError,
  pushInfo,
  type NotificationAction,
} from '../notifications/notification-queue.js';
import type { AnnotationTool, ImageSize } from './annotation-model.js';
import {
  runScreenCapture,
  screenCaptureFailureMessage,
  screenCaptureUnsupportedMessage,
  screenshotFileName,
} from './screen-capture-flow.js';
import type { DesktopScreenCaptureOs } from './screen-capture-os.js';
import { createTauriScreenCaptureOs } from './screen-capture-os-tauri.js';

export type ScreenCapturePhase =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'permission' }
  | { kind: 'editing'; imageUrl: string; image: ImageSize; initialTool: AnnotationTool };

export type UseScreenCaptureArgs = {
  locale: DesktopLocale;
  canAttach: () => boolean;
  imageRefusal: () => string | undefined;
  /** Hands the annotated PNG to the composer's normal attachment pipeline. */
  attachImage: (file: File) => void;
  dispatchNotification: Dispatch<NotificationAction>;
  os?: DesktopScreenCaptureOs;
};

export type ScreenCaptureController = {
  phase: ScreenCapturePhase;
  /** Native capture exists on this platform; entry points hide otherwise. */
  supported: boolean;
  locale: DesktopLocale;
  start: () => void;
  close: () => void;
  confirm: (png: Blob) => void;
  exportFailed: (error: unknown) => void;
  authorize: () => void;
  restart: () => void;
};

export function useScreenCapture(args: UseScreenCaptureArgs): ScreenCaptureController {
  const { locale, canAttach, imageRefusal, attachImage, dispatchNotification } = args;
  const os = useMemo(() => args.os ?? createTauriScreenCaptureOs(), [args.os]);
  const [phase, setPhase] = useState<ScreenCapturePhase>({ kind: 'idle' });
  const [supported, setSupported] = useState(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    let active = true;
    os.capabilities()
      .then((capabilities) => {
        if (active) setSupported(capabilities.supported);
      })
      .catch((error: unknown) => {
        console.error('[piwin] screen capture capability probe failed', error);
      });
    return () => {
      active = false;
    };
  }, [os]);

  const reportError = useCallback(
    (error: unknown): void => {
      console.error('[piwin] screen capture failed', error);
      dispatchNotification(pushError(screenCaptureFailureMessage(locale)));
    },
    [dispatchNotification, locale],
  );

  const close = useCallback((): void => {
    setPhase({ kind: 'idle' });
  }, []);

  // The object URL lives exactly as long as the editor that shows it.
  useEffect(() => {
    if (phase.kind !== 'editing') {
      return undefined;
    }
    const url = phase.imageUrl;
    return () => URL.revokeObjectURL(url);
  }, [phase]);

  const start = useCallback((): void => {
    // A second trigger while capturing or editing is ignored (spec §5.1).
    if (phaseRef.current.kind !== 'idle') {
      return;
    }
    setPhase({ kind: 'running' });
    runScreenCapture({ os, canAttach, imageRefusal })
      .then((result) => {
        switch (result.kind) {
          case 'captured': {
            const blob = new Blob([result.bytes.slice()], { type: 'image/png' });
            setPhase({
              kind: 'editing',
              imageUrl: URL.createObjectURL(blob),
              image: { width: result.width, height: result.height },
              initialTool: result.systemRegionPicker ? 'rect' : 'crop',
            });
            return;
          }
          case 'needs-permission':
            setPhase({ kind: 'permission' });
            return;
          case 'refused':
            dispatchNotification(pushError(result.reason));
            break;
          case 'unsupported':
            dispatchNotification(pushInfo(screenCaptureUnsupportedMessage(locale)));
            break;
          case 'failed':
            reportError(result.code);
            break;
          case 'blocked':
          case 'busy':
          case 'cancelled':
            break;
        }
        setPhase({ kind: 'idle' });
      })
      .catch((error: unknown) => {
        reportError(error);
        setPhase({ kind: 'idle' });
      });
  }, [canAttach, dispatchNotification, imageRefusal, locale, os, reportError]);

  const confirm = useCallback(
    (png: Blob): void => {
      attachImage(new File([png], screenshotFileName(new Date()), { type: 'image/png' }));
      setPhase({ kind: 'idle' });
    },
    [attachImage],
  );

  const authorize = useCallback((): void => {
    os.requestAuthorization()
      .then((status) => {
        if (status !== 'authorized') {
          return os.openSystemSettings();
        }
        return undefined;
      })
      .catch(reportError);
  }, [os, reportError]);

  const restart = useCallback((): void => {
    os.restartApp().catch(reportError);
  }, [os, reportError]);

  return {
    phase,
    supported,
    locale,
    start,
    close,
    confirm,
    exportFailed: reportError,
    authorize,
    restart,
  };
}
