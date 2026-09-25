import type { ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import { useInkstone } from '../inkstone-context.js';
import { Icon } from '../icons.js';
import { Dot, IconButton, Pill, TopBar } from '../inkstone-ui.js';
import { VoiceBars } from '../sheets/voice-bits.js';
import { useInkstoneHost } from '../host/inkstone-host-context.js';
import type { MobileLiveCallController } from '../../hooks/use-mobile-live.js';
import { useLiveCall } from '../host/live-call-context.js';

const VOICE_LEVELS = [1, 2, 4, 7, 5, 3, 8, 6, 4, 2, 5, 7, 3, 2, 1];

export function VoicePage(): ReactElement {
  const hostCtx = useInkstoneHost();
  const live = useLiveCall();
  if (hostCtx === null || live === null) {
    return <NeedsHost />;
  }
  return <ConnectedVoicePage live={live} />;
}

function ConnectedVoicePage({ live }: { live: MobileLiveCallController }): ReactElement {
  const { dispatch } = useInkstone();
  const call = live.call;
  const ready = live.status?.ready === true;
  const statusText = call
    ? call.activity === 'user-speaking'
      ? '正在听你说'
      : call.activity === 'assistant-speaking'
        ? '正在回答'
        : call.activity === 'agent-working'
          ? '正在处理任务'
          : live.peer.muted
            ? '已静音'
            : '正在聆听'
    : live.starting
      ? '正在连接…'
      : ready
        ? '随时开始语音对话'
        : 'Live 尚未就绪';
  const provider = live.status?.selectedProviderId?.trim() || '尚未选择 Live 渠道';
  const missing = live.status?.missing ?? [];
  return (
    <>
      <TopBar
        title="piwin Live"
        subtitle="Host · 实时语音"
        onBack={() => dispatch({ type: 'navigate', route: 'chat' })}
        right={<IconButton name="sliders" label="语音设置" onClick={() => dispatch({ type: 'open-sheet', key: 'voice-settings' })} />}
      />
      <div className="screen-scroll">
        <div className="live-stage">
          <Pill variant={call ? 'pine' : ready ? 'azure' : 'zhu'}>
            <Dot status={call ? 'running' : ready ? 'done' : 'waiting'} />
            {call ? '与当前会话连接' : ready ? 'Host 已就绪' : '等待 Host'}
          </Pill>
          <div className="live-orbit"><span className="brand-seal">砚</span></div>
          <h2>{statusText}</h2>
          <p>{provider}{call?.voiceModelId ? ` · ${call.voiceModelId}` : ''}</p>
          <VoiceBars levels={VOICE_LEVELS} muted={live.peer.muted || !call} />
          {live.error !== null ? <p className="error-text">{live.error}</p> : null}
          {missing.length > 0 && !call && live.error === null ? <p className="muted">{missing.join(' · ')}</p> : null}
          {!call ? (
            <button className="full-button" onClick={() => void live.start()} disabled={!live.canStart || live.starting} type="button">
              {live.starting ? '正在连接…' : '开始 Live'}
            </button>
          ) : (
            <div className="live-controls">
              <button onClick={() => void live.setMuted(!live.peer.muted)} aria-label={live.peer.muted ? '取消静音' : '静音'} type="button">
                <Icon name={live.peer.muted ? 'close' : 'mic'} />
              </button>
              <button className="end-call" onClick={() => void live.end()} aria-label="结束语音" type="button">
                <Icon name="close" />
              </button>
            </div>
          )}
          <p className="muted">聊天任务仍由 Host 执行，手机只负责麦克风和扬声器。</p>
        </div>
      </div>
    </>
  );
}
