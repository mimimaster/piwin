import { useEffect, useState, type ReactElement } from 'react';
import {
  getMobileNotificationPermission,
  requestMobileNotificationPermission,
  type MobileNotificationPermission,
} from '../../mobile-attention-os.js';
import {
  readMobileAttentionSwitches,
  writeMobileAttentionPreferences,
  type MobileAttentionSwitches,
} from '../../mobile-attention-preferences.js';
import { useInkstone } from '../inkstone-context.js';
import { FullButton, SwitchRow } from '../inkstone-ui.js';

function permissionLabel(status: MobileNotificationPermission | null): string {
  if (status === null) {
    return '正在读取系统通知权限…';
  }
  if (status === 'granted') {
    return '系统通知已开启。';
  }
  if (status === 'denied') {
    return '系统通知已关闭。可在 iOS 设置里重新打开。';
  }
  return '当前运行方式不支持系统通知（例如浏览器预览）。';
}

export function NotificationsSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const [permission, setPermission] = useState<MobileNotificationPermission | null>(null);
  const [switches, setSwitches] = useState<MobileAttentionSwitches>(() => readMobileAttentionSwitches());

  useEffect(() => {
    let cancelled = false;
    void getMobileNotificationPermission().then((value) => {
      if (!cancelled) {
        setPermission(value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(key: keyof MobileAttentionSwitches): void {
    const next = { ...switches, [key]: !switches[key] };
    setSwitches(next);
    writeMobileAttentionPreferences(next);
  }

  return (
    <>
      <p>完成、失败、需要批准时提醒你。应用在后台时尽量发本地通知；划掉应用后无法送达，也不保活。</p>
      <p className="muted" style={{ fontSize: 12 }}>
        {permissionLabel(permission)}
      </p>
      {permission === 'granted' || permission === 'unsupported' || permission === null ? null : (
        <FullButton
          onClick={() => {
            void requestMobileNotificationPermission().then(setPermission);
          }}
        >
          开启系统通知
        </FullButton>
      )}
      <SwitchRow
        title="需要批准或回答时"
        subtitle="权限请求或提问"
        checked={switches.onNeedsInput}
        onToggle={() => toggle('onNeedsInput')}
      />
      <SwitchRow
        title="任务完成时"
        subtitle="后台会话成功结束"
        checked={switches.onComplete}
        onToggle={() => toggle('onComplete')}
      />
      <SwitchRow
        title="任务失败时"
        subtitle="后台会话失败"
        checked={switches.onFailure}
        onToggle={() => toggle('onFailure')}
      />
      <p className="muted" style={{ fontSize: 11, marginTop: 18 }}>
        当前版本不显示主屏幕角标。偏好只存在本机。
      </p>
      <FullButton onClick={() => dispatch({ type: 'close-sheet' })}>完成</FullButton>
    </>
  );
}
