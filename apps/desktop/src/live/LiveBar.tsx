import { IconButton } from '@piwin/ui-kit';
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import type { LiveCallView } from '@piwin/contracts';
import { useDesktopLocale } from '../desktop-locale-context.js';
import { IconClose, IconMic, IconRefresh } from '../shell-icons.js';
import type { LivePeerSnapshot } from './live-peer.js';
import { liveStartErrorLabel } from './use-live-call.js';

export type LiveBarProps = {
  call: LiveCallView | null;
  starting: boolean;
  peer: LivePeerSnapshot;
  error: string | null;
  onRetry: () => void;
  onDismiss: () => void;
  onMute: (muted: boolean) => void;
  onEnd: () => void;
};

export function LiveBar(props: LiveBarProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const muted = props.call?.activity === 'muted' || props.peer.muted;
  const presentation = presentLiveState(props, isChinese);

  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number } | null>(null);
  const barRef = useRef<HTMLElement | null>(null);

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    // Ignore clicks on buttons to avoid dragging when triggering actions
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }
    const bar = barRef.current;
    if (!bar) return;

    setIsDragging(true);
    bar.setPointerCapture(e.pointerId);

    const rect = bar.getBoundingClientRect();
    dragStartRef.current = {
      startX: e.clientX - (rect.left + rect.width / 2),
      startY: e.clientY - (rect.top + rect.height / 2),
    };
  }, []);

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!isDragging || !dragStartRef.current) return;

    const newX = e.clientX - dragStartRef.current.startX;
    const newY = e.clientY - dragStartRef.current.startY;

    // Viewport boundary clamping
    const clampedX = Math.max(50, Math.min(window.innerWidth - 50, newX));
    const clampedY = Math.max(20, Math.min(window.innerHeight - 20, newY));

    setPosition({ x: clampedX, y: clampedY });
  }, [isDragging]);

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    dragStartRef.current = null;
    try {
      barRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture already released
    }
  }, [isDragging]);

  const dynamicStyle = position
    ? {
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: isDragging ? 'translate(-50%, -50%) scale(1.06)' : 'translate(-50%, -50%)',
      }
    : undefined;

  return (
    <section
      ref={barRef}
      id="piwin-live-panel"
      className={`live-bar is-${presentation.tone} ${isDragging ? 'is-dragging' : ''}`}
      style={dynamicStyle}
      data-testid="live-bar"
      data-activity={presentation.motion}
      aria-label={presentation.accessibleLabel}
      role={props.error ? 'alert' : 'status'}
      title={props.call ? `${presentation.accessibleLabel} · ${props.call.boundSessionLabel}` : presentation.accessibleLabel}
      tabIndex={-1}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Drag Grip Dots */}
      <div className="live-bar-grip" aria-hidden="true" title={isChinese ? '按住可拖拽移动' : 'Drag to reposition'}>
        <span />
        <span />
        <span />
      </div>

      {/* Visual FX Animation (Equalizer / Spinner / Badge / Alert) */}
      <div className="live-bar-fx" aria-hidden="true">
        {presentation.fxType === 'spinner' ? (
          <span className="live-spinner" />
        ) : presentation.fxType === 'equalizer' ? (
          <span className="live-equalizer">
            <span />
            <span />
            <span />
            <span />
          </span>
        ) : presentation.fxType === 'equalizer-flat' ? (
          <span className="live-equalizer is-flat">
            <span />
            <span />
            <span />
            <span />
          </span>
        ) : presentation.fxType === 'warning' ? (
          <span className="live-alert-dot" />
        ) : (
          <span className="live-alert-dot" />
        )}
      </div>

      {props.call?.boundSessionLabel ? (
        <span className="live-bar-session" data-testid="live-bar-session">
          {props.call.boundSessionLabel}
        </span>
      ) : null}

      {props.error ? <span className="live-bar-error-copy">{liveStartErrorLabel(props.error, isChinese)}</span> : null}

      {/* Media controls never imply permission approval or response cancellation. */}
      <div className="live-bar-actions">
        {props.error ? (
          <>
            <IconButton
              type="button"
              className="live-icon-btn is-accent"
              label={isChinese ? '重试' : 'Retry'}
              title={isChinese ? '重试连接' : 'Retry connection'}
              onClick={props.onRetry}
              data-testid="live-bar-retry"
            >
              <IconRefresh size={13} aria-hidden="true" />
            </IconButton>
            <IconButton
              type="button"
              className="live-icon-btn is-danger"
              label={isChinese ? '关闭 Live 提示' : 'Dismiss Live message'}
              title={isChinese ? '关闭' : 'Dismiss'}
              onClick={props.onDismiss}
              data-testid="live-bar-dismiss"
            >
              <IconClose size={14} aria-hidden="true" />
            </IconButton>
          </>
        ) : props.call ? (
          <>
            <IconButton
              className={`live-icon-btn ${muted ? 'is-muted' : ''}`}
              aria-pressed={muted}
              label={muted ? (isChinese ? '取消静音' : 'Unmute') : isChinese ? '静音' : 'Mute'}
              onClick={() => props.onMute(!muted)}
              data-testid="live-bar-mute"
            >
              <IconMic size={16} aria-hidden="true" />
            </IconButton>

            <IconButton
              type="button"
              className="live-icon-btn is-danger"
              label={isChinese ? '挂断通话' : 'Hang up'}
              title={isChinese ? '挂断' : 'Hang up'}
              onClick={props.onEnd}
              data-testid="live-bar-end"
            >
              <IconClose size={14} aria-hidden="true" />
            </IconButton>
          </>
        ) : (
          <IconButton
            type="button"
            className="live-icon-btn is-danger"
            label={isChinese ? '取消连接' : 'Cancel'}
            title={isChinese ? '取消' : 'Cancel'}
            onClick={props.onEnd}
            data-testid="live-bar-cancel"
          >
            <IconClose size={14} aria-hidden="true" />
          </IconButton>
        )}
      </div>
    </section>
  );
}

