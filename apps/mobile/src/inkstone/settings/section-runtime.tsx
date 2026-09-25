import { useState, type ReactElement } from 'react';
import {
  resolvePreset,
  type PermissionPreset,
  type PermissionRulesFile,
} from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { Facts, ListRow, SectionLabel, SwitchRow } from '../inkstone-ui.js';
import type { HostSettingsState } from './use-host-settings.js';
import { isObject, useHostQuery } from '../host/use-host-query.js';

const PRESETS: [PermissionPreset, string, string][] = [
  ['ask', 'Ask', '几乎每一步都先问我'],
  ['auto', 'Auto', '工作区内放手，越界时问我'],
  ['yolo', 'YOLO', '不再询问，只留熔断'],
];

const RULES_COMMAND = { type: 'permissions/get-rules', layer: 'user' } as const;

export function PermissionsSection({
  settings,
  client,
  onToast,
}: {
  settings: HostSettingsState;
  client: HostClient | undefined;
  onToast: (message: string) => void;
}): ReactElement {
  const current = settings.snapshot?.config.permissions;
  const preset = current?.preset ?? presetFromMode(current?.mode);
  const rules = useHostQuery(client, RULES_COMMAND, readRules);

  const choose = (next: PermissionPreset): void => {
    if (next === preset) return;
    void settings.apply('permissions', { preset: next, mode: resolvePreset(next).mode }).then((error) => {
      onToast(error ?? `新会话默认 ${next.toUpperCase()}`);
    });
  };

  return (
    <>
      <SectionLabel>新会话的默认运行模式</SectionLabel>
      {PRESETS.map(([value, label, hint]) => (
        <ListRow
          key={value}
          name="shield"
          title={label}
          subtitle={hint}
          selected={preset === value}
          trailing={preset === value ? <span className="seal-mini">选</span> : <span />}
          onClick={() => choose(value)}
        />
      ))}
      <SectionLabel>我的规则</SectionLabel>
      {rules.state.kind === 'ready' ? (
        <Facts
          items={[
            ['总是拒绝', `${rules.state.data.deny?.length ?? 0} 条`],
            ['先问我', `${rules.state.data.ask?.length ?? 0} 条`],
            ['直接允许', `${rules.state.data.allow?.length ?? 0} 条`],
          ]}
        />
      ) : (
        <p className="muted">{rules.state.kind === 'error' ? rules.state.message : '正在读取 Host 规则…'}</p>
      )}
      <p className="quote-note">决定始终在 Host 上做出；手机只转达你的「允 / 否」与记忆范围。规则的逐条编辑在桌面端。</p>
    </>
  );
}

export function SessionRuntimeSection({
  settings,
  onToast,
  onOpenSessions,
}: {
  settings: HostSettingsState;
  onToast: (message: string) => void;
  onOpenSessions: () => void;
}): ReactElement {
  const config = settings.snapshot?.config;
  const autoName = config?.session?.autoName ?? true;
  const compaction = config?.compaction;
  const autoCompact = compaction?.autoEnabledDefault ?? true;
  const execution = config?.execution;

  return (
    <>
      <SwitchRow
        title="自动命名会话"
        subtitle="首条消息后由 Host 起标题"
        checked={autoName}
        onToggle={() => {
          void settings
            .apply('session', { ...(config?.session ?? {}), autoName: !autoName })
            .then((error) => onToast(error ?? (autoName ? '已关闭自动命名' : '已开启自动命名')));
        }}
      />
      {compaction !== undefined ? (
        <SwitchRow
          title="自动压缩上下文"
          subtitle="接近窗口上限时由 Host 压缩"
          checked={autoCompact}
          onToggle={() => {
            void settings
              .apply('compaction', { ...compaction, autoEnabledDefault: !autoCompact })
              .then((error) => onToast(error ?? (autoCompact ? '新会话不再自动压缩' : '新会话自动压缩')));
          }}
        />
      ) : null}
      <SectionLabel>运行上限</SectionLabel>
      <Facts
        items={[
          ['同时运行的会话', execution !== undefined ? `${execution.maxConcurrentRuns}` : '—'],
          ['内存下限', execution?.minAvailableMemoryMiB !== undefined ? `${execution.minAvailableMemoryMiB} MiB` : '—'],
          ['托管进程上限', config?.process !== undefined ? `${config.process.maxProcesses}` : '—'],
        ]}
      />
      <ListRow name="panel" title="浏览全部会话" subtitle="回到会话列表" onClick={onOpenSessions} />
    </>
  );
}

export function AgentPolicySection({ settings }: { settings: HostSettingsState }): ReactElement {
  const subagents = settings.snapshot?.config.subagents;
  const [showSchemes, setShowSchemes] = useState(false);
  if (subagents === undefined) {
    return <p className="muted">Host 使用默认子代理策略。</p>;
  }
  const schemes = subagents.schemes ?? [];
  return (
    <>
      <Facts
        items={[
          ['同时运行的子代理', `${subagents.maxConcurrency}`],
          ['单次最多委派', `${subagents.maxTasksPerRun}`],
          ['进程隔离', subagents.processIsolation === 'required' ? '必须' : subagents.processIsolation],
          ['并行写入', subagents.parallelWritePolicy === 'worktree-only' ? '仅独立工作树' : subagents.parallelWritePolicy],
          ['自定义角色', `${subagents.profiles.length} 个`],
        ]}
      />
      {schemes.length > 0 ? (
        <>
          <SectionLabel onClick={() => setShowSchemes(!showSchemes)} actionLabel={showSchemes ? '收起' : '展开'}>
            编排方案 · {schemes.length}
          </SectionLabel>
          {showSchemes
            ? schemes.map((scheme) => (
                <ListRow key={scheme.id} name="grid" title={scheme.name} subtitle={scheme.description} trailing={<span />} />
              ))
            : null}
        </>
      ) : null}
      <p className="quote-note">子代理的角色与模型在桌面端编排；手机上可以看到每次委派的进度与结果。</p>
    </>
  );
}

function presetFromMode(mode: string | undefined): PermissionPreset {
  return mode === 'ask-all' ? 'ask' : mode === 'auto' ? 'auto' : 'yolo';
}

function readRules(data: unknown): PermissionRulesFile | undefined {
  if (!isObject(data) || !isObject(data.rules)) return undefined;
  return data.rules as PermissionRulesFile;
}
