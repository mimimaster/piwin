import { useEffect, useState, type ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import { WIKI_KNOWLEDGE_BASE_ID } from '@piwin/contracts';
import { useInkstone } from '../inkstone-context.js';
import { Icon } from '../icons.js';
import { IconButton, ListRow, TopBar } from '../inkstone-ui.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { readWikiConcept } from '../../mobile-host-readers.js';
import { WikiConceptContent } from '../sheets/knowledge-sheets.js';

export function WikiDetailPage(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedWikiDetailPage hostCtx={hostCtx} />;
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
