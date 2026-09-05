import { useState, type ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../demo-state.js';
import { Icon } from '../icons.js';
import {
  Dot,
  FullButton,
  IconButton,
  ListRow,
  Pill,
  ScreenHeading,
  TabsRow,
  TopBar,
} from '../inkstone-ui.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';

function ConnectedConnectPage({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { dispatch } = useInkstone();
  const { host, onOpenConnection } = hostCtx;
  const ready = host.connectionState.kind === 'ready';
  return (
    <>
      <TopBar
        title="私有 Host"
        subtitle="设备与连接"
        onBack={() => dispatch({ type: 'navigate', route: 'settings' })}
      />
      <div className="screen-scroll">
        <div className="empty-state">
          <span className="brand-seal">砚</span>
          <h2>连回自己的书案。</h2>
          <p>
            项目、模型和会话都在你的 Host。
            <br />
            手机只是另一扇窗。
          </p>
        </div>
        <button className="host-card" type="button">
          <span className="host-monogram">书</span>
          <span className="grow">
            <strong>{(host.endpoint ?? '').replace(/^wss?:\/\//, '') || '私有 Host'}</strong>
            <small>{ready ? '已连接 · 正在与桌面同步' : '连接中…'}</small>
          </span>
          <Dot status={ready ? 'done' : 'waiting'} />
        </button>
        <FullButton onClick={onOpenConnection}>管理连接</FullButton>
        <FullButton variant="secondary" onClick={() => void host.handleDisconnect()}>
          断开连接
        </FullButton>
        <div className="quote-note">凭据保存在设备密钥库，连接由现有配对流程负责。</div>
      </div>
    </>
  );
}

export function ConnectPage(): ReactElement {
  const { state, dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  if (hostCtx !== null) {
    return <ConnectedConnectPage hostCtx={hostCtx} />;
  }
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  return (
    <>
      <TopBar title="私有 Host" subtitle="设备与连接" onBack={go('settings')} />
      <div className="screen-scroll">
        <div className="empty-state">
          <span className="brand-seal">砚</span>
          <h2>连回自己的书案。</h2>
          <p>
            项目、模型和会话都在你的 Host。
            <br />
            手机只是另一扇窗。
          </p>
        </div>
        <button className="host-card" onClick={() => dispatch({ type: 'pair-demo' })} type="button">
          <span className="host-monogram">书</span>
          <span className="grow">
            <strong>书房的 Mac Studio</strong>
            <small>已配对 · {state.offline ? '离线' : '可连接'}</small>
          </span>
          <Dot status={state.offline ? 'waiting' : 'done'} />
        </button>
        <FullButton onClick={openSheet('pairing')}>扫描桌面配对码</FullButton>
        <FullButton variant="secondary" onClick={openSheet('manual-connect')}>
          手动输入连接信息
        </FullButton>
        <div className="quote-note">
          原型不访问相机、私有网络或真实凭据。可通过示例配对体验连接流程。
        </div>
      </div>
    </>
  );
}

function ConnectedNewSession({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { state, dispatch } = useInkstone();
  const { host } = hostCtx;
  const [prompt, setPrompt] = useState(state.draft);
  const selectedModel = host.configuredModels.find(
    (model) =>
      model.providerId === hostCtx.modelSelection.providerId &&
      model.modelId === hostCtx.modelSelection.modelId,
  );
  const start = (): void => {
    const text = prompt.trim();
    if (text.length === 0) {
      dispatch({ type: 'toast', message: '先写一句你想做的事' });
      return;
    }
    dispatch({ type: 'navigate', route: 'chat' });
    void host.handleCreateSession(undefined).then(() => {
      void host.handleSend({ text });
    });
  };
  return (
    <>
      <TopBar
        title="新的一页"
        subtitle="会话将在你的 Host 上开始"
        onBack={() => dispatch({ type: 'navigate', route: 'sessions' })}
      />
      <div className="screen-scroll">
        <div className="empty-state">
          <span className="brand-seal">砚</span>
          <h2>今天，想做点什么？</h2>
          <p>一句话，也可以是一个开始。</p>
        </div>
        <ListRow
          name="bulb"
          title="模型"
          subtitle={selectedModel?.label?.trim() || selectedModel?.modelId || '使用 Host 默认'}
          onClick={() => dispatch({ type: 'open-sheet', key: 'model' })}
        />
        <label className="field">
          写下你的想法
          <textarea
            placeholder="例如，帮我梳理这个项目的会话恢复逻辑…"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <FullButton onClick={start}>开始这段会话</FullButton>
        <FullButton
          variant="secondary"
          onClick={() => dispatch({ type: 'open-sheet', key: 'dictation' })}
        >
          先说一句
        </FullButton>
        <div className="section-label">也可以从这里开始</div>
        <ListRow
          name="git"
          title="审阅最近的变更"
          onClick={() => {
            setPrompt('帮我审阅最近的变更，先给出问题和建议。');
          }}
        />
        <ListRow
          name="cards"
          title="把一个想法写成计划"
          onClick={() => {
            setPrompt('帮我把移动端的离线草稿功能整理成一份计划。');
          }}
        />
      </div>
    </>
  );
}

export function NewSessionPage(): ReactElement {
  const { state, dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  const [prompt, setPrompt] = useState(state.draft);
  if (hostCtx !== null) {
    return <ConnectedNewSession hostCtx={hostCtx} />;
  }
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  return (
    <>
      <TopBar
        title="新的一页"
        subtitle="会话将在你的 Host 上开始"
        onBack={() => dispatch({ type: 'navigate', route: 'sessions' })}
      />
      <div className="screen-scroll">
        <div className="empty-state">
          <span className="brand-seal">砚</span>
          <h2>今天，想做点什么？</h2>
          <p>一句话，也可以是一个开始。</p>
        </div>
        <ListRow
          name="folder"
          title="项目"
          subtitle={state.selectedProject}
          onClick={openSheet('projects')}
        />
        <ListRow name="bulb" title="模型" subtitle={state.model} onClick={openSheet('model')} />
        <label className="field">
          写下你的想法
          <textarea
            placeholder="例如，帮我梳理这个项目的会话恢复逻辑…"
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              dispatch({ type: 'set-draft', value: event.target.value });
            }}
          />
        </label>
        <FullButton onClick={() => dispatch({ type: 'start-session', text: prompt })}>
          开始这段会话
        </FullButton>
        <FullButton variant="secondary" onClick={openSheet('dictation')}>
          先说一句
        </FullButton>
        <div className="section-label">也可以从这里开始</div>
        <ListRow
          name="git"
          title="审阅最近的变更"
          onClick={() =>
            dispatch({ type: 'prefill', value: '帮我审阅最近的变更，先给出问题和建议。' })
          }
        />
        <ListRow
          name="cards"
          title="把一个想法写成计划"
          onClick={() =>
            dispatch({ type: 'prefill', value: '帮我把移动端的离线草稿功能整理成一份计划。' })
          }
        />
      </div>
    </>
  );
}

export function WalkthroughPage(): ReactElement {
  const { dispatch } = useInkstone();
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const copyReport = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(
        'Inkstone 走查报告（原型示例）\n主题色、会话节点、砚台输入区与权限印章已统一。',
      );
      dispatch({ type: 'toast', message: '示例内容已复制' });
    } catch {
      dispatch({ type: 'toast', message: '浏览器未允许复制，可直接选择正文复制' });
    }
  };
  return (
    <>
      <TopBar
        title="走查报告"
        subtitle="Inkstone · 桌面主题"
        onBack={go('shelf')}
        right={<IconButton name="copy" label="复制走查报告" onClick={() => void copyReport()} />}
      />
      <div className="screen-scroll">
        <div className="section-label">
          <span className="eyebrow">WALKTHROUGH / 01</span>
          <Pill variant="pine">已交付</Pill>
        </div>
        <ScreenHeading
          title={'纸与墨，\n终于有了同一种语气。'}
          subtitle="09:18 · 本次会话的交付记录"
        />
        <article className="assistant-prose">
          <p>
            这次把暖纸、深墨和朱色操作统一到桌面的主工作区。主内容继续保持安静，状态退到细线与页边。
          </p>
          <h3 style={{ marginTop: 24 }}>交付了什么</h3>
          <p>主题色、会话节点、砚台输入区与权限印章。纸墨双面使用同一套语义。</p>
          <h3 style={{ marginTop: 24 }}>怎样确认</h3>
          <p>检查纸墨两面的正文、输入、权限请求和文件变更。验证正常、工作中与待批准三种状态。</p>
          <div className="command">
            示例验证记录
            {'\n'}✓ 4 个文件审阅完成
            {'\n'}✓ 主题切换检查通过
            {'\n'}✓ 页面状态检查通过
          </div>
          <h3 style={{ marginTop: 24 }}>仍需关注</h3>
          <p>窄屏下的长路径与系统字体回退，需要在真机阶段再验证。</p>
        </article>
        <div className="section-label">证据与关联</div>
        <ListRow
          name="git"
          title="查看 4 个文件的变更"
          subtitle="当前报告的示例证据"
          onClick={go('review')}
        />
        <ListRow
          name="panel"
          title="回到原会话"
          subtitle="报告绑定会话与消息"
          onClick={go('chat')}
        />
      </div>
    </>
  );
}

const LIBRARY_TABS = ['全部', '图片', '视频', '收藏'];

const LIBRARY_ASSETS: Record<string, [IconName, string, string][]> = {
  全部: [
    ['image', '纸面外壳', '图片 · 1440 × 900'],
    ['image', '墨面外壳', '图片 · 1440 × 900'],
    ['file', '会话恢复演示', '视频 · 00:24'],
    ['image', '砚台输入区', '图片 · 720 × 200'],
  ],
  图片: [
    ['image', '纸面外壳', '图片 · 1440 × 900'],
    ['image', '墨面外壳', '图片 · 1440 × 900'],
  ],
  视频: [['file', '会话恢复演示', '视频 · 00:24']],
  收藏: [['image', '纸面外壳', '已收藏 · 设计参考']],
};

type IconName = 'image' | 'file';

export function LibraryPage(): ReactElement {
  const { state, dispatch } = useInkstone();
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  return (
    <>
      <TopBar
        title="资料库"
        subtitle="共享 Host 的成果"
        onBack={go('shelf')}
        right={
          <IconButton name="plus" label="生成新的图片或视频" onClick={openSheet('media-new')} />
        }
      />
      <div className="screen-scroll">
        <ScreenHeading title={'留下来的，\n都在这里。'} subtitle="图片、视频与收藏" />
        <TabsRow
          items={LIBRARY_TABS}
          selected={state.libraryFilter}
          onSelect={(value) => dispatch({ type: 'library-filter', value })}
        />
        <div className="asset-grid">
          {(LIBRARY_ASSETS[state.libraryFilter] ?? LIBRARY_ASSETS['全部'] ?? []).map(
            ([name, title, meta]) => (
              <button className="asset-item" key={title} onClick={openSheet('asset')} type="button">
                <Icon name={name} />
                <strong>{title}</strong>
                <small>{meta}</small>
              </button>
            ),
          )}
        </div>
        <p className="muted" style={{ fontSize: 11 }}>
          演示资产使用类型占位，不加载私人媒体。
        </p>
        <div className="section-label">最近生成</div>
        <ListRow
          name="image"
          title="Inkstone 移动端设计参考"
          subtitle="已完成 · 来自设计会话"
          onClick={openSheet('asset')}
        />
        <FullButton
          variant="secondary"
          onClick={() =>
            dispatch({ type: 'put-draft', value: '请生成一张 Inkstone 纸面设计参考。' })
          }
        >
          回到会话生成图片
        </FullButton>
      </div>
    </>
  );
}

export function AutomationsPage(): ReactElement {
  const { dispatch } = useInkstone();
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  return (
    <>
      <TopBar
        title="自动化"
        subtitle="定时交给 Host"
        onBack={go('shelf')}
        right={<IconButton name="plus" label="新建自动化" onClick={openSheet('automation-new')} />}
      />
      <div className="screen-scroll">
        <ScreenHeading title="小事，按时发生。" subtitle="Host 在线时执行，手机随时查看。" />
        <ListRow
          name="refresh"
          title="每天回看未完成的工作"
          subtitle="每天 09:00 · 下次明天"
          onClick={openSheet('automation-edit')}
          trailing="已启用"
        />
        <ListRow
          name="git"
          title="每周检查项目依赖"
          subtitle="每周一 10:00 · piwin"
          onClick={openSheet('automation-edit')}
          trailing="已暂停"
        />
        <div className="section-label">最近一次</div>
        <div className="continue-card">
          <Pill variant="pine">完成 · 今天 09:00</Pill>
          <h3>今日还有 2 件待办</h3>
          <p>1 项操作等待批准，1 份计划等待执行方式。</p>
          <FullButton variant="subtle" onClick={go('inbox')}>
            查看待办
          </FullButton>
        </div>
      </div>
    </>
  );
}
