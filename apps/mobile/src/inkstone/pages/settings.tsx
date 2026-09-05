import type { CSSProperties, ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../demo-state.js';
import { FullButton, IconButton, ListRow, Pill, ScreenHeading, TopBar } from '../inkstone-ui.js';

export const SETTINGS_GROUPS: [string, string[]][] = [
  ['应用', ['通用与外观', '权限与安全']],
  ['Agent', ['模型配置', 'OAuth 登录', 'Hooks', '智能体策略']],
  ['集成', ['技能与扩展', '网络搜索与抓取', '知识库与向量']],
  ['系统', ['会话与运行时', '冷存储', '用量统计', '归档管理']],
];

export function FaceSwitch({ fullWidth = false }: { fullWidth?: boolean }): ReactElement {
  const { state, dispatch } = useInkstone();
  const style: CSSProperties | undefined = fullWidth
    ? { width: '100%', margin: '18px 0' }
    : undefined;
  return (
    <div className="face-switch" style={style}>
      <button
        style={fullWidth ? { flex: 1 } : undefined}
        aria-pressed={state.face === 'paper'}
        onClick={() => dispatch({ type: 'set-face', face: 'paper' })}
        type="button"
      >
        纸 · Paper
      </button>
      <button
        style={fullWidth ? { flex: 1 } : undefined}
        aria-pressed={state.face === 'ink'}
        onClick={() => dispatch({ type: 'set-face', face: 'ink' })}
        type="button"
      >
        墨 · Ink
      </button>
    </div>
  );
}

function UsageInspector(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <>
      <Pill>最近 30 天 · 所有模型</Pill>
      <div className="metric-grid">
        <div>
          <strong>2.8M</strong>
          <small>输入 token</small>
        </div>
        <div>
          <strong>428k</strong>
          <small>输出 token</small>
        </div>
        <div>
          <strong>36</strong>
          <small>会话</small>
        </div>
      </div>
      <div className="usage-chart" aria-label="示例最近七天用量柱状图">
        {[30, 55, 45, 80, 62, 95, 68].map((height) => (
          <span key={height} style={{ '--height': `${height}%` } as CSSProperties} />
        ))}
      </div>
      <div className="spread muted" style={{ fontSize: 10, marginTop: 8 }}>
        <span>8 月 30 日</span>
        <span>9 月 5 日</span>
      </div>
      <ListRow
        name="bulb"
        title="Claude Sonnet"
        subtitle="输入 1.8M · 输出 312k"
        onClick={() => dispatch({ type: 'open-sheet', key: 'usage-model' })}
      />
    </>
  );
}

