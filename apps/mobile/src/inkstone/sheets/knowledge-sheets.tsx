import { useEffect, useState, type ReactElement } from 'react';
import type {
  KnowledgeBaseSummary,
  KnowledgeCitation,
  SessionPlan,
  WikiConceptDetail,
} from '@piwin/contracts';
import { useInkstone } from '../inkstone-context.js';
import { Icon } from '../icons.js';
import { useInkstoneHost } from '../host/inkstone-host-context.js';
import { FullButton, ListRow, Pill } from '../inkstone-ui.js';
import { WIKI_KNOWLEDGE_BASE_ID } from '@piwin/contracts';
import { MobileMarkdown } from '../../components/chat/MobileMarkdown.js';

function formatBaseState(base: KnowledgeBaseSummary): string {
  const state: Record<string, string> = {
    empty: '空',
    missing: '路径不存在',
    'not-indexed': '未索引',
    indexing: '索引中',
    ready: '可用',
    partial: '部分可用',
  };
  return `${state[base.state] ?? base.state} · ${base.documentCount} 项`;
}

function readPlan(value: unknown): SessionPlan | undefined {
  if (typeof value !== 'object' || value === null || !('plan' in value)) return undefined;
  const plan = (value as { plan?: unknown }).plan;
  if (typeof plan !== 'object' || plan === null) return undefined;
  const candidate = plan as Partial<SessionPlan>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.sessionId !== 'string' ||
    typeof candidate.title !== 'string' ||
    typeof candidate.goal !== 'string' ||
    !Array.isArray(candidate.steps)
  ) {
    return undefined;
  }
  return candidate as SessionPlan;
}

export function PlanMenuSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  const [plan, setPlan] = useState<SessionPlan | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const host = hostCtx?.host;
  const sessionId = host?.activeSessionId;

  useEffect(() => {
    if (host === undefined || sessionId === undefined || host.client === undefined) return;
    let active = true;
    setLoading(true);
    void host.client
      .request({ type: 'plan/get', sessionId })
      .then((response) => {
        if (!active) return;
        if (!response.success) {
          setError(response.error);
          return;
        }
        setPlan(readPlan(response.data));
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '读取计划失败。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [host?.client, sessionId]);

  if (hostCtx === null) {
    return (
      <>
        <p>计划是 Host 上的真实文档，执行前会再次校验版本。</p>
        <FullButton onClick={() => dispatch({ type: 'navigate', route: 'plan' })}>查看演示计划</FullButton>
      </>
    );
  }
  if (sessionId === undefined) {
    return <p>当前没有选中的 Host 会话。</p>;
  }
  if (loading) return <p>正在从 Host 读取计划…</p>;
  if (error !== undefined) {
    return (
      <>
        <p className="error-text">{error}</p>
        <FullButton variant="secondary" onClick={() => dispatch({ type: 'close-sheet' })}>关闭</FullButton>
      </>
    );
  }
  return (
    <>
      {plan === undefined ? (
        <p>Host 尚未为当前会话创建计划。</p>
      ) : (
        <>
          <Pill>{plan.status} · {plan.steps.length} 步</Pill>
          <h3>{plan.title}</h3>
          <p>{plan.goal}</p>
          <div className="tool-thread">
            {plan.steps.map((step) => (
              <div className="tool-step" key={step.id}>
                <span className={`step-dot ${step.status}`} />
                <span>{step.title}</span>
                <small>{step.status}</small>
              </div>
            ))}
          </div>
        </>
      )}
      <FullButton onClick={() => dispatch({ type: 'navigate', route: 'plan' })}>打开计划页</FullButton>
    </>
  );
}

export function MountsSheet(): ReactElement {
  const { state, dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  const host = hostCtx?.host;
  const session = host?.sessions.find((item) => item.sessionId === host.activeSessionId);
  const [selected, setSelected] = useState<string[]>(session?.knowledgeBaseIds ?? []);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(session?.knowledgeBaseIds ?? []);
  }, [session?.sessionId, session?.knowledgeBaseIds?.join(',')]);

  if (hostCtx === null) {
    return (
      <>
        <p>演示会话中的挂载仅用于预览。连接 Host 后这里会替换为真实知识库。</p>
        {state.mounts.map((mount) => <ListRow key={mount} name="book" title={mount} trailing="已挂载" />)}
      </>
    );
  }
  const bases = host?.knowledgeBases ?? [];
  const toggle = (id: string) =>
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const save = async () => {
    if (host === undefined || host.activeSessionId === undefined) return;
    setSaving(true);
    const ok = await host.handleSetSessionKnowledgeBases(host.activeSessionId, selected);
    setSaving(false);
    if (ok) {
      dispatch({ type: 'close-sheet' });
      dispatch({ type: 'toast', message: '会话知识库挂载已同步到 Host' });
    }
  };
  return (
    <>
      {bases.length === 0 ? <p>Host 尚未返回知识库，或当前 Host 不支持知识库挂载。</p> : null}
      {bases.map((base) => (
        <ListRow
          key={base.id}
          name="book"
          title={base.name}
          subtitle={formatBaseState(base)}
          selected={selected.includes(base.id)}
          trailing={selected.includes(base.id) ? '✓' : undefined}
          onClick={() => toggle(base.id)}
        />
      ))}
      <FullButton onClick={() => void save()} disabled={saving || host?.activeSessionId === undefined}>
        {saving ? '正在同步…' : '保存当前会话挂载'}
      </FullButton>
    </>
  );
}

export function KnowledgeSearchSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KnowledgeCitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  if (hostCtx === null) {
    return (
      <>
        <p>连接 Host 后可搜索全部已索引信源。</p>
        <FullButton variant="secondary" onClick={() => dispatch({ type: 'close-sheet' })}>关闭</FullButton>
      </>
    );
  }
  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    const result = await hostCtx.host.handleKnowledgeSearch(query);
    setResults(result.citations);
    setLoading(false);
  };
  return (
    <>
      <label className="field">
        搜索内容
        <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search(); }} autoComplete="off" />
      </label>
      <FullButton onClick={() => void search()} disabled={loading || query.trim().length === 0}>{loading ? '搜索中…' : '搜索 Host 知识库'}</FullButton>
      {searched && !loading && results.length === 0 ? <p>没有匹配的 Host 内容。</p> : null}
      {results.map((citation) => (
        <ListRow
          key={`${citation.baseId}:${citation.ref}`}
          name="book"
          title={`${citation.ref}. ${citation.title}`}
          subtitle={`${citation.baseName} · ${citation.text.slice(0, 72)}`}
          onClick={() => void hostCtx.host.handleOpenKnowledgeSource(citation).then((ok) => { if (ok) dispatch({ type: 'toast', message: '已在 Host 校验该来源' }); })}
        />
      ))}
    </>
  );
}

