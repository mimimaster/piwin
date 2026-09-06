import type { ReactElement } from 'react';
import { IconButton } from '@piwin/ui-kit';
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

function liveComposerButtonCopy(props: LiveComposerButtonProps): { label: string; title: string } {
  if (props.call) {
    const connected = props.isChinese
      ? 'piwin Live 已连接；通话控制位于顶部'
      : 'piwin Live is connected; controls are at the top';
    return { label: connected, title: connected };
  }
  if (props.starting) {
    const cancel = props.isChinese ? '取消 piwin Live 连接' : 'Cancel piwin Live connection';
    return { label: cancel, title: cancel };
  }
  if (props.error) {
    const retry = props.isChinese ? '重试 Live' : 'Retry Live';
    return { label: retry, title: retry };
  }
  const start = props.isChinese ? '开始 piwin Live' : 'Start piwin Live';
  if (!props.canStart) {
    return { label: start, title: liveMissingLabel(props.missing, props.isChinese) };
  }
  return { label: start, title: start };
}

export function LiveComposerButton(props: LiveComposerButtonProps): ReactElement {
  const active = Boolean(props.call) || props.starting;
  const canRetry = props.error !== null;
  const copy = liveComposerButtonCopy(props);

  return (
    <IconButton
      className={`composer-v2-icon-btn composer-live-btn${active ? ' active' : ''}`}
      data-testid="composer-live-btn"
      label={copy.label}
      title={copy.title}
      aria-pressed={active}
      disabled={!props.enabled}
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
      <IconMic />
    </IconButton>
  );
}
