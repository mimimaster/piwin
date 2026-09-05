import { useState, type ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../demo-state.js';
import { FullButton, ListRow, RadioOptions, SectionLabel } from '../inkstone-ui.js';
import { VoiceBars } from './voice-bits.js';

export function ModelSheet(): ReactElement {
  const { state, dispatch } = useInkstone();
  return (
    <>
      <p>为接下来的一轮选择模型。历史消息保留生成时的模型。</p>
      {['Claude Sonnet', 'Claude Opus', 'GPT · 自定义'].map((model) => (
        <ListRow
          key={model}
          name="bulb"
          title={model}
          subtitle={
            model === 'Claude Sonnet' ? '日常编码 · 支持图片' : '使用 Host 上已有的供应商配置'
          }
          onClick={() => dispatch({ type: 'choose-model', value: model })}
          trailing={state.model === model ? '✓' : undefined}
          selected={state.model === model}
        />
      ))}
      <SectionLabel>思考强度</SectionLabel>
      <RadioOptions
        values={['轻量', '标准', '深入']}
        selected={state.effort}
        onSelect={(value) => dispatch({ type: 'choose-effort', value })}
      />
      <FullButton onClick={() => dispatch({ type: 'close-sheet' })}>完成</FullButton>
    </>
  );
}

export function ModeSheet(): ReactElement {
  const { state, dispatch } = useInkstone();
  return (
    <>
      <SectionLabel>权限模式</SectionLabel>
      <RadioOptions
        values={['Auto', 'Ask', 'YOLO']}
        selected={state.mode}
        onSelect={(value) => dispatch({ type: 'choose-mode', value })}
      />
      <p>Auto 按规则询问；Ask 每次询问；YOLO 跳过询问。这里仅切换演示状态。</p>
      <SectionLabel>编排方式</SectionLabel>
      <RadioOptions
        values={['单 Agent', 'Ultra Code']}
        selected={state.scheme}
        onSelect={(value) => dispatch({ type: 'choose-scheme', value })}
      />
      <ListRow
        name="bulb"
        title="Goal 模式"
        subtitle="持续推进到目标完成"
        onClick={() => dispatch({ type: 'open-sheet', key: 'goal' })}
      />
      <FullButton onClick={() => dispatch({ type: 'close-sheet' })}>完成</FullButton>
    </>
  );
}

export function SchemeSheet(): ReactElement {
  const { state, dispatch } = useInkstone();
  return (
    <>
      <p>职责和隔离方式由 Host 上的方案定义。</p>
      <RadioOptions
        values={['单 Agent', 'Ultra Code']}
        selected={state.scheme}
        onSelect={(value) => dispatch({ type: 'choose-scheme', value })}
      />
      <ListRow
        name="fork"
        title="test-runner"
        subtitle="职责：测试恢复路径 · 独立工作树"
        onClick={() => dispatch({ type: 'open-sheet', key: 'subagent' })}
      />
      <FullButton onClick={() => dispatch({ type: 'close-sheet' })}>应用到演示会话</FullButton>
    </>
  );
}

export function AttachSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  return (
    <>
      <ListRow
        name="image"
        title="照片或截图"
        subtitle="演示选择一张图片"
        onClick={() => dispatch({ type: 'attach', value: 'mobile-reference.png' })}
      />
      <ListRow
        name="file"
        title="文件"
        subtitle="演示附加一份设计说明"
        onClick={() => dispatch({ type: 'attach', value: 'session-notes.md' })}
      />
      <ListRow
        name="folder"
        title="@ 引用项目文件"
        subtitle="从 Host 的项目中选取"
        onClick={openSheet('references')}
      />
      <ListRow
        name="cards"
        title="技能"
        subtitle="使用已安装的技能"
        onClick={openSheet('skills')}
      />
      <ListRow
        name="globe"
        title="MCP 工具"
        subtitle="工具在 Host 上执行"
        onClick={openSheet('mcp')}
      />
      <ListRow
        name="term"
        title="/ 命令"
        subtitle="常用动作与提示词"
        onClick={openSheet('commands')}
      />
      <ListRow name="mic" title="piwin Live" subtitle="进入语音会话演示" onClick={go('voice')} />
    </>
  );
}

