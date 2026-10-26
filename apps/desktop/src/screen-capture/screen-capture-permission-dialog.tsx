/**
 * macOS Screen Recording guidance (spec 2026-10-25 §7). The OS cannot tell
 * "never asked" from "denied", so one dialog covers both.
 */
import type { ReactElement } from 'react';
import { Button, Modal } from '@piwin/ui-kit';
import type { DesktopLocale } from '../i18n/desktop-locale.js';

export type ScreenCapturePermissionDialogProps = {
  locale: DesktopLocale;
  onAuthorize: () => void;
  onRestart: () => void;
  onClose: () => void;
};

export function ScreenCapturePermissionDialog(
  props: ScreenCapturePermissionDialogProps,
): ReactElement {
  const isZh = props.locale === 'zh-CN';
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={isZh ? '需要屏幕录制权限' : 'Screen Recording permission needed'}
      testId="screen-capture-permission"
    >
      <div className="screen-capture-permission">
        <p>
          {isZh
            ? 'piwin 截屏需要 macOS 的「屏幕录制」权限。截图只在你确认后才会作为附件发送。'
            : 'piwin needs macOS Screen Recording permission to take screenshots. A screenshot is only sent after you confirm it.'}
        </p>
        <p className="screen-capture-permission-note">
          {isZh
            ? '在系统设置中打开 piwin 的开关后，需要重启 piwin 才会生效。'
            : 'After turning piwin on in System Settings, restart piwin for it to take effect.'}
        </p>
        <div className="screen-capture-permission-actions">
          <Button variant="ghost" onClick={props.onClose}>
            {isZh ? '取消' : 'Cancel'}
          </Button>
          <Button onClick={props.onRestart}>{isZh ? '重启 piwin' : 'Restart piwin'}</Button>
          <Button variant="primary" onClick={props.onAuthorize}>
            {isZh ? '去授权' : 'Open Settings'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
