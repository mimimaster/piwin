import type { ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../demo-state.js';
import { Icon } from '../icons.js';
import { Dot, IconButton, Pill, TopBar } from '../inkstone-ui.js';
import { VoiceBars } from '../sheets/voice-bits.js';

const VOICE_LEVELS = [1, 2, 4, 7, 5, 3, 8, 6, 4, 2, 5, 7, 3, 2, 1];

export function VoicePage(): ReactElement {
  const { state, dispatch } = useInkstone();
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  return (
    <>
      <TopBar
        title="piwin Live"
        subtitle="移动语音 · 演示场景"
        onBack={go('chat')}
        right={<IconButton name="sliders" label="语音设置" onClick={openSheet('voice-settings')} />}
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