export function ReferencesSheet(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <>
      {(
        [
          ['session-index.ts', 'packages/session/src', '@session-index.ts'],
          ['architecture.md', 'docs', '@architecture.md'],
          ['session-memory.md', 'docs/plans', '@session-memory.md'],
        ] as [string, string, string][]
      ).map(([title, subtitle, value]) => (
        <ListRow
          key={value}
          name="file"
          title={title}
          subtitle={subtitle}
          onClick={() => dispatch({ type: 'attach', value })}
        />
      ))}
    </>
  );
}

export function SkillsSheet(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <>
      <ListRow
        name="cards"
        title="karpathy-guidelines"
        subtitle="简单、明确、可验证"
        onClick={() => dispatch({ type: 'attach', value: '/skill karpathy-guidelines' })}
      />
      <ListRow
        name="cards"
        title="code-review"
        subtitle="检查变更与回归风险"
        onClick={() => dispatch({ type: 'attach', value: '/skill code-review' })}
      />
      <FullButton
        variant="secondary"
        onClick={() => dispatch({ type: 'settings-section', section: '技能与扩展' })}
      >
        管理技能
      </FullButton>
    </>
  );
}

export function CommandsSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  return (
    <>
      <ListRow
        name="cards"
        title="/plan"
        subtitle="先写计划，再决定怎么执行"
        onClick={() => dispatch({ type: 'command', value: '先整理一份计划，暂时不要修改文件。' })}
      />
      <ListRow name="git" title="/review" subtitle="审阅当前变更" onClick={go('review')} />
      <ListRow
        name="cards"
        title="/flashcards"
        subtitle="打开知识卡片工作台"
        onClick={go('cards')}
      />
      <ListRow
        name="file"
        title="/compact"
        subtitle="整理并压缩当前上下文"
        onClick={() => dispatch({ type: 'open-sheet', key: 'compact-context' })}
      />
    </>
  );
}

export function ContextSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  return (
    <>
      <div className="metric-grid">
        <div>
          <strong>37%</strong>
          <small>上下文占用</small>
        </div>
        <div>
          <strong>12.8k</strong>
          <small>已装配 token</small>
        </div>
        <div>
          <strong>3</strong>
          <small>引用文件</small>
        </div>
      </div>
      <ListRow
        name="file"
        title="AGENTS.md"
        subtitle="项目约束 · 自动带入"
        onClick={openSheet('file')}
      />
      <ListRow
        name="file"
        title="session-notes.md"
        subtitle="手动附件"
        onClick={openSheet('file')}
      />
      <ListRow
        name="cards"
        title="karpathy-guidelines"
        subtitle="已启用技能"
        onClick={openSheet('skill-detail')}
      />
      <FullButton variant="secondary" onClick={openSheet('compact-context')}>
        压缩上下文
      </FullButton>
    </>
  );
}

export function DictationSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const [text, setText] = useState('把刚才的恢复方案整理一下，先列计划，不要开始修改。');
  return (
    <>
      <VoiceBars levels={[2, 4, 6, 3, 8, 5, 4, 7, 2]} />
      <p>语音转文字演示 · 未使用麦克风</p>
      <label className="field">
        识别文字，可继续修改
        <textarea value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <FullButton onClick={() => dispatch({ type: 'use-dictation', value: text.trim() })}>
        放入砚台
      </FullButton>
      <FullButton
        variant="secondary"
        onClick={() => dispatch({ type: 'navigate', route: 'voice' })}
      >
        进入 Live 会话
      </FullButton>
    </>
  );
}

export function VoiceSettingsSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const saveDemo = (message: string) => () => dispatch({ type: 'save-demo', values: {}, message });
  return (
    <>
      <ListRow
        name="mic"
        title="语音输入"
        subtitle="中文 · 自动识别"
        onClick={saveDemo('已选择中文语音演示')}
      />
      <ListRow
        name="bulb"
        title="Live 连接"
        subtitle="使用当前 Host 的配置"
        onClick={saveDemo('移动 Live 尚为设计提议')}
      />
      <FullButton variant="secondary" onClick={() => dispatch({ type: 'close-sheet' })}>
        完成
      </FullButton>
    </>
  );
}
