import { useState, type ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { Facts, FullButton, ListRow, Pill } from '../inkstone-ui.js';
import { useInkstoneHost } from '../host/inkstone-host-context.js';

const WORKSPACE_ENTRIES: [
  'folder' | 'term' | 'git' | 'globe' | 'panelr' | 'file' | 'cards' | 'panel',
  string,
][] = [
  ['folder', '文件'],
  ['term', '终端'],
  ['git', '变更'],
  ['globe', '浏览器'],
  ['panelr', '画布'],
  ['file', '文档'],
  ['file', '笔记'],
  ['cards', '卡片'],
  ['panel', '侧聊'],
];

export function WorkspaceMenuSheet(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <>
      {WORKSPACE_ENTRIES.map(([name, title], index) => (
        <ListRow
          key={`${title}-${index}`}
          name={name}
          title={title}
          onClick={() => dispatch({ type: 'open-workspace', tab: title })}
        />
      ))}
    </>
  );
}

export function FolderSheet(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <>
      <ListRow
        name="file"
        title="session-index.ts"
        subtitle="src/session"
        onClick={() => dispatch({ type: 'open-sheet', key: 'file' })}
      />
      <ListRow
        name="file"
        title="draft-store.ts"
        subtitle="src/session"
        onClick={() => dispatch({ type: 'open-sheet', key: 'file' })}
      />
      <ListRow
        name="file"
        title="README.md"
        subtitle="项目文档"
        onClick={() => dispatch({ type: 'open-workspace', tab: '文档' })}
      />
    </>
  );
}

export function FileSheet(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <>
      <Pill mono>packages/session/src</Pill>
      <pre className="terminal">
        {
          'export async function restoreSession(id) {\n  const saved = await store.get(id);\n  if (!saved) return createSession(id);\n  return hydrateSession(saved);\n}'
        }
      </pre>
      <p>文件内容为原型示例。</p>
      <FullButton onClick={() => dispatch({ type: 'add-context', value: '@session-index.ts' })}>
        引用到对话
      </FullButton>
      <FullButton
        variant="secondary"
        onClick={() => dispatch({ type: 'navigate', route: 'review' })}
      >
        查看差异
      </FullButton>
    </>
  );
}

export function TerminalCommandSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const [command, setCommand] = useState('pnpm typecheck');
  return (
    <>
      <p>这里不会直接连接远程终端。命令作为一条要求回到当前会话。</p>
      <label className="field">
        命令
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          autoComplete="off"
        />
      </label>
      <FullButton onClick={() => dispatch({ type: 'terminal-draft', value: command.trim() })}>
        加入对话草稿
      </FullButton>
    </>
  );
}

export function ConsoleSheet(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <>
      <pre className="terminal">
        {
          '[09:37:02] Page loaded\n[09:37:03] Host connected\n[09:37:03] Session restored\n\n0 errors · 0 warnings'
        }
      </pre>
      <p>示例控制台快照。</p>
      <FullButton variant="secondary" onClick={() => dispatch({ type: 'close-sheet' })}>
        关闭
      </FullButton>
    </>
  );
}

export function ArtifactSourceSheet(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <>
      <pre className="terminal">
        {
          '<article>\n  <h1>一份安静的记忆</h1>\n  <p>会话内容交给 Host。</p>\n  <p>阅读位置留在设备。</p>\n</article>'
        }
      </pre>
      <FullButton variant="secondary" onClick={() => dispatch({ type: 'close-sheet' })}>
        回到画布
      </FullButton>
    </>
  );
}

export function CardOptionsSheet(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <>
      <ListRow
        name="cards"
        title="计划复习"
        subtitle="翻面后给出四档评分"
        onClick={() => dispatch({ type: 'set-study-mode', mode: 'review' })}
      />
      <ListRow
        name="cards"
        title="随便看看"
        subtitle="只翻阅，不产生复习评分"
        onClick={() => dispatch({ type: 'set-study-mode', mode: 'browse' })}
      />
      <ListRow
        name="plus"
        title="从项目文件出卡"
        subtitle="保留桌面的产卡流程"
        onClick={() => dispatch({ type: 'open-sheet', key: 'produce-cards' })}
      />
    </>
  );
}

export function ProduceCardsSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  const [source, setSource] = useState('docs/adr');
  const [topic, setTopic] = useState('Host 边界、会话恢复和移动端职责。');
  const [running, setRunning] = useState(false);
  if (hostCtx !== null) {
    const project = hostCtx.host.projects.find((item) => item.path !== undefined);
    const folderPath = project?.path;
    const generate = async () => {
      const client = hostCtx.host.client;
      if (client === undefined || folderPath === undefined) return;
      setRunning(true);
      try {
        const response = await client.request({
          type: 'doccards/generate',
          folderPath,
          ...(topic.trim() ? { topic: topic.trim() } : {}),
          density: 'standard',
        });
        if (response.success) {
          dispatch({ type: 'close-sheet' });
          dispatch({ type: 'toast', message: 'Host 已开始生成闪卡，可在卡片工作台查看进度' });
        } else {
          dispatch({ type: 'toast', message: response.error });
        }
      } catch (error) {
        dispatch({ type: 'toast', message: error instanceof Error ? error.message : 'Host 出卡请求失败' });
      } finally {
        setRunning(false);
      }
    };
    return (
      <>
        <p>{folderPath === undefined ? 'Host 尚未返回可用项目路径。' : `来源：${folderPath}`}</p>
        <label className="field">
          出卡方向
          <textarea value={topic} onChange={(event) => setTopic(event.target.value)} />
        </label>
        <FullButton onClick={() => void generate()} disabled={running || folderPath === undefined}>
          {running ? 'Host 生成中…' : '请求 Host 生成闪卡'}
        </FullButton>
      </>
    );
  }
  return (
    <>
      <label className="field">
        来源文件夹
        <input
          value={source}
          onChange={(event) => setSource(event.target.value)}
          autoComplete="off"
        />
      </label>
      <label className="field">
        出卡方向
        <textarea value={topic} onChange={(event) => setTopic(event.target.value)} />
      </label>
      <FullButton onClick={() => dispatch({ type: 'produce-cards' })}>演示出卡完成</FullButton>
    </>
  );
}

export function AssetSheet(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <>
      <div className="empty-state" style={{ padding: 20 }}>
        <span className="brand-seal">砚</span>
        <h2>纸面外壳</h2>
        <p>类型占位 · 无真实媒体文件</p>
      </div>
      <Facts
        items={[
          ['尺寸', '1440 × 900'],
          ['提示词', '暖纸、朱印与一块深色砚台。'],
          ['来源', 'Inkstone · 桌面主题'],
        ]}
      />
      <FullButton onClick={() => dispatch({ type: 'add-context', value: '纸面外壳 · 示例图片' })}>
        引用到会话
      </FullButton>
      <FullButton
        variant="secondary"
        onClick={() => dispatch({ type: 'save-demo', values: {}, message: '已收藏示例资料' })}
      >
        收藏这份资料
      </FullButton>
    </>
  );
}

export function MediaNewSheet(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <>
      <ListRow
        name="image"
        title="图片"
        subtitle="在会话中写下画面描述"
        onClick={() =>
          dispatch({ type: 'media-prompt', value: '请生成一张 Inkstone 风格的图片。' })
        }
      />
      <ListRow
        name="file"
        title="视频"
        subtitle="在会话中描述镜头与时长"
        onClick={() =>
          dispatch({ type: 'media-prompt', value: '请生成一段展示 Inkstone 界面的短视频。' })
        }
      />
    </>
  );
}
