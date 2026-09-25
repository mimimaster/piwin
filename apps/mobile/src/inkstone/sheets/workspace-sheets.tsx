import { useState, type ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import { useInkstone } from '../inkstone-context.js';
import { FullButton, ListRow } from '../inkstone-ui.js';
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

export function ProduceCardsSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  const [topic, setTopic] = useState('Host 边界、会话恢复和移动端职责。');
  const [running, setRunning] = useState(false);
  if (hostCtx === null) {
    return <NeedsHost />;
  }
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

