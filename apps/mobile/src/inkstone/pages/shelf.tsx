import type { ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../demo-state.js';
import { Icon, type InkstoneIconName } from '../icons.js';
import {
  BottomNav,
  Dot,
  FullButton,
  IconButton,
  ListRow,
  ScreenHeading,
  TopBar,
} from '../inkstone-ui.js';
import { inboxCount } from './sessions.js';

const SHELF_TILES: [InkstoneIconName, string, string, InkstoneRoute][] = [
  ['image', '资料库', '图片 · 视频 · 收藏', 'library'],
  ['cards', '知识卡片', '12 张待复习', 'cards'],
  ['refresh', '自动化', '2 条定时任务', 'automations'],
  ['gear', '设置', '模型 · 权限 · 扩展', 'settings'],
];

export function ShelfPage(): ReactElement {
  const { state, dispatch } = useInkstone();
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  return (
    <>
      <TopBar
        title="案头"
        right={<IconButton name="gear" label="打开设置" onClick={go('settings')} />}
      />
      <div className="screen-scroll">
        <ScreenHeading title="一方小案头。" subtitle="收下成果，也留住灵感。" />
        <button className="host-card" onClick={openSheet('host')} type="button">
          <span className="host-monogram">书</span>
          <span className="grow">
            <strong>书房的 Mac Studio</strong>
            <small>{state.offline ? '连接已断开' : '已连接 · 2 台设备在线'}</small>
          </span>
          <Dot status={state.offline ? 'waiting' : 'done'} />
        </button>
        <div className="shelf-grid">
          {SHELF_TILES.map(([name, title, subtitle, route]) => (
            <button className="shelf-tile" key={title} onClick={go(route)} type="button">
              <Icon name={name} />
              <strong>{title}</strong>
              <small>{subtitle}</small>
            </button>
          ))}
        </div>
        <div className="section-label">最近留在案头</div>
        <ListRow
          name="file"
          title="Inkstone 设计走查"
          subtitle="报告 · 今天 09:18"
          onClick={go('walkthrough')}
        />
        <ListRow
          name="cards"
          title="Host 的边界"
          subtitle="知识卡片 · 今天"
          onClick={go('cards')}
        />
        <ListRow
          name="file"
          title="移动端的三点想法"
          subtitle="笔记 · 昨天"
          onClick={() => dispatch({ type: 'open-workspace', tab: '笔记' })}
        />
        <div className="section-label">随手记</div>
        <FullButton variant="secondary" onClick={openSheet('dictation')}>
          <Icon name="mic" /> 说一句，留在当前会话
        </FullButton>
      </div>
      <BottomNav
        selected="shelf"
        inboxCount={inboxCount(state.permission, state.planApproved)}
        onNavigate={(route) => dispatch({ type: 'navigate', route: route as InkstoneRoute })}
      />
    </>
  );
}
