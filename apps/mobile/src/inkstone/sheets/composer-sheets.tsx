import { useEffect, useRef, useState, type ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../inkstone-state.js';
import type { HostResponse, SessionContextSnapshot, ThinkingLevel } from '@piwin/contracts';
import { contextPercent } from '../host/use-session-live-state.js';
import { Dot, FullButton, ListRow, Pill, SectionLabel } from '../inkstone-ui.js';
import { useInkstoneHost } from '../host/inkstone-host-context.js';
import { mobileLiveCapabilities } from '../../hooks/use-mobile-live.js';
import { AppleHealthAttachRow } from './apple-health-attach-row.js';

/** Curated thinking levels shown in the prototype's 轻量 / 标准 / 深入 grammar. */
const EFFORT_LEVELS: [string, ThinkingLevel][] = [
  ['轻量', 'minimal'],
  ['标准', 'medium'],
  ['深入', 'high'],
];

function RealModelSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <></>;
  }
  const { host, modelSelection } = hostCtx;
  return (
    <>
      <p>为接下来的一轮选择模型。历史消息保留生成时的模型。</p>
      {host.configuredModels.map((model) => {
        const selected =
          model.providerId === modelSelection.providerId &&
          model.modelId === modelSelection.modelId;
        return (
          <ListRow
            key={`${model.providerId}:${model.modelId}`}
            name="bulb"
            title={model.label?.trim() || model.modelId}
            subtitle={model.providerId}
            onClick={() => modelSelection.select(model.providerId, model.modelId)}
            trailing={selected ? '✓' : undefined}
            selected={selected}
          />
        );
      })}
      {host.configuredModels.length === 0 ? <p className="muted">Host 尚未配置可用模型。</p> : null}
      <SectionLabel>思考强度</SectionLabel>
      <div className="radio-options">
        {EFFORT_LEVELS.map(([label, value]) => (
          <button
            key={value}
            aria-pressed={modelSelection.thinkingLevel === value}
            onClick={() => modelSelection.selectThinking(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <FullButton onClick={() => dispatch({ type: 'close-sheet' })}>完成</FullButton>
    </>
  );
}

export function ModelSheet(): ReactElement {
  if (useInkstoneHost() === null) {
    return <NeedsHost />;
  }
  return <RealModelSheet />;
}

export function ModeSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <RealModeSheet hostCtx={hostCtx} />;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readHostPermissionPreset(response: HostResponse): string | undefined {
  if (!response.success || !isRecord(response.data) || !isRecord(response.data.snapshot)) {
    return undefined;
  }
  const config = response.data.snapshot.config;
  if (!isRecord(config) || !isRecord(config.permissions)) return undefined;
  const permissions = config.permissions;
  if (permissions.preset === 'ask' || permissions.preset === 'auto' || permissions.preset === 'yolo') {
    return permissions.preset;
  }
  if (permissions.mode === 'ask-all') return 'ask';
  if (permissions.mode === 'auto') return 'auto';
  if (permissions.mode === 'bypass') return 'yolo';
  return undefined;
}

function RealModeSheet({
  hostCtx,
}: {
  hostCtx: import('../host/inkstone-host-context.js').InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const client = host.client;
  const [preset, setPreset] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    if (client === undefined || !client.supportsCommand('settings/get')) return;
    let active = true;
    void client.request({ type: 'settings/get' }).then((response) => {
      if (!active) return;
      setPreset(readHostPermissionPreset(response));
      setError(response.success ? undefined : response.error);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '读取 Host 权限模式失败。');
    });
    return () => { active = false; };
  }, [client]);
  return (
    <>
      <SectionLabel>Host 权限模式</SectionLabel>
      {client === undefined ? <p className="muted">正在连接 Host…</p> : null}
      {error !== undefined ? <p className="error-text">{error}</p> : null}
      <Pill variant={preset === 'yolo' ? 'zhu' : 'azure'}>{preset ?? '由 Host 决定'}</Pill>
      <p>执行权限、沙箱和批准规则均由 Host 决定。移动端不复制或绕过这套策略。</p>
      <SectionLabel>编排状态</SectionLabel>
      <Pill>{host.hostStatus?.mode ?? 'Host 尚未返回模式'}</Pill>
      <FullButton onClick={() => dispatch({ type: 'close-sheet' })}>完成</FullButton>
    </>
  );
}

export function SchemeSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <RealSchemeSheet hostCtx={hostCtx} />;
}

function RealSchemeSheet({
  hostCtx,
}: {
  hostCtx: import('../host/inkstone-host-context.js').InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const children = host.sessions.filter((session) => session.parentSessionId === host.activeSessionId);
  const running = children.filter((session) => session.subagentStatus === 'running').length;
  const openChild = async (sessionId: string): Promise<void> => {
    await host.handleSelectSession(sessionId);
    dispatch({ type: 'close-sheet' });
    dispatch({ type: 'navigate', route: 'chat' });
  };
  return (
    <>
      <p>子代理职责、模型和工作树由 Host 返回；手机不创建本地编排状态。</p>
      <div className="notice"><Dot status={running > 0 ? 'running' : 'done'} /><b>{running} 个子代理运行中</b><span>{children.length} 个子会话</span></div>
      {children.map((child) => <ListRow key={child.sessionId} name="fork" title={child.name?.trim() || child.task?.trim() || 'Host 子会话'} subtitle={`${child.subagentRole ?? '子代理'} · ${child.subagentStatus ?? '未知'}`} onClick={() => void openChild(child.sessionId)} />)}
      {children.length === 0 ? <p className="muted">Host 尚未返回当前会话的子代理。</p> : null}
      <FullButton variant="secondary" onClick={() => { dispatch({ type: 'close-sheet' }); dispatch({ type: 'navigate', route: 'tasks' }); }}>打开 Host 任务页</FullButton>
    </>
  );
}

export function AttachSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <RealAttachSheet hostCtx={hostCtx} />;
}

function RealAttachSheet({
  hostCtx,
}: {
  hostCtx: import('../host/inkstone-host-context.js').InkstoneHostContextValue;
}): ReactElement {
  const { state, dispatch } = useInkstone();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { host } = hostCtx;
  // Uploads and file references attach to a Host session; a draft has none yet.
  const inDraft = state.draft !== null || host.activeSessionId === undefined;
  return (
    <>
      <AppleHealthAttachRow hostCtx={hostCtx} />
      {inDraft ? (
        <p className="muted">照片、文件引用和技能在发出第一句后可用。</p>
      ) : (
        <>
          <input ref={inputRef} type="file" accept="image/*" hidden onChange={(event) => void host.handleFileSelected(event)} />
          <ListRow name="image" title="照片或截图" subtitle="上传到 Host 当前会话" onClick={() => inputRef.current?.click()} />
          <ListRow name="folder" title="@ 引用项目文件" subtitle="从 Host 项目目录选择" onClick={() => dispatch({ type: 'open-sheet', key: 'references' })} />
          <ListRow name="cards" title="技能" subtitle="读取 Host 已安装技能" onClick={() => dispatch({ type: 'open-sheet', key: 'skills' })} />
          <ListRow name="globe" title="MCP 工具" subtitle="工具在 Host 上执行" onClick={() => dispatch({ type: 'settings-section', section: '技能与扩展' })} />
          <ListRow name="term" title="/ 命令" subtitle="作为文本请求发送给 Host" onClick={() => dispatch({ type: 'open-sheet', key: 'commands' })} />
        </>
      )}
    </>
  );
}

export function ReferencesSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <RealReferencesSheet hostCtx={hostCtx} />;
}

