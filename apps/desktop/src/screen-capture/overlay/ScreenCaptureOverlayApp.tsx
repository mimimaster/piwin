/**
 * Root of the capture overlay window (`screen-capture.html`): decodes the
 * frozen screenshot, tells native to show the window, and runs the editor
 * from step 1. Finishing hands the PNG to native, which copies it to the
 * clipboard and closes this window.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { loadDesktopLocale } from '../../i18n/desktop-locale.js';
import { PIWIN_APPEARANCE_DARK } from '../../theme/appearance-tokens.js';
import type { ImageSize } from '../annotation-model.js';
import { ScreenshotEditor } from '../ScreenshotEditor.js';
import {
  createTauriOverlayBridge,
  type ScreenCaptureOverlayBridge,
} from './screen-capture-overlay-bridge.js';

type LoadedImage = { url: string; size: ImageSize };

function reportBridgeError(action: string): (error: unknown) => void {
  return (error) => console.error(`[piwin] screen capture overlay ${action} failed`, error);
}

export function ScreenCaptureOverlayApp({
  bridge: injected,
}: {
  bridge?: ScreenCaptureOverlayBridge;
}): ReactElement {
  const bridge = useMemo(() => injected ?? createTauriOverlayBridge(), [injected]);
  const locale = useMemo(() => loadDesktopLocale(), []);
  const [loaded, setLoaded] = useState<LoadedImage | null>(null);

  useEffect(() => {
    let active = true;
    let url: string | null = null;
    bridge
      .image()
      .then(async (bytes) => {
        url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'image/png' }));
        const probe = new Image();
        probe.src = url;
        await probe.decode();
        if (active) {
          setLoaded({ url, size: { width: probe.naturalWidth, height: probe.naturalHeight } });
        }
      })
      .catch((error: unknown) => {
        reportBridgeError('image load')(error);
        bridge.cancel().catch(reportBridgeError('cancel'));
      });
    return () => {
      active = false;
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [bridge]);

  // Show the window only after the screenshot has painted: no blank flash.
  useEffect(() => {
    if (loaded === null) return undefined;
    const frame = requestAnimationFrame(() => {
      bridge.ready().catch(reportBridgeError('ready'));
    });
    return () => cancelAnimationFrame(frame);
  }, [bridge, loaded]);

  const cancel = (): void => {
    bridge.cancel().catch(reportBridgeError('cancel'));
  };

  return (
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      {loaded === null ? null : (
        <ScreenshotEditor
          imageUrl={loaded.url}
          image={loaded.size}
          initialSelection={null}
          locale={locale}
          doneLabel={locale === 'zh-CN' ? '完成，复制到剪贴板' : 'Done, copy to clipboard'}
          onCancel={cancel}
          onDone={(png) => {
            png
              .arrayBuffer()
              .then((buffer) => bridge.finish(new Uint8Array(buffer)))
              .catch(reportBridgeError('finish'));
          }}
          onExportFailed={(error) => {
            // Nothing in this window can show a message; native reports a cancel.
            reportBridgeError('export')(error);
            cancel();
          }}
        />
      )}
    </PiwinUiProvider>
  );
}