type LivePresentation = {
  accessibleLabel: string;
  tone: 'connecting' | 'active' | 'speaking' | 'muted' | 'working' | 'permission' | 'error';
  motion:
    | 'connecting'
    | 'listening'
    | 'user-speaking'
    | 'assistant-speaking'
    | 'working'
    | 'permission'
    | 'muted'
    | 'error'
    | 'still';
  fxType: 'spinner' | 'equalizer' | 'equalizer-flat' | 'warning' | 'alert-dot';
};

function presentLiveState(props: LiveBarProps, isChinese: boolean): LivePresentation {
  if (props.error) {
    return {
      accessibleLabel: `${isChinese ? '语音连接未建立' : 'Voice connection error'}: ${liveStartErrorLabel(props.error, isChinese)}`,
      tone: 'error',
      motion: 'error',
      fxType: 'alert-dot',
    };
  }
  const mediaUp = props.peer.phase === 'connected';
  if ((props.starting || props.call?.phase === 'starting') && !mediaUp) {
    return {
      accessibleLabel: isChinese ? '正在连接 piwin Live' : 'Connecting to piwin Live',
      tone: 'connecting',
      motion: 'connecting',
      fxType: 'spinner',
    };
  }
  if (props.call?.phase === 'reconnecting' && !mediaUp) {
    return {
      accessibleLabel: isChinese ? '正在重新连接语音' : 'Reconnecting voice',
      tone: 'connecting',
      motion: 'connecting',
      fxType: 'spinner',
    };
  }
  if (props.call?.activity === 'user-speaking') {
    return {
      accessibleLabel: isChinese ? '正在听你说' : 'Listening to you',
      tone: 'active',
      motion: 'user-speaking',
      fxType: 'equalizer',
    };
  }
  if (props.call?.activity === 'assistant-speaking') {
    return {
      accessibleLabel: isChinese ? '模型正在回复' : 'Assistant responding',
      tone: 'speaking',
      motion: 'assistant-speaking',
      fxType: 'equalizer',
    };
  }
  if (props.call?.activity === 'waiting-for-permission') {
    return {
      accessibleLabel: isChinese ? '等待终端权限确认' : 'Waiting for permission',
      tone: 'permission',
      motion: 'permission',
      fxType: 'warning',
    };
  }
  if (props.call?.activity === 'agent-working') {
    return {
      accessibleLabel: isChinese ? 'Agent 正在处理工作' : 'Agent working',
      tone: 'working',
      motion: 'working',
      fxType: 'equalizer',
    };
  }
  if (props.call?.activity === 'muted' || props.peer.muted) {
    return {
      accessibleLabel: isChinese ? '麦克风已静音' : 'Microphone muted',
      tone: 'muted',
      motion: 'muted',
      fxType: 'equalizer-flat',
    };
  }
  return {
    accessibleLabel: isChinese ? '语音正在倾听' : 'Voice listening',
    tone: 'active',
    motion: 'listening',
    fxType: 'equalizer',
  };
}
