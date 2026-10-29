/**
 * Screenshot entry point, shared by the shortcut, the command palette and the
 * composer "+" menu. Overlay platforms: capture → pick + annotate on the
 * overlay → clipboard (+ composer when piwin was in front). Linux: OS region
 * picker → editor in the main window → composer.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import type { DesktopLocale } from '../i18n/desktop-locale.js';
import {
  pushError,
  pushInfo,
  type NotificationAction,
} from '../notifications/notification-queue.js';
import type { ImageSize } from './annotation-model.js';
import {
  runScreenCapture,
  screenCaptureCopiedInsteadMessage,
  screenCaptureCopyFailedMessage,
  screenCaptureFailureMessage,
  screenCaptureNeedsAppInFront,
  screenCaptureUnsupportedMessage,
  screenshotFileName,
} from './screen-capture-flow.js';
import type { DesktopScreenCaptureOs } from './screen-capture-os.js';
import { createTauriScreenCaptureOs } from './screen-capture-os-tauri.js';

export type ScreenCapturePhase =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'permission' }
  | { kind: 'editing'; imageUrl: string; image: ImageSize };

export type UseScreenCaptureArgs = {
  locale: DesktopLocale;
  canAttach: () => boolean;
  imageRefusal: () => string | undefined;
  /** Hands the annotated PNG to the composer's normal attachment pipeline. */
  attachImage: (file: File) => void;
  dispatchNotification: Dispatch<NotificationAction>;
  os?: DesktopScreenCaptureOs;
  /** Defaults to `document.hasFocus()`; injectable for tests. */
  piwinInFront?: () => boolean;
};

export type ScreenCaptureController = {
  phase: ScreenCapturePhase;
  /** Native capture exists on this platform; entry points hide otherwise. */
  supported: boolean;
  locale: DesktopLocale;
  start: () => void;
  close: () => void;
  confirm: (png: Blob) => void;
  pin: (png: Blob) => void;
  exportFailed: (error: unknown) => void;
  authorize: () => void;
  restart: () => void;
};

export function useScreenCapture(args: UseScreenCaptureArgs): ScreenCaptureController {
  const { locale, canAttach, imageRefusal, attachImage, dispatchNotification } = args;
  const os = useMemo(() => args.os ?? createTauriScreenCaptureOs(), [args.os]);
  const piwinInFront = args.piwinInFront ?? documentHasFocus;
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

  const reveal = useCallback((): void => {
    os.revealApp().catch((error: unknown) => {
      console.error('[piwin] screen capture could not bring piwin forward', error);
    });
  }, [os]);

  const start = useCallback((): void => {
    const current = phaseRef.current.kind;
    if (current !== 'idle') {
      // A second trigger is ignored (spec §5.1); an open editor or prompt comes forward.
      if (current === 'editing' || current === 'permission') reveal();
      return;
    }
    const running: ScreenCapturePhase = { kind: 'running' };
    // Set now, not on render: one key press can reach both the global and the in-app shortcut.
    phaseRef.current = running;
    setPhase(running);
    runScreenCapture({ os, canAttach, imageRefusal, piwinInFront })
      .then((result) => {
        if (screenCaptureNeedsAppInFront(result)) reveal();
        switch (result.kind) {
          case 'edit': {
            const blob = new Blob([result.bytes.slice()], { type: 'image/png' });
            setPhase({
              kind: 'editing',
              imageUrl: URL.createObjectURL(blob),
              image: { width: result.width, height: result.height },
            });
            return;
          }
          case 'attach':
            attachImage(screenshotFile(new Blob([result.bytes.slice()], { type: 'image/png' })));
            break;
          case 'needs-permission':
            setPhase({ kind: 'permission' });
            return;
          case 'refused':
            dispatchNotification(
              pushError(
                result.copied
                  ? screenCaptureCopiedInsteadMessage(locale, result.reason)
                  : result.reason,
              ),
            );
            break;
          case 'unsupported':
            dispatchNotification(pushInfo(screenCaptureUnsupportedMessage(locale)));
            break;
          case 'failed':
            reportError(result.code);
            break;
          case 'copy-failed':
            dispatchNotification(pushError(screenCaptureCopyFailedMessage(locale)));
            break;
          case 'blocked':
          case 'busy':
          case 'cancelled':
          case 'copied':
            break;
        }
        setPhase({ kind: 'idle' });
      })
      .catch((error: unknown) => {
        reveal();
        reportError(error);
        setPhase({ kind: 'idle' });
      });
  }, [
    attachImage,
    canAttach,
    dispatchNotification,
    imageRefusal,
    locale,
    os,
    piwinInFront,
    reportError,
    reveal,
  ]);

  // The system-wide shortcut works while piwin is in the background.
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    os.onShortcut(() => startRef.current())
      .then((stop) => {
        if (active) unsubscribe = stop;
        else stop();
      })
      .catch((error: unknown) => {
        console.error('[piwin] screen capture shortcut listener failed', error);
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [os]);

  const confirm = useCallback(
    (png: Blob): void => {
      attachImage(screenshotFile(png));
      setPhase({ kind: 'idle' });
    },
    [attachImage],
  );

  const pin = useCallback(
    (png: Blob): void => {
      void png
        .arrayBuffer()
        .then((buffer) => os.pin(new Uint8Array(buffer)))
        .then(() => {
          setPhase({ kind: 'idle' });
        })
        .catch(reportError);
    },
    [os, reportError],
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
    pin,
    exportFailed: reportError,
    authorize,
    restart,
  };
}

function screenshotFile(png: Blob): File {
  return new File([png], screenshotFileName(new Date()), { type: 'image/png' });
}

function documentHasFocus(): boolean {
  return typeof document !== 'undefined' && document.hasFocus();
}
