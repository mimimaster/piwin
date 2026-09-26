import { useEffect, useState, type ReactElement } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriRuntime } from './tauri-pty.js';

export type WindowsCaptionControlsProps = {
  className?: string;
};

function runWindowCommand(action: string, command: () => Promise<void>): void {
  if (!isTauriRuntime()) return;
  try {
    void command().catch((error: unknown) => {
      console.error(`[piwin] window ${action} failed`, error);
    });
  } catch (error) {
    console.error(`[piwin] window ${action} unavailable`, error);
  }
}

export function WindowsCaptionControls(props: WindowsCaptionControlsProps): ReactElement {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    try {
      const win = getCurrentWindow();
      void win.isMaximized().then(setIsMaximized).catch((error: unknown) => {
        console.warn('[piwin] window maximize state unavailable', error);
      });

      void win
        .onResized(() => {
          void win.isMaximized().then(setIsMaximized).catch((error: unknown) => {
            console.warn('[piwin] window maximize state unavailable', error);
          });
        })
        .then((unsub) => {
          unlisten = unsub;
        })
        .catch((error: unknown) => {
          console.warn('[piwin] window resize listener unavailable', error);
        });
    } catch (error) {
      console.warn('[piwin] window state unavailable', error);
    }

    return () => {
      unlisten?.();
    };
  }, []);

  const handleMinimize = () => {
    runWindowCommand('minimize', () => getCurrentWindow().minimize());
  };

  const handleToggleMaximize = () => {
    runWindowCommand('toggle maximize', async () => {
      const win = getCurrentWindow();
      await win.toggleMaximize();
      setIsMaximized(await win.isMaximized());
    });
  };

  const handleClose = () => {
    runWindowCommand('close', () => getCurrentWindow().close());
  };

  return (
    <div
      className={
        props.className
          ? `windows-caption-controls ${props.className}`
          : 'windows-caption-controls'
      }
      data-testid="windows-caption-controls"
      data-no-window-drag
      role="group"
      aria-label="窗口控制"
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="windows-caption-btn windows-caption-minimize"
        data-testid="windows-caption-minimize"
        title="最小化"
        aria-label="最小化"
        tabIndex={-1}
        onClick={handleMinimize}
      >
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>

      <button
        type="button"
        className="windows-caption-btn windows-caption-maximize"
        data-testid="windows-caption-maximize"
        title={isMaximized ? '还原' : '最大化'}
        aria-label={isMaximized ? '还原' : '最大化'}
        tabIndex={-1}
        onClick={handleToggleMaximize}
      >
        {isMaximized ? (
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
            <rect
              x="2.5"
              y="1.5"
              width="6"
              height="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
            <polyline
              points="1.5 3.5 1.5 8.5 6.5 8.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
            <rect
              x="1.5"
              y="1.5"
              width="7"
              height="7"
              rx="0.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        )}
      </button>

      <button
        type="button"
        className="windows-caption-btn windows-caption-close"
        data-testid="windows-caption-close"
        title="关闭"
        aria-label="关闭"
        tabIndex={-1}
        onClick={handleClose}
      >
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1" />
          <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}
