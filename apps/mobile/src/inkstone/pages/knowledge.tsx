import type { ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import type { KnowledgeBaseSummary } from '@piwin/contracts';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../inkstone-state.js';
import { Icon } from '../icons.js';
import {
  BottomNav,
  Chips,
  IconButton,
  ListRow,
  ScreenHeading,
  TabsRow,
  TopBar,
} from '../inkstone-ui.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { collectPendingPermissionSessionIds } from '../host/host-bridge.js';
import { KnowledgeBaseEmpty } from '../sheets/knowledge-sheets.js';

export interface WikiEntry {
  id: string;
  cat: string;
  title: string;
  date: string;
  text: string;
  tags: string[];
}

export const WIKI_ENTRIES: WikiEntry[] = [
  {
    id: 'host-authority',
    cat: '架构',
    title: 'Host 唯一权威',
    date: '09.12',
    text: '状态与执行只归 Host。桌面、手机和 CLI 皆为无状态窗口，正文共享但阅读位置独立。',
    tags: ['架构', '核心'],
  },
  {
    id: 'session-boundary',
    cat: '架构',
    title: '会话恢复边界',
    date: '09.10',
    text: '断线恢复时，优先保证设备草稿不丢，随后同步 Host 最新会话树，绝不重发旧命令。',
    tags: ['架构', '恢复'],
  },
  {
    id: 'fsrs-study',
    cat: '策略',
    title: 'FSRS 闪卡调度',
    date: '09.08',
    text: '四档遗忘曲线算法在 Host 执行。手机只负责呈现正反面并回传评分，不自建调度器。',
    tags: ['策略', '卡片'],
  },
  {
    id: 'artifact-sandbox',
    cat: '交互',
    title: 'Artifact 安全沙箱',
    date: '09.04',
    text: '生成式 HTML 严格置于沙箱 iframe 与 CSP 约束下，外部静态资源默认阻断。',
    tags: ['交互', '安全'],
  },
];

export function KnowledgePage(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedKnowledgePage hostCtx={hostCtx} />;
}

function baseDate(value: string | undefined): string {
  if (value === undefined) return '尚无索引';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '已索引' : date.toLocaleDateString();
}

function ConnectedKnowledgePage({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { state, dispatch } = useInkstone();
  const { host } = hostCtx;
  const pendingCount = collectPendingPermissionSessionIds(host.activityItems).size;
  const concepts = host.wikiOverview?.concepts ?? [];
  const categories = ['全部', ...new Set(concepts.flatMap((concept) => concept.tags))];
  const category = categories.includes(state.wikiCategory) ? state.wikiCategory : '全部';
  const filtered = category === '全部'
    ? concepts
    : concepts.filter((concept) => concept.tags.includes(category));
  const bases = host.knowledgeBases;
  const status = host.connectionState.kind === 'ready' ? '已连接 · Host 权威数据' : '正在恢复 Host 数据…';
  const baseIcon = (base: KnowledgeBaseSummary): 'book' | 'folder' => base.kind === 'folder' ? 'folder' : 'book';
  return (
    <>
      <TopBar
        title="知识中心"
        subtitle="维基、信源与闪卡"
        onBack={() => dispatch({ type: 'navigate', route: 'sessions' })}
        right={<IconButton name="search" label="搜索知识库" onClick={() => dispatch({ type: 'open-sheet', key: 'knowledge-search' })} />}
      />
      {host.connectionState.kind !== 'ready' ? (
        <div className="banner-offline"><span>{status}</span><button onClick={() => hostCtx.onOpenConnection()} type="button">管理连接</button></div>
      ) : null}
      <div className="screen-scroll">
        <ScreenHeading title="留下的，皆成学问。" subtitle={status} />
        <TabsRow items={['维基', '信源', '闪卡']} selected={state.knowledgeTab} onSelect={(tab) => dispatch({ type: 'set-knowledge-tab', tab: tab as '维基' | '信源' | '闪卡' })} />
        {state.knowledgeTab === '维基' ? (
          <>
            <Chips items={categories.map((item) => [item, item === '全部' ? concepts.length : concepts.filter((concept) => concept.tags.includes(item)).length] as [string, number])} selected={category} onSelect={(value) => dispatch({ type: 'set-wiki-category', category: value })} />
            {host.knowledgeError ? <div className="notice"><Icon name="alert" />{host.knowledgeError}</div> : null}
            {filtered.length === 0 ? <KnowledgeBaseEmpty message={host.wikiOverview === undefined ? '正在等待 Host 返回维基索引。' : 'Host 维基中还没有匹配条目。'} /> : null}
            <div className="wiki-list">
              {filtered.map((item) => (
                <button className="wiki-row" key={item.slug} onClick={() => dispatch({ type: 'open-wiki', wikiId: item.slug })} type="button">
                  <strong>{item.title}</strong>
                  <p>{item.summary ?? item.relativePath}</p>
                  <small>{item.tags.join(' · ') || '未分类'} · {baseDate(item.updatedAt)}</small>
                </button>
              ))}
            </div>
            <div className="section-label">知识操作</div>
            <ListRow name="book" title="从当前项目出卡" subtitle="请求 Host 扫描并生成卡片" onClick={() => dispatch({ type: 'open-sheet', key: 'produce-cards' })} />
            <ListRow name="plus" title="录入新维基条目" subtitle="由 Host 从已索引信源提炼" onClick={() => dispatch({ type: 'open-sheet', key: 'wiki-new' })} />
          </>
        ) : state.knowledgeTab === '信源' ? (
          <>
            <div className="notice"><Icon name="book" /><b>Host 信源</b><span>索引、解析与路径校验均在 Host 完成。</span></div>
            {bases.length === 0 ? <KnowledgeBaseEmpty message="Host 尚未返回知识库。" /> : null}
            {bases.map((base) => (
              <ListRow key={base.id} name={baseIcon(base)} title={base.name} subtitle={`${base.state} · ${base.documentCount} 项 · ${baseDate(base.lastIndexedAt)}`} onClick={() => dispatch({ type: 'open-sheet', key: 'mounts' })} trailing={base.degraded ? '全文' : '可用'} />
            ))}
            <div className="section-label">挂载与同步</div>
            <button className="full-button" onClick={() => dispatch({ type: 'open-sheet', key: 'mounts' })} type="button">管理当前会话挂载</button>
            <button className="full-button secondary" onClick={() => dispatch({ type: 'open-sheet', key: 'workspace-picker' })} type="button">添加外部文件夹</button>
          </>
        ) : (
          <>
            <div className="notice"><Icon name="cards" /><b>闪卡由 Host 管理</b><span>手机只展示与回传复习动作，不在本地重建调度器。</span></div>
            <ListRow name="cards" title="打开复习工作台" subtitle={host.hostStatus?.capabilities.flashcardStudy === true ? 'Host 已提供复习能力' : '当前 Host 未声明复习能力'} onClick={() => dispatch({ type: 'navigate', route: 'cards' })} />
          </>
        )}
      </div>
      <BottomNav selected="knowledge" inboxCount={pendingCount} onNavigate={(route) => dispatch({ type: 'navigate', route: route as InkstoneRoute })} />
    </>
  );
}
