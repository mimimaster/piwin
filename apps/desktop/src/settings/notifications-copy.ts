import type { DesktopLocale } from '../desktop-locale';

export type NotificationsCopy = {
  title: string;
  description: string;
  authorizationLabel: string;
  authorizationDescription: string;
  authorizationDescriptionManaged: string;
  statusGranted: string;
  statusDenied: string;
  statusUnsupported: string;
  statusManaged: string;
  openSystemSettings: string;
  enableAuthorization: string;
  enabledLabel: string;
  enabledDescription: string;
  onNeedsInputLabel: string;
  onNeedsInputDescription: string;
  onNeedsInputConfirmTitle: string;
  onNeedsInputConfirmBody: string;
  confirm: string;
  cancel: string;
  onCompleteLabel: string;
  onCompleteDescription: string;
  onFailureLabel: string;
  onFailureDescription: string;
  foregroundToastLabel: string;
  foregroundToastDescription: string;
  badgeLabel: string;
  badgeDescription: string;
  soundLabel: string;
  soundDescription: string;
  bounceOnNeedsInputLabel: string;
  bounceOnNeedsInputDescription: string;
};

const ZH: NotificationsCopy = {
  title: '通知',
  description: '控制任务完成、失败或需要批准时，如何提醒你。',
  authorizationLabel: '系统通知',
  authorizationDescription: '由 macOS 通知权限控制。未授权时不会出现系统横幅。',
  authorizationDescriptionManaged: '由 macOS 系统设置管理。未授权时不会出现系统横幅。',
  statusGranted: '已开启',
  statusDenied: '已关闭',
  statusUnsupported: '当前运行方式不支持系统通知',
  statusManaged: '由系统设置管理',
  openSystemSettings: '打开系统设置',
  enableAuthorization: '开启',
  enabledLabel: '启用通知',
  enabledDescription: '关闭后不发送系统通知、应用内提示或弹跳；角标仍由「角标」开关控制。',
  onNeedsInputLabel: '需要批准或回答时',
  onNeedsInputDescription: '权限请求或提问等待你时提醒。关闭前会再次确认。',
  onNeedsInputConfirmTitle: '关闭批准提醒？',
  onNeedsInputConfirmBody: '关闭后，任务等待批准或提问时将不再发送系统通知或弹跳提醒。',
  confirm: '关闭提醒',
  cancel: '取消',
  onCompleteLabel: '任务完成时',
  onCompleteDescription: '后台会话成功结束时提醒。',
  onFailureLabel: '任务失败时',
  onFailureDescription: '后台会话失败时提醒。',
  foregroundToastLabel: '前台应用内提示',
  foregroundToastDescription: '窗口在前且会话不可见时，用应用内提示代替系统通知。',
  badgeLabel: 'Dock 角标',
  badgeDescription: '用角标显示未处理的完成、失败或待批准会话数。不受总开关影响。',
  soundLabel: '提示音',
  soundDescription: '系统通知附带声音。',
  bounceOnNeedsInputLabel: '需要批准时弹跳 Dock',
  bounceOnNeedsInputDescription: '窗口不在前台且需要你批准时，弹跳应用图标。',
};

const EN: NotificationsCopy = {
  title: 'Notifications',
  description: 'Choose how you are notified when tasks finish, fail, or need approval.',
  authorizationLabel: 'System notifications',
  authorizationDescription: 'Controlled by macOS notification permission. Banners require authorization.',
  authorizationDescriptionManaged: 'Managed in macOS System Settings. Banners require authorization.',
  statusGranted: 'On',
  statusDenied: 'Off',
  statusUnsupported: 'System notifications are not supported in this runtime',
  statusManaged: 'Managed in System Settings',
  openSystemSettings: 'Open System Settings',
  enableAuthorization: 'Enable',
  enabledLabel: 'Enable notifications',
  enabledDescription:
    'When off, no system banners, in-app toasts, or Dock bounce. Badge still follows the badge switch.',
  onNeedsInputLabel: 'When approval or an answer is needed',
  onNeedsInputDescription: 'Notify on permission prompts and questions. Turning this off asks for confirmation.',
  onNeedsInputConfirmTitle: 'Turn off approval alerts?',
  onNeedsInputConfirmBody:
    'You will no longer get system notifications or a Dock bounce when a task is waiting for approval or an answer.',
  confirm: 'Turn off',
  cancel: 'Cancel',
  onCompleteLabel: 'When a task finishes',
  onCompleteDescription: 'Notify when a background session completes successfully.',
  onFailureLabel: 'When a task fails',
  onFailureDescription: 'Notify when a background session fails.',
  foregroundToastLabel: 'In-app toast while focused',
  foregroundToastDescription:
    'When the window is focused but the session is not visible, use an in-app toast instead of a system banner.',
  badgeLabel: 'Dock badge',
  badgeDescription: 'Show unread completed, failed, or waiting sessions on the Dock icon. Independent of the master switch.',
  soundLabel: 'Sound',
  soundDescription: 'Play a sound with system notifications.',
  bounceOnNeedsInputLabel: 'Bounce Dock when approval is needed',
  bounceOnNeedsInputDescription: 'Bounce the app icon when the window is in the background and approval is needed.',
};

export function getNotificationsCopy(locale: DesktopLocale): NotificationsCopy {
  return locale === 'zh-CN' ? ZH : EN;
}
