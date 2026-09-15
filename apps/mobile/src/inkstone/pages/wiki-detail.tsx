import { useEffect, useState, type ReactElement } from 'react';
import { WIKI_KNOWLEDGE_BASE_ID } from '@piwin/contracts';
import { useInkstone } from '../inkstone-context.js';
import { Icon } from '../icons.js';
import { IconButton, ListRow, TopBar } from '../inkstone-ui.js';
import { WIKI_ENTRIES } from './knowledge.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { readWikiConcept } from '../../mobile-host-readers.js';
import { WikiConceptContent } from '../sheets/knowledge-sheets.js';

const WIKI_CONTENT: Record<string, string> = {
  'host-authority':
    '<h3>Host 为什么是唯一权威？</h3><p>在 piwin 架构中，所有模型上下文、工具调用与会话历史都持久化在私有 Host 上。会话恢复边界指明设备只保留本地阅读刻度。</p><p>这保证了不论从桌面、手机或 CLI 接入，面对的都是同一份真实进度。</p>',
  'session-boundary':
    '<h3>会话恢复边界</h3><p>设备在弱网或断线状态下仍可输入草稿。重连后，客户端以幂等键向 Host 探活，先还原纸面，再由用户确认发出草稿。</p>',
  'fsrs-study':
    '<h3>FSRS 算法集成</h3><p>基于 Free Spaced Repetition Scheduler，每次评分（重来、较难、记得、轻松）实时预估下次复习间隔，并在 Host 上更新卡片记忆矩阵。</p>',
  'artifact-sandbox':
    '<h3>Artifact 沙箱隔离</h3><p>所有生成的网页、图表和交互卡片均运行在无特权子域。防止未受信模型输出注入脚本或泄露本地凭据。</p>',
};

export function WikiDetailPage(): ReactElement {
  const { state, dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  if (hostCtx !== null) {
    return <ConnectedWikiDetailPage hostCtx={hostCtx} />;
  }
  const entry = WIKI_ENTRIES.find((e) => e.id === state.wiki) ?? WIKI_ENTRIES[0]!;

  return (
    <>
      <TopBar
        title={entry.title}
        subtitle={`${entry.cat} · 词条`}
        onBack={() => dispatch({ type: 'navigate', route: 'knowledge' })}
        right={
          <IconButton
            name="more"
            label="操作"
            onClick={() => dispatch({ type: 'open-sheet', key: 'wiki-menu' })}
          />
        }
      />
      <div className="screen-scroll">
        <div className="notice">
          <Icon name="book" />
          <span>已挂载至当前会话 · 回复中可角标引用</span>
        </div>
        <article
          className="assistant-prose"
          style={{ margin: '16px 0' }}
          dangerouslySetInnerHTML={{
            __html: WIKI_CONTENT[entry.id] ?? '<p>条目内容正在由 Host 整理中。</p>',
          }}
        />
        <div className="section-label">相关知识</div>
        <ListRow
          name="book"
          title="会话恢复边界"
          subtitle="架构 · 2 处相互引用"
          onClick={() => dispatch({ type: 'open-wiki', wikiId: 'session-boundary' })}
        />
        <button
          className="full-button"
          onClick={() => dispatch({ type: 'toast', message: `演示：已将「${entry.title}」加入砚台上下文` })}
          type="button"
        >
          把本文加入砚台上下文
        </button>
        <button
          className="full-button secondary"
          onClick={() => dispatch({ type: 'open-sheet', key: 'produce-cards' })}
          type="button"
        >
          基于本文出卡
        </button>
      </div>
    </>
  );
}

function ConnectedWikiDetailPage({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { state, dispatch } = useInkstone();
  const { host } = hostCtx;
  const [concept, setConcept] = useState<import('@piwin/contracts').WikiConceptDetail | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const session = host.sessions.find((item) => item.sessionId === host.activeSessionId);
  const mounted = session?.knowledgeBaseIds?.includes(WIKI_KNOWLEDGE_BASE_ID) === true;

  useEffect(() => {
    const client = host.client;
    if (client === undefined || state.wiki.trim().length === 0) return;
    let active = true;
    setLoading(true);
    void client.request({ type: 'knowledge/wiki/concept', slug: state.wiki })
      .then((response) => {
        if (!active) return;
        const next = readWikiConcept(response);
        if (next === undefined) {
          setError(response.success ? 'Host 返回的词条格式无法识别。' : response.error);
        } else {
          setConcept(next);
          setError(undefined);
        }
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '读取词条失败。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [host.client, state.wiki]);

  const mount = async () => {
    if (host.activeSessionId === undefined) return;
    const ids = [...new Set([...(session?.knowledgeBaseIds ?? []), WIKI_KNOWLEDGE_BASE_ID])];
    const ok = await host.handleSetSessionKnowledgeBases(host.activeSessionId, ids);
    if (ok) dispatch({ type: 'toast', message: '本文已挂载到当前 Host 会话' });
  };
  const title = concept?.title ?? state.wiki;
  return (
    <>
      <TopBar title={title} subtitle="Host 维基 · 词条" onBack={() => dispatch({ type: 'navigate', route: 'knowledge' })} right={<IconButton name="more" label="操作" onClick={() => dispatch({ type: 'open-sheet', key: 'wiki-menu' })} />} />
      <div className="screen-scroll">
        <div className="notice"><Icon name="book" /><span>{mounted ? '已挂载至当前会话 · 回复中可角标引用' : '尚未挂载到当前会话'}</span></div>
        {loading ? <div className="empty-state"><p>正在从 Host 读取词条…</p></div> : null}
        {error ? <div className="notice"><Icon name="alert" />{error}</div> : null}
        {concept ? <WikiConceptContent concept={concept} /> : null}
        {!loading && concept === undefined && error === undefined ? <div className="empty-state"><p>Host 尚未返回此词条。</p></div> : null}
        {concept?.links?.length ? (
          <>
            <div className="section-label">相关知识</div>
            {concept.links.map((link) => <ListRow key={link} name="book" title={link} onClick={() => dispatch({ type: 'open-wiki', wikiId: link })} />)}
          </>
        ) : null}
        <button className="full-button" onClick={() => void mount()} disabled={mounted || host.activeSessionId === undefined} type="button">{mounted ? '已加入当前会话上下文' : '把本文加入砚台上下文'}</button>
        <button className="full-button secondary" onClick={() => dispatch({ type: 'open-sheet', key: 'produce-cards' })} type="button">基于本文出卡</button>
      </div>
    </>
  );
}