export function WikiNewSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  const [baseId, setBaseId] = useState('');
  const [topic, setTopic] = useState('');
  const [saving, setSaving] = useState(false);
  if (hostCtx === null) {
    return <FullButton onClick={() => dispatch({ type: 'produce-cards' })}>在演示中生成条目</FullButton>;
  }
  const folderBases = hostCtx.host.knowledgeBases.filter((base) => base.kind === 'folder' && base.folderPath !== undefined);
  const submit = async () => {
    if (!baseId) return;
    setSaving(true);
    const concept = await hostCtx.host.handleDistillWiki(baseId, topic);
    setSaving(false);
    if (concept !== undefined) {
      dispatch({ type: 'close-sheet' });
      dispatch({ type: 'open-wiki', wikiId: concept.slug });
      dispatch({ type: 'toast', message: `已由 Host 写入「${concept.title}」` });
    }
  };
  return (
    <>
      <label className="field">
        来源知识库
        <select value={baseId} onChange={(event) => setBaseId(event.target.value)}>
          <option value="">请选择已索引文件夹</option>
          {folderBases.map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}
        </select>
      </label>
      <label className="field">
        提炼主题（可选）
        <input value={topic} onChange={(event) => setTopic(event.target.value)} autoComplete="off" />
      </label>
      <FullButton onClick={() => void submit()} disabled={saving || baseId.length === 0}>{saving ? 'Host 提炼中…' : '让 Host 提炼并写入维基'}</FullButton>
    </>
  );
}

export function SourceDetailSheet(): ReactElement {
  const { state, dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  const base = hostCtx?.host.knowledgeBases.find((item) => item.id === state.knowledgeBaseId);
  if (hostCtx === null || base === undefined) {
    return <p>来源详情会在 Host 连接后显示真实索引状态。</p>;
  }
  return (
    <>
      <Pill>{base.kind} · {formatBaseState(base)}</Pill>
      <h3>{base.name}</h3>
      <p>{base.folderPath ?? 'Host 内置知识库'}</p>
      {base.lastIndexedAt ? <p className="muted">最近索引：{new Date(base.lastIndexedAt).toLocaleString()}</p> : null}
      {base.failedDocumentCount ? <p className="error-text">{base.failedDocumentCount} 个文件索引失败</p> : null}
      <FullButton onClick={() => { dispatch({ type: 'set-knowledge-tab', tab: '维基' }); dispatch({ type: 'close-sheet' }); }}>返回知识中心</FullButton>
    </>
  );
}

export function WikiMenuSheet(): ReactElement {
  const { state, dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  const mount = async () => {
    const host = hostCtx?.host;
    if (host?.activeSessionId === undefined) return;
    const session = host.sessions.find((item) => item.sessionId === host.activeSessionId);
    const ids = [...new Set([...(session?.knowledgeBaseIds ?? []), WIKI_KNOWLEDGE_BASE_ID])];
    if (await host.handleSetSessionKnowledgeBases(host.activeSessionId, ids)) {
      dispatch({ type: 'close-sheet' });
      dispatch({ type: 'toast', message: '本文已挂载到当前 Host 会话' });
    }
  };
  return (
    <>
      <ListRow name="book" title="加入当前会话上下文" subtitle="由 Host 持久化挂载 wiki" onClick={() => void mount()} />
      <ListRow name="copy" title="复制词条标题" onClick={() => { void navigator.clipboard?.writeText(state.wiki); dispatch({ type: 'close-sheet' }); }} />
      <FullButton variant="secondary" onClick={() => dispatch({ type: 'close-sheet' })}>关闭</FullButton>
    </>
  );
}

export function WikiConceptContent({ concept }: { concept: WikiConceptDetail }): ReactElement {
  return (
    <article className="assistant-prose" style={{ margin: '16px 0' }}>
      <h3>{concept.title}</h3>
      {concept.summary ? <p>{concept.summary}</p> : null}
      <MobileMarkdown content={concept.content} />
      {concept.tags.length > 0 ? <small>{concept.tags.join(' · ')}</small> : null}
    </article>
  );
}

export function KnowledgeBaseEmpty({ message }: { message: string }): ReactElement {
  return <div className="empty-state"><Icon name="book" /><p>{message}</p></div>;
}
