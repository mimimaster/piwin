import { useState, type ReactElement } from 'react';
import type { HookDefinition, McpServerHealth, SkillSummary } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { Dot, Facts, ListRow, SectionLabel, SwitchRow } from '../inkstone-ui.js';
import type { HostSettingsState } from './use-host-settings.js';
import { isObject, readArrayField, useHostQuery } from '../host/use-host-query.js';

const SKILLS_COMMAND = { type: 'skills/list' } as const;
const MCP_COMMAND = { type: 'mcp/status' } as const;
const HOOKS_COMMAND = { type: 'hooks/list' } as const;

const MCP_STATUS: Record<McpServerHealth['status'], { label: string; dot: 'done' | 'running' | 'failed' | '' }> = {
  running: { label: '运行中', dot: 'done' },
  starting: { label: '启动中', dot: 'running' },
  stopping: { label: '停止中', dot: 'running' },
  stopped: { label: '已停止', dot: '' },
  error: { label: '出错', dot: 'failed' },
  disabled: { label: '已禁用', dot: '' },
};

export function SkillsMcpSection({
  settings,
  client,
  onToast,
}: {
  settings: HostSettingsState;
  client: HostClient | undefined;
  onToast: (message: string) => void;
}): ReactElement {
  const skills = useHostQuery(client, SKILLS_COMMAND, readArrayField('skills', isSkill));
  const mcp = useHostQuery(client, MCP_COMMAND, readArrayField('servers', isMcpServer));
  const [busyServer, setBusyServer] = useState<string | undefined>();
  const skillsConfig = settings.snapshot?.config.skills;
  const disabled = new Set(skillsConfig?.disabledIds ?? []);

  const toggleSkill = (skill: SkillSummary): void => {
    if (skillsConfig === undefined) return;
    const next = new Set(disabled);
    if (next.has(skill.id)) next.delete(skill.id);
    else next.add(skill.id);
    void settings
      .apply('skills', { ...skillsConfig, disabledIds: [...next] })
      .then((error) => {
        onToast(error ?? (next.has(skill.id) ? `已停用 ${skill.name}` : `已启用 ${skill.name}`));
        skills.reload();
      });
  };

  const toggleServer = (server: McpServerHealth): void => {
    if (client === undefined) return;
    const running = server.status === 'running' || server.status === 'starting';
    setBusyServer(server.serverId);
    client
      .request(running ? { type: 'mcp/stop', serverId: server.serverId } : { type: 'mcp/start', serverId: server.serverId })
      .then((response) => onToast(response.success ? (running ? '已请求停止' : '已请求启动') : response.error))
      .catch((reason: unknown) => onToast(reason instanceof Error ? reason.message : '操作失败'))
      .finally(() => {
        setBusyServer(undefined);
        mcp.reload();
      });
  };

  const visibleSkills = skills.state.kind === 'ready' ? skills.state.data.filter((skill) => skill.hidden !== true) : [];

  return (
    <>
      <SectionLabel onClick={mcp.reload} actionLabel="刷新">
        MCP 服务
      </SectionLabel>
      {mcp.state.kind === 'ready' ? (
        mcp.state.data.map((server) => {
          const view = MCP_STATUS[server.status];
          const actionable = server.status !== 'disabled' && busyServer !== server.serverId;
          return (
            <ListRow
              key={server.serverId}
              name="puzzle"
              title={server.serverId}
              subtitle={`${view.label}${server.toolCount > 0 ? ` · ${server.toolCount} 个工具` : ''}${server.lastError !== undefined ? ` · ${server.lastError}` : ''}`}
              trailing={
                actionable ? (
                  <span className="row-action">{server.status === 'running' || server.status === 'starting' ? '停止' : '启动'}</span>
                ) : (
                  <Dot status={view.dot} />
                )
              }
              {...(actionable ? { onClick: () => toggleServer(server) } : {})}
            />
          );
        })
      ) : (
        <QueryNote state={mcp.state.kind} message={mcp.state.kind === 'error' ? mcp.state.message : undefined} />
      )}
      <SectionLabel>技能 · {visibleSkills.length}</SectionLabel>
      {visibleSkills.map((skill) => (
        <SwitchRow
          key={skill.id}
          title={skill.name}
          subtitle={firstSentence(skill.description)}
          checked={!disabled.has(skill.id)}
          onToggle={() => toggleSkill(skill)}
        />
      ))}
      {skills.state.kind !== 'ready' ? (
        <QueryNote state={skills.state.kind} message={skills.state.kind === 'error' ? skills.state.message : undefined} />
      ) : null}
      <p className="quote-note">安装、卸载和编辑 MCP 配置在桌面端；手机可以启停与开关，结果立即作用于 Host。</p>
    </>
  );
}