function RealReferencesSheet({
  hostCtx,
}: {
  hostCtx: import('../host/inkstone-host-context.js').InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const client = host.client;
  const projectId = host.sessions.find((session) => session.sessionId === host.activeSessionId)?.projectId;
  const project = host.projects.find((item) => item.projectId === projectId);
  const [relativePath, setRelativePath] = useState('');
  const [entries, setEntries] = useState<Array<{ name: string; relativePath: string; kind: 'file' | 'directory' }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    setEntries([]);
    setError(undefined);
    if (client === undefined || projectId === undefined) return () => { active = false; };
    if (!client.supportsCommand('project/list-dir')) {
      setError('当前 Host 未开放项目文件浏览。');
      return () => { active = false; };
    }
    setLoading(true);
    void client.request({
      type: 'project/list-dir',
      projectPath: projectId,
      ...(relativePath ? { relativePath } : {}),
    }).then((response) => {
      if (!active) return;
      if (!response.success || !isRecord(response.data) || !Array.isArray(response.data.entries)) {
        setError(response.success ? 'Host 返回了无法识别的目录数据。' : response.error);
        return;
      }
      setEntries(response.data.entries.flatMap((value): Array<{ name: string; relativePath: string; kind: 'file' | 'directory' }> => {
        if (!isRecord(value) || typeof value.name !== 'string' || typeof value.relativePath !== 'string' || (value.kind !== 'file' && value.kind !== 'directory')) return [];
        return [{ name: value.name, relativePath: value.relativePath, kind: value.kind }];
      }));
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '读取 Host 项目目录失败。');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [client, projectId, relativePath]);

  const appendReference = (path: string): void => {
    const normalized = path.trim();
    if (!normalized) return;
    const existing = host.composerText.trim();
    host.setComposerText(existing.length > 0 ? `${existing} @${normalized}` : `@${normalized}`);
    dispatch({ type: 'close-sheet' });
  };
  return (
    <>
      <p className="muted">文件内容由 Host 校验；选择后只把安全的相对路径加入当前输入。</p>
      {project === undefined ? <p className="muted">当前会话没有绑定 Host 项目。</p> : null}
      {project !== undefined ? <p className="eyebrow">{project.displayName}{relativePath ? ` · ${relativePath}` : ''}</p> : null}
      {relativePath ? <FullButton variant="subtle" onClick={() => setRelativePath(relativePath.split('/').slice(0, -1).join('/'))}>返回上一级目录</FullButton> : null}
      {loading ? <p className="muted">正在读取 Host 目录…</p> : null}
      {error !== undefined ? <p className="error-text">{error}</p> : null}
      {!loading && error === undefined && project !== undefined && entries.length === 0 ? <p className="muted">这个目录没有可引用的条目。</p> : null}
      {entries.map((entry) => (
        <ListRow
          key={entry.relativePath}
          name={entry.kind === 'directory' ? 'folder' : 'file'}
          title={entry.name}
          subtitle={entry.kind === 'directory' ? '目录' : '@' + entry.relativePath}
          onClick={() => entry.kind === 'directory' ? setRelativePath(entry.relativePath) : appendReference(entry.relativePath)}
        />
      ))}
      <FullButton variant="secondary" onClick={() => dispatch({ type: 'close-sheet' })}>关闭</FullButton>
    </>
  );
}

export function SkillsSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <RealSkillsSheet hostCtx={hostCtx} />;
}

