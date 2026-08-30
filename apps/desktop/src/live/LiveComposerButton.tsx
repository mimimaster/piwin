import type { ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { liveMissingLabel } from './use-live-call.js';
import type { LiveCallView, LiveReadyMissing } from '@piwin/contracts';
import { IconMic } from '../shell-icons.js';

export type LiveComposerButtonProps = {
  enabled: boolean;
  canStart: boolean;
  starting: boolean;
  call: LiveCallView | null;
  error: string | null;
  missing: LiveReadyMissing[];
  isChinese: boolean;
  onStart: () => void;
  onEnd: () => void;
};

export function LiveComposerButton(props: LiveComposerButtonProps): ReactElement {
  const active = Boolean(props.call) || props.starting;
  const canRetry = props.error !== null;
  const label = props.starting
    ? props.isChinese
      ? '连接中'
      : 'Connecting'
    : canRetry
      ? props.isChinese
        ? '重试 Live'
        : 'Retry Live'
      : 'Live';
  const hint =
    !props.call && !props.starting && !props.error && !props.canStart
      ? liveMissingLabel(props.missing, props.isChinese)
      : null;

  return (
    <>
      <Button
        size="compact"
        variant={active ? 'primary' : 'ghost'}
        className={`composer-live-btn${active ? ' live-active' : ''}`}
        data-testid="composer-live-btn"
        aria-pressed={active}
        disabled={!props.enabled}
        title={
          props.call
            ? props.isChinese
              ? 'piwin Live 已连接；通话控制位于顶部'
              : 'piwin Live is connected; controls are at the top'
            : props.starting
              ? props.isChinese
                ? '取消 piwin Live 连接'
                : 'Cancel piwin Live connection'
              : props.isChinese
                ? '开始 piwin Live'
                : 'Start piwin Live'
        }
        onClick={() => {
          if (props.starting) {
            props.onEnd();
            return;
          }
          if (props.call) {
            document.getElementById('piwin-live-panel')?.focus();
            return;
          }
          if (props.canStart || canRetry) props.onStart();
        }}
      >
        <IconMic size={15} aria-hidden="true" />
        {label}
      </Button>
      {hint ? (
        <span className="composer-speech-status" data-testid="composer-live-hint">
          {hint}
        </span>
      ) : null}
    </>
  );
}