export function HooksSection({
  settings,
  client,
  onToast,
}: {
  settings: HostSettingsState;
  client: HostClient | undefined;
  onToast: (message: string) => void;
}): ReactElement {
  const hooks = useHostQuery(client, HOOKS_COMMAND, readArrayField('hooks', isHook));
  const automation = settings.snapshot?.config.automation;
  return (
    <>
      {automation !== undefined ? (
        <>
          <SwitchRow
            title="自动化"
            subtitle="Hooks 与定时任务的总开关"
            checked={automation.enabled === true}
            onToggle={() => {
              void settings
                .apply('automation', { ...automation, enabled: automation.enabled !== true })
                .then((error) => onToast(error ?? (automation.enabled ? '已关闭自动化' : '已开启自动化')));
            }}
          />
          <SwitchRow
            title="生命周期 Hooks"
            subtitle="会话事件后运行 Hook"
            checked={automation.hooksEnabled === true}
            onToggle={() => {
              void settings
                .apply('automation', { ...automation, hooksEnabled: automation.hooksEnabled !== true })
                .then((error) => onToast(error ?? (automation.hooksEnabled ? '已关闭 Hooks' : '已开启 Hooks')));
            }}
          />
          <SwitchRow
            title="定时任务"
            subtitle="按计划在 Host 上发起会话"
            checked={automation.cronEnabled === true}
            onToggle={() => {
              void settings
                .apply('automation', { ...automation, cronEnabled: automation.cronEnabled !== true })
                .then((error) => onToast(error ?? (automation.cronEnabled ? '已关闭定时任务' : '已开启定时任务')));
            }}
          />
        </>
      ) : null}
      <SectionLabel>已定义的 Hooks</SectionLabel>
      {hooks.state.kind === 'ready' ? (
        hooks.state.data.length === 0 ? (
          <p className="muted">还没有 Hook。</p>
        ) : (
          hooks.state.data.map((hook) => (
            <ListRow
              key={hook.id}
              name="bolt"
              title={hook.id}
              subtitle={`${hook.event} · ${hook.action.type === 'shell' ? hook.action.command : hook.action.url}`}
              trailing={<Dot status={hook.enabled ? 'done' : ''} />}
            />
          ))
        )
      ) : (
        <QueryNote state={hooks.state.kind} message={hooks.state.kind === 'error' ? hooks.state.message : undefined} />
      )}
    </>
  );
}

export function WebSection({
  settings,
  onToast,
}: {
  settings: HostSettingsState;
  onToast: (message: string) => void;
}): ReactElement {
  const web = settings.snapshot?.config.web;
  if (web === undefined) return <p className="muted">Host 使用默认的网络搜索配置。</p>;
  return (
    <>
      <Facts
        items={[
          ['首选来源', web.searchProvider],
          ['每次结果', `${web.searchMaxResults} 条`],
          ['抓取方式', web.fetchProvider],
        ]}
      />
      <SectionLabel>搜索来源</SectionLabel>
      {web.searchSources.map((source) => (
        <SwitchRow
          key={source.id}
          title={source.label ?? source.id}
          subtitle={source.kind}
          checked={source.enabled}
          onToggle={() => {
            const searchSources = web.searchSources.map((item) =>
              item.id === source.id ? { ...item, enabled: !item.enabled } : item,
            );
            void settings
              .apply('web', { ...web, searchSources })
              .then((error) => onToast(error ?? (source.enabled ? `已停用 ${source.id}` : `已启用 ${source.id}`)));
          }}
        />
      ))}
      <p className="quote-note">API Key 只在 Host 的钥匙串里；手机只开关已配置的来源。</p>
    </>
  );
}

function QueryNote({ state, message }: { state: string; message: string | undefined }): ReactElement {
  return (
    <p className={state === 'error' ? 'error-text' : 'muted'}>
      {state === 'error' ? message : state === 'unsupported' ? '当前 Host 未开放这项读取。' : '正在读取 Host…'}
    </p>
  );
}

function firstSentence(text: string): string {
  const match = /[。！？]|[.!?](\s|$)/.exec(text);
  const cut = match === null ? text : text.slice(0, match.index + 1);
  return cut.length > 80 ? `${cut.slice(0, 79)}…` : cut;
}

function isSkill(value: unknown): value is SkillSummary {
  return isObject(value) && typeof value.id === 'string' && typeof value.name === 'string';
}

function isMcpServer(value: unknown): value is McpServerHealth {
  return isObject(value) && typeof value.serverId === 'string' && typeof value.status === 'string';
}

function isHook(value: unknown): value is HookDefinition {
  return isObject(value) && typeof value.id === 'string' && isObject(value.action);
}
