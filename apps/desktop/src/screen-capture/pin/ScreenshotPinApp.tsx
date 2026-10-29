/**
 * Root of a screenshot pin window (`screenshot-pin.html`): loads the PNG
 * from native, lets the user drag it, Esc / × closes.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { loadDesktopLocale } from '../../i18n/desktop-locale.js';
import {
  createTauriPinBridge,
  type ScreenshotPinBridge,
} from './screenshot-pin-bridge.js';

function reportPinError(action: string): (error: unknown) => void {
  return (error) => console.error(`[piwin] screenshot pin ${action} failed`, error);
}

export function ScreenshotPinApp({
  bridge: injected,
}: {
  bridge?: ScreenshotPinBridge;
}): ReactElement | null {
  const bridge = useMemo(() => injected ?? createTauriPinBridge(), [injected]);
  const locale = useMemo(() => loadDesktopLocale(), []);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    bridge
      .image()
      .then((bytes) => {
        objectUrl = URL.createObjectURL(new Blob([bytes.slice()], { type: 'image/png' }));
        if (active) {
          setUrl(objectUrl);
        }
      })
      .catch((error: unknown) => {
        reportPinError('image load')(error);
        bridge.close().catch(reportPinError('close'));
      });
    return () => {
      active = false;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [bridge]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      bridge.close().catch(reportPinError('close'));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [bridge]);

  if (url === null) {
    return null;
  }

  const closeLabel = locale === 'zh-CN' ? '关闭贴图  Esc' : 'Close pin  Esc';
  return (
    <div className="screenshot-pin" data-testid="screenshot-pin">
      <img
        src={url}
        alt=""
        draggable={false}
        className="screenshot-pin-image"
        data-tauri-drag-region
      />
      <button
        type="button"
        className="screenshot-pin-close"
        aria-label={closeLabel}
        data-testid="screenshot-pin-close"
        onClick={() => {
          bridge.close().catch(reportPinError('close'));
        }}
      >
        ×
      </button>
    </div>
  );
}
