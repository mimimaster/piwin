import type { ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { ListRow } from '../inkstone-ui.js';
import type { InkstoneHostContextValue } from '../host/inkstone-host-context.js';

/**
 * Apple Health is a phone capability, so it lives in the slab's + like a photo
 * does. On: this turn carries a health context ref and the Host may read
 * HealthKit summaries (consent still asked per the user's mode).
 */
export function AppleHealthAttachRow({
  hostCtx,
}: {
  hostCtx: InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  if (host.healthEnabled) {
    return (
      <ListRow
        name="drop"
        title="Apple Health"
        subtitle={host.includeAppleHealth ? '本轮会附带健康数据 · 点按取消' : '本轮附带睡眠、步数等健康摘要'}
        selected={host.includeAppleHealth}
        trailing={host.includeAppleHealth ? '已开启' : undefined}
        onClick={() => {
          host.setIncludeAppleHealth(!host.includeAppleHealth);
          dispatch({ type: 'close-sheet' });
        }}
      />
    );
  }
  const subtitle = !host.healthAvailable
    ? '当前 Host 或设备暂不支持读取健康数据'
    : host.healthUseMode === 'off'
      ? '已在设置中关闭 · 点按打开'
      : '未连接 · 点按设置';
  return (
    <ListRow
      name="drop"
      title="Apple Health"
      subtitle={subtitle}
      {...(host.healthAvailable ? { onClick: () => dispatch({ type: 'settings-section', section: 'Apple Health' }) } : { trailing: '不可用' })}
    />
  );
}