function SettingsSectionBody(): ReactElement {
  const { state, dispatch } = useInkstone();
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  const section = state.settingsSection;
  if (section === '通用与外观') {
    return (
      <>
        <ListRow
          name="globe"
          title="私有 Host"
          subtitle="书房的 Mac Studio"
          onClick={go('connect')}
        />
        <ListRow
          name="panel"
          title="纸 / 墨外观"
          subtitle="当前设备的显示偏好"
          onClick={() => dispatch({ type: 'toggle-face' })}
        />
        <ListRow
          name="bulb"
          title="通知与接续"
          subtitle="移动端建议功能"
          onClick={openSheet('notifications')}
        />
        <div className="quote-note">桌面宠物浮窗在手机上改为案头的状态入口，不占用对话正文。</div>
      </>
    );
  }
  if (section === '权限与安全') {
    return (
      <>
        <p className="muted">运行模式 · 保存到 Host</p>
        <div className="radio-options">
          {['Auto', 'Ask', 'YOLO'].map((mode) => (
            <button
              key={mode}
              aria-pressed={state.mode === mode}
              onClick={() => dispatch({ type: 'choose-mode', value: mode })}
              type="button"
            >
              {mode}
            </button>
          ))}
        </div>
        <div className="quote-note">
          Auto：按规则询问。Ask：每次询问。YOLO：跳过权限询问。仅演示选择，不改变真实权限。
        </div>
        <ListRow
          name="file"
          title="权限规则"
          subtitle="permissions.json · Host 规则文件"
          onClick={openSheet('rules')}
        />
        <ListRow
          name="folder"
          title="项目可信状态"
          subtitle="piwin · 已信任"
          onClick={openSheet('trust')}
        />
      </>
    );
  }
  if (section === '模型配置') {
    return (
      <>
        <ListRow
          name="bulb"
          title="Anthropic"
          subtitle="已配置 · Claude Sonnet / Opus"
          onClick={openSheet('provider')}
        />
        <ListRow
          name="bulb"
          title="OpenAI"
          subtitle="已配置 · 用户自定义模型"
          onClick={openSheet('provider')}
        />
        <FullButton variant="secondary" onClick={openSheet('model')}>
          选择默认模型
        </FullButton>
        <ListRow
          name="plus"
          title="添加供应商"
          subtitle="预设或自定义兼容服务"
          onClick={openSheet('provider')}
        />
      </>
    );
  }
  if (section === 'OAuth 登录') {
    return (
      <>
        <ListRow
          name="bulb"
          title="OpenAI Codex"
          subtitle="尚未登录 · 由 Host 管理凭据"
          onClick={openSheet('oauth')}
        />
        <ListRow
          name="bulb"
          title="Google Gemini"
          subtitle="尚未登录"
          onClick={openSheet('oauth')}
        />
      </>
    );
  }
  if (section === 'Hooks') {
    return (
      <>
        <ListRow
          name="refresh"
          title="会话结束后运行检查"
          subtitle="生命周期钩子 · 当前已关闭"
          onClick={openSheet('hook')}
        />
        <FullButton variant="secondary" onClick={openSheet('hook')}>
          新增 Hook
        </FullButton>
      </>
    );
  }
  if (section === '智能体策略') {
    return (
      <>
        <ListRow
          name="fork"
          title="子代理编排"
          subtitle="单 Agent / Ultra Code"
          onClick={openSheet('scheme')}
        />
        <ListRow name="refresh" title="自动化" subtitle="定时触发" onClick={go('automations')} />
        <ListRow
          name="panelr"
          title="Artifact 渲染"
          subtitle="已启用 · 自动识别"
          onClick={openSheet('artifact-settings')}
        />
      </>
    );
  }
  if (section === '技能与扩展') {
    return (
      <>
        <TabsRowForSettings />
        <ListRow
          name="cards"
          title="karpathy-guidelines"
          subtitle="已安装 · 项目技能"
          onClick={openSheet('skill-detail')}
        />
        <ListRow
          name="globe"
          title="GitHub MCP"
          subtitle="已连接 · 工具由 Host 运行"
          onClick={openSheet('mcp')}
        />
        <ListRow
          name="file"
          title="代码审查"
          subtitle="提示词模板"
          onClick={openSheet('prompt-template')}
        />
        <ListRow
          name="plus"
          title="添加扩展"
          subtitle="安装路径 / 仓库地址"
          onClick={openSheet('extension-install')}
        />
      </>
    );
  }
  if (section === '网络搜索与抓取') {
    return (
      <>
        <ListRow
          name="search"
          title="搜索来源"
          subtitle="DuckDuckGo · 当前默认"
          onClick={openSheet('web-search')}
        />
        <ListRow
          name="globe"
          title="网页抓取"
          subtitle="Supermarkdown · 当前默认"
          onClick={openSheet('web-fetch')}
        />
      </>
    );
  }
  if (section === '知识库与向量') {
    return (
      <>
        {['嵌入模型', '重排模型', '文档解析器', '专用模型'].map((title) => (
          <ListRow
            key={title}
            name="cards"
            title={title}
            subtitle="Host 统一配置"
            onClick={openSheet('knowledge-model')}
          />
        ))}
      </>
    );
  }
  if (section === '会话与运行时') {
    return (
      <>
        <ListRow
          name="panel"
          title="会话策略"
          subtitle="上下文压缩 · 历史恢复"
          onClick={openSheet('session-policy')}
        />
        <ListRow
          name="bulb"
          title="运行时驻留"
          subtitle="当前 2 个活跃会话"
          onClick={openSheet('runtime')}
        />
      </>
    );
  }
  if (section === '冷存储') {
    return (
      <>
        <ListRow
          name="archive"
          title="归档包配置"
          subtitle="尚未设置外部存储位置"
          onClick={openSheet('cold-storage')}
        />
        <ListRow
          name="file"
          title="外部包"
          subtitle="2 个包 · 不会自动删除"
          onClick={openSheet('storage-pack')}
        />
        <FullButton variant="secondary" onClick={openSheet('cold-storage')}>
          查看转存计划
        </FullButton>
      </>
    );
  }
  if (section === '用量统计') {
    return <UsageInspector />;
  }
  return (
    <ListRow
      name="archive"
      title={state.archived ? state.currentTitle : '早期移动端探索'}
      subtitle="已归档 · 可以恢复"
      onClick={() => dispatch({ type: 'restore-archive' })}
      trailing="恢复"
    />
  );
}

function TabsRowForSettings(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <div className="tabs">
      {['技能', 'MCP', '扩展', '提示词', '插件'].map((tab) => (
        <button
          key={tab}
          className={tab === '技能' ? 'active' : ''}
          aria-pressed={tab === '技能'}
          onClick={() => dispatch({ type: 'extension-tab', tab })}
          type="button"
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

export function SettingsPage(): ReactElement {
  const { dispatch } = useInkstone();
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  return (
    <>
      <TopBar
        title="设置"
        onBack={go('shelf')}
        right={<IconButton name="search" label="搜索设置" onClick={openSheet('settings-search')} />}
      />
      <div className="screen-scroll">
        <ScreenHeading title="让工具，顺手。" subtitle="手机偏好与 Host 配置，各归其位。" />
        <FaceSwitch fullWidth />
        {SETTINGS_GROUPS.map(([group, items]) => (
          <div key={group}>
            <div className="section-label">{group}</div>
            {items.map((title) => (
              <ListRow
                key={title}
                name={title.includes('模型') ? 'bulb' : 'sliders'}
                title={title}
                onClick={() => dispatch({ type: 'settings-section', section: title })}
              />
            ))}
          </div>
        ))}
        <div className="section-label">设备与连接</div>
        <ListRow
          name="globe"
          title="私有 Host"
          subtitle="书房的 Mac Studio"
          onClick={go('connect')}
        />
        <ListRow
          name="bulb"
          title="移动端通知"
          subtitle="只在需要我时提醒 · 提议"
          onClick={openSheet('notifications')}
        />
      </div>
    </>
  );
}

export function SettingsDetailPage(): ReactElement {
  const { state, dispatch } = useInkstone();
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  return (
    <>
      <TopBar
        title={state.settingsSection}
        subtitle="设置 · Host 配置为演示"
        onBack={go('settings')}
      />
      <div className="screen-scroll">
        <ScreenHeading title={state.settingsSection} />
        <SettingsSectionBody />
      </div>
    </>
  );
}
