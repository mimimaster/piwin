import type { ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../demo-state.js';
import { Icon } from '../icons.js';
import { Dot, IconButton, Pill, TopBar } from '../inkstone-ui.js';
import { VoiceBars } from '../sheets/voice-bits.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { useMobileLive } from '../../hooks/use-mobile-live.js';

const VOICE_LEVELS = [1, 2, 4, 7, 5, 3, 8, 6, 4, 2, 5, 7, 3, 2, 1];

export function VoicePage(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx !== null) {
    return <ConnectedVoicePage hostCtx={hostCtx} />;
  }
  const { state, dispatch } = useInkstone();
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  return (
    <>
      <TopBar
        title="piwin Live"
        subtitle="移动语音 · 演示场景"
        onBack={go('chat')}
        right={
          <>
            <IconButton
              name="pip"
              label="收缩为小部件"
              onClick={() => dispatch({ type: 'shrink-live' })}
            />
            <IconButton
              name="sliders"
              label="语音设置"
              onClick={openSheet('voice-settings')}
            />
          </>
        }
      />
      <div className="screen-scroll">
        <div className="live-stage">
          <Pill>
            <Dot status="running" />
            与当前会话连接
          </Pill>
          <div className="live-orbit">
            <span className="brand-seal">砚</span>
          </div>
          <h2>{state.muted ? '安静一会儿。' : '我在听，你慢慢说。'}</h2>
          <p>{state.currentTitle} · piwin</p>
          <VoiceBars levels={VOICE_LEVELS} muted={state.muted} />
          <div className="quote-note" style={{ textAlign: 'left' }}>
            “把刚才的恢复方案整理一下，
            <br />
            先列计划，不要开始修改。”
          </div>
          <p>演示转录 · 未使用麦克风</p>
          <div className="live-controls">
            <button
              onClick={() => dispatch({ type: 'mute-voice' })}
              aria-label={state.muted ? '取消静音' : '静音'}
              type="button"
            >
              <Icon name={state.muted ? 'close' : 'mic'} />
            </button>
            <button
              className="end-call"
              onClick={() => dispatch({ type: 'end-voice' })}
              aria-label="结束语音"
              type="button"
            >
              <Icon name="close" />
            </button>
          </div>
          <p style={{ marginTop: 17 }}>{state.muted ? '已静音' : '麦克风'}　　结束</p>
        </div>
      </div>
    </>
  );
}

function ConnectedVoicePage({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const live = useMobileLive({
    hostClient: host.client,
    sessionId: host.activeSessionId,
    ensureSession: async () => host.handleCreateSession(),
  });
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