function RealSkillsSheet({
  hostCtx,
}: {
  hostCtx: import('../host/inkstone-host-context.js').InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const [skills, setSkills] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    const client = host.client;
    if (client === undefined || !client.supportsCommand('skills/store-list')) return;
    let active = true;
    void client.request({ type: 'skills/store-list' }).then((response) => {
      if (!active) return;
      if (!response.success || !isRecord(response.data) || !Array.isArray(response.data.skills)) {
        setError(response.success ? 'Host 返回的技能目录无法识别。' : response.error);
        return;
      }
      setSkills(response.data.skills.flatMap((value) => {
        if (!isRecord(value)) return [];
        return typeof value.id === 'string' ? [value.id] : typeof value.name === 'string' ? [value.name] : [];
      }));
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '读取 Host 技能失败。'); });
    return () => { active = false; };
  }, [host.client]);
  return (
    <>
      <p>技能在 Host 中加载，手机只选择要带入下一轮的名称。</p>
      {error !== undefined ? <p className="error-text">{error}</p> : null}
      {skills.map((skill) => <ListRow key={skill} name="cards" title={skill} subtitle="Host 技能" onClick={() => { host.setComposerText(`${host.composerText}${host.composerText ? ' ' : ''}/skill ${skill}`); dispatch({ type: 'close-sheet' }); }} />)}
      {skills.length === 0 && error === undefined ? <p className="muted">Host 尚未返回已安装技能。</p> : null}
      <FullButton variant="secondary" onClick={() => dispatch({ type: 'close-sheet' })}>关闭</FullButton>
    </>
  );
}

export function CommandsSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  /** Puts the words in the Host composer; sending stays an explicit tap. */
  const draft = (text: string) => () => {
    hostCtx?.host.setComposerText(text);
    dispatch({ type: 'close-sheet' });
  };
  return (
    <>
      <ListRow
        name="cards"
        title="/plan"
        subtitle="先写计划，再决定怎么执行"
        onClick={draft('先整理一份计划，暂时不要修改文件。')}
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
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <RealContextSheet hostCtx={hostCtx} />;
}

