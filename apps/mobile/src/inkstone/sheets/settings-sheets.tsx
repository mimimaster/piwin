import { useState, type ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { FullButton, ListRow } from '../inkstone-ui.js';
import { Icon } from '../icons.js';
import { SETTINGS_GROUPS } from '../pages/settings.js';

type FieldSpec = [label: string, value: string];

function DemoFormSheet({
  description,
  fields,
}: {
  description: string;
  fields: FieldSpec[];
}): ReactElement {
  const { dispatch } = useInkstone();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map(([, value], index) => [`demo-field-${index}`, value])),
  );
  return (
    <>
      <p>{description}</p>
      {fields.map(([label], index) => (
        <label className="field" key={label}>
          {label}
          <input
            value={values[`demo-field-${index}`] ?? ''}
            onChange={(event) =>
              setValues((current) => ({ ...current, [`demo-field-${index}`]: event.target.value }))
            }
            autoComplete="off"
          />
        </label>
      ))}
      <FullButton onClick={() => dispatch({ type: 'save-demo', values })}>保存演示配置</FullButton>
    </>
  );
}

export function SettingsSearchSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const [query, setQuery] = useState('');
  const matches = SETTINGS_GROUPS.flatMap(([, items]) => items).filter((title) =>
    title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <label className="search-field">
        <Icon name="search" />
        <input
          aria-label="搜索设置"
          placeholder="模型、权限、冷存储…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div>
        {matches.length > 0 ? (
          matches.map((title) => (
            <ListRow
              key={title}
              name="sliders"
              title={title}
              onClick={() => dispatch({ type: 'settings-section', section: title })}
            />
          ))
        ) : (
          <div className="empty-state">
            <p>没有找到这项设置。</p>
          </div>
        )}
      </div>
    </>
  );
}

function ReadoutSheet({
  text,
  compact = false,
}: {
  text: string;
  compact?: boolean;
}): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <>
      <div className="command">{text}</div>
      {compact ? (
        <FullButton
          variant="secondary"
          onClick={() => dispatch({ type: 'save-demo', values: {}, message: '演示上下文已整理' })}
        >
          演示压缩完成
        </FullButton>
      ) : (
        <FullButton variant="secondary" onClick={() => dispatch({ type: 'close-sheet' })}>
          知道了
        </FullButton>
      )}
    </>
  );
}

export const SETTINGS_SHEETS: Record<string, { title: string; render: () => ReactElement }> = {
  provider: {
    title: '供应商配置',
    render: () => (
      <DemoFormSheet
        description="配置保存在 Host；请勿在原型中填写真实密钥。"
        fields={[
          ['显示名', 'Anthropic'],
          ['API 地址', 'https://api.example.test'],
          ['环境变量引用', 'ANTHROPIC_API_KEY'],
        ]}
      />
    ),
  },
  'automation-new': {
    title: '新建自动化',
    render: () => (
      <DemoFormSheet
        description="由 Host 定时执行。"
        fields={[
          ['任务名称', '每天回看未完成的工作'],
          ['运行时间', '每天 09:00'],
          ['执行要求', '汇总待批准与失败的会话。'],
        ]}
      />
    ),
  },
  'automation-edit': {
    title: '编辑自动化',
    render: () => (
      <DemoFormSheet
        description="示例配置，不会创建真实定时任务。"
        fields={[
          ['任务名称', '每天回看未完成的工作'],
          ['运行时间', '每天 09:00'],
        ]}
      />
    ),
  },
  hook: {
    title: '生命周期 Hook',
    render: () => (
      <DemoFormSheet
        description="Host 上的会话事件触发。"
        fields={[
          ['名称', '会话完成检查'],
          ['事件', 'session:end'],
          ['命令', 'pnpm typecheck'],
        ]}
      />
    ),
  },
  mcp: {
    title: 'MCP 工具',
    render: () => (
      <DemoFormSheet
        description="MCP 在 Host 上运行，独立于工具权限层。"
        fields={[
          ['服务器 ID', 'github'],
          ['命令', 'npx'],
          ['参数', '-y @modelcontextprotocol/server-github'],
          ['环境变量引用', 'GITHUB_TOKEN'],
        ]}
      />
    ),
  },
  'extension-install': {
    title: '添加扩展',
    render: () => (
      <DemoFormSheet
        description="使用 Host 上的本地路径或仓库地址。"
        fields={[['安装来源', '~/Developer/piwin/.agents/skills']]}
      />
    ),
  },
  'prompt-template': {
    title: '提示词模板',
    render: () => (
      <DemoFormSheet
        description="在下一轮输入时使用。"
        fields={[
          ['名称', '代码审查'],
          ['提示词', '检查本次变更中的回归与边界问题。'],
        ]}
      />
    ),
  },
  'web-search': {
    title: '搜索来源',
    render: () => (
      <DemoFormSheet
        description="搜索在 Host 上执行。"
        fields={[
          ['默认来源', 'DuckDuckGo'],
          ['路由', '外部搜索优先'],
        ]}
      />
    ),
  },
  'web-fetch': {
    title: '网页抓取',
    render: () => (
      <DemoFormSheet
        description="保留桌面的抓取配置。"
        fields={[
          ['默认服务', 'Supermarkdown'],
          ['JS 站兜底', '浏览器快照'],
        ]}
      />
    ),
  },
  'knowledge-model': {
    title: '知识处理配置',
    render: () => (
      <DemoFormSheet
        description="嵌入、重排、解析与专用模型由 Host 统一管理。"
        fields={[['模型 / 服务', '使用 Host 默认配置']]}
      />
    ),
  },
  'session-policy': {
    title: '会话策略',
    render: () => (
      <DemoFormSheet
        description="恢复历史与上下文管理。"
        fields={[
          ['上下文压缩', '自动'],
          ['历史恢复', '打开时恢复'],
        ]}
      />
    ),
  },
  'cold-storage': {
    title: '冷存储配置',
    render: () => (
      <DemoFormSheet
        description="展示计划后由用户执行，不自动删除外部包。"
        fields={[
          ['存储目录', '~/piwin-archives'],
          ['计划', '手动执行'],
        ]}
      />
    ),
  },
  'artifact-settings': {
    title: 'Artifact 渲染',
    render: () => (
      <DemoFormSheet
        description="隔离与外部资源限制属于产品策略。"
        fields={[
          ['总开关', '启用'],
          ['触发模式', '自动'],
          ['最大字节数', '1048576'],
        ]}
      />
    ),
  },
  oauth: {
    title: 'OAuth 登录',
    render: () => (
      <ReadoutSheet text="真实流程会在 Host 发起登录，并让用户在浏览器完成授权。原型不打开认证站点，也不收集凭据。" />
    ),
  },
  'skill-detail': {
    title: 'karpathy-guidelines',
    render: () => (
      <ReadoutSheet text="思考再动手，简单优先，最小修改，验证结果。技能在 Host 中加载，手机只选择是否引用。" />
    ),
  },
  rules: {
    title: '权限规则',
    render: () => <ReadoutSheet text={'{\n  "mode": "auto",\n  "rules": []\n}'} />,
  },
  runtime: {
    title: '运行时驻留',
    render: () => (
      <ReadoutSheet text="当前活跃 2 个会话。闲置会话按 Host 策略释放运行时，历史记录仍然保留。" />
    ),
  },
  'storage-pack': {
    title: '外部归档包',
    render: () => (
      <ReadoutSheet
        text={'piwin-2026-09-01.pack\npiwin-2026-08-25.pack\n\n2 个示例包 · 未执行任何存储操作'}
      />
    ),
  },
  'usage-model': {
    title: '模型用量',
    render: () => (
      <ReadoutSheet
        text={
          'Claude Sonnet\n输入：1.8M token\n输出：312k token\n范围：最近 30 天\n\n示例数据，不推算费用。'
        }
      />
    ),
  },
  'compact-context': {
    title: '压缩上下文',
    render: () => (
      <ReadoutSheet
        compact
        text="将此前已完成的工作整理为摘要，保留后续需要的上下文。本原型只演示压缩后的反馈。"
      />
    ),
  },
};