/** Host-measured occupancy only; the phone never estimates a context size. */
function describeContextSnapshot(snapshot: SessionContextSnapshot): string {
  const occupancy = snapshot.occupancy;
  if (occupancy?.kind !== 'known') {
    return `Host 上下文\n占用：尚未测量（${occupancy?.reason ?? '未知'}）`;
  }
  const percent = contextPercent(snapshot);
  const limit = occupancy.tokensLimit;
  return [
    'Host 上下文',
    `占用：${percent === undefined ? '—' : `${percent}%`}`,
    `Token：${occupancy.tokensUsed.toLocaleString()}${limit === undefined ? '' : ` / ${limit.toLocaleString()}`}`,
    `口径：${occupancy.quality === 'measured' ? '实测' : '估算'}${occupancy.coverage === 'partial' ? ' · 部分' : ''}`,
  ].join('\n');
}

function RealContextSheet({
  hostCtx,
}: {
  hostCtx: import('../host/inkstone-host-context.js').InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const client = host.client;
  const sessionId = host.activeSessionId;
  const [summary, setSummary] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    if (client === undefined || sessionId === undefined || !client.supportsCommand('session/context-get')) return;
    let active = true;
    void client.request({ type: 'session/context-get', sessionId }).then((response) => {
      if (!active) return;
      if (!response.success || !isRecord(response.data)) {
        setError(response.success ? 'Host 返回的上下文数据无法识别。' : response.error);
        return;
      }
      setSummary(describeContextSnapshot(response.data as unknown as SessionContextSnapshot));
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '读取 Host 上下文失败。'); });
    return () => { active = false; };
  }, [client, sessionId]);
  return (
    <>
      {client === undefined || sessionId === undefined ? <p className="muted">正在等待 Host 会话…</p> : null}
      {client !== undefined && sessionId !== undefined && !client.supportsCommand('session/context-get') ? <p className="muted">当前 Host 未开放上下文读取。</p> : null}
      {error !== undefined ? <p className="error-text">{error}</p> : null}
      {summary !== undefined ? <pre className="command">{summary}</pre> : null}
      <p className="muted">上下文条目和占用由 Host 计算，移动端不展示固定估算。</p>
      <FullButton variant="secondary" onClick={() => dispatch({ type: 'close-sheet' })}>关闭</FullButton>
    </>
  );
}

export function DictationSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <RealDictationSheet hostCtx={hostCtx} />;
}

function RealDictationSheet({
  hostCtx,
}: {
  hostCtx: import('../host/inkstone-host-context.js').InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const [text, setText] = useState('');
  const { host } = hostCtx;
  return (
    <>
      <p>语音识别由设备能力提供；识别结果确认后会放入当前 Host 会话。</p>
      <label className="field">
        识别文字
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="也可以直接输入要发送的文字" />
      </label>
      <FullButton onClick={() => { host.setComposerText(text.trim()); dispatch({ type: 'close-sheet' }); }} disabled={text.trim().length === 0}>放入当前输入</FullButton>
      <FullButton variant="secondary" onClick={() => dispatch({ type: 'navigate', route: 'voice' })}>进入 Host Live</FullButton>
    </>
  );
}

export function VoiceSettingsSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <RealVoiceSettingsSheet hostCtx={hostCtx} />;
}

function RealVoiceSettingsSheet({
  hostCtx,
}: {
  hostCtx: import('../host/inkstone-host-context.js').InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const client = hostCtx.host.client;
  const [status, setStatus] = useState<string | undefined>();
  useEffect(() => {
    if (client === undefined || !client.supportsCommand('voice/live/status')) return;
    let active = true;
      void client.request({ type: 'voice/live/status', input: { capabilities: mobileLiveCapabilities() } }).then((response) => {
      if (!active) return;
      if (!response.success || !isRecord(response.data)) {
        setStatus(response.success ? 'Host 返回的 Live 状态无法识别。' : response.error);
        return;
      }
      const provider = typeof response.data.selectedProviderId === 'string' ? response.data.selectedProviderId : '未选择';
      const ready = response.data.ready === true ? '已就绪' : '未就绪';
      setStatus(`${ready} · ${provider}`);
    }).catch((reason: unknown) => { if (active) setStatus(reason instanceof Error ? reason.message : '读取 Live 设置失败。'); });
    return () => { active = false; };
  }, [client]);
  return (
    <>
      <p>Live 渠道与凭据由 Host 管理，移动端只读取状态并发起通话。</p>
      <ListRow name="mic" title="Live 渠道" subtitle={status ?? (client === undefined ? '正在连接 Host…' : '正在读取 Host 状态…')} />
      <FullButton onClick={() => dispatch({ type: 'close-sheet' })}>完成</FullButton>
    </>
  );
}
