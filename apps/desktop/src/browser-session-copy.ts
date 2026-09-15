/**
 * Localized copy for the browser workbench panel and chrome.
 */
import type { DesktopLocale } from './desktop-locale';
import type { BrowserSessionChromeCopy } from './browser-session-chrome';

export type BrowserSessionCopy = BrowserSessionChromeCopy & {
  agentUsing: string;
  takeOver: string;
  youHaveControl: string;
  giveBack: string;
  pickPending: string;
  pickFailed: string;
  mirrorStartFailed: string;
  mirrorStopFailed: string;
  starting: string;
  clearHighlight: string;
  frameAlt: string;
  annotateAdd: string;
  annotateUndo: string;
  annotateRedo: string;
  annotateClear: string;
  annotatePen: string;
  annotateLine: string;
  annotateArrow: string;
  annotateRect: string;
  annotateEllipse: string;
  annotateText: string;
  frameUnavailable: string;
  commandFailed: string;
  viewportFailed: string;
  panelActionFailed: string;
  diagCss: string;
  diagEncoded: string;
  diagDpr: string;
  diagDisplay: string;
  diagDensity: string;
  diagQuality: string;
  diagProducer: string;
};

export function browserSessionCopy(locale: DesktopLocale): BrowserSessionCopy {
  if (locale === 'zh-CN') {
    return {
      address: '地址',
      urlPlaceholder: '输入网址或 localhost:3000',
      reload: '刷新',
      back: '后退',
      forward: '前进',
      newTab: '新标签',
      closeTab: '关闭标签',
      acceptDialog: '接受',
      dismissDialog: '取消',
      pickDisabled: 'Agent 占用浏览器时无法取元素',
      pickExit: '退出取元素',
      pickEnter: '选择元素（⇧⌘S）',
      annotate: '标注页面',
      annotateExit: '关闭标注',
      openExternal: '在系统浏览器打开（单独会话，不共享登录态）',
      devDrawer: '开发抽屉（控制台 / 网络）',
      more: '更多',
      expand: '全宽显示',
      collapse: '退出全宽',
      closePanel: '关闭浏览器面板',
      restart: '重启浏览器会话',
      dismissNotice: '关闭提示',
      noticeRepeat: '重复 {count} 次',
      idle: '浏览器空闲',
      youHaveControl: '你在控制',
      agentUsing: 'Agent 正在控制',
      takeOver: '接管',
      giveBack: '交还',
      viewportTitle: '视口',
      viewportResponsive: '响应式',
      viewportDesktop: '桌面',
      viewportMobile: '移动端',
      viewportTablet: '平板',
      viewportCustom: '自定义',
      viewportWidth: '宽度',
      viewportHeight: '高度',
      viewportApply: '应用尺寸',
      viewportSetByAgent: '由 Agent 设置',
      viewportFit: '适应面板',
      viewportZoom100: '100%',
      diagCss: 'CSS 视口',
      diagEncoded: '编码尺寸',
      diagDpr: '源 DPR',
      diagDisplay: '显示尺寸',
      diagDensity: '密度',
      diagQuality: 'JPEG 质量',
      diagProducer: '来源',
      densityLow: '低清镜像',
      densityEncoded: '实际编码',
      densityRequired: '目标像素',
      densityProducer: '来源',
      pickPending: '正在解析元素…',
      pickFailed: '无法解析该元素，请再试一次。',
      mirrorStartFailed: '无法启动浏览器镜像。',
      mirrorStopFailed: '无法停止浏览器镜像。',
      starting: '正在启动浏览器会话…',
      clearHighlight: '清除高亮',
      frameAlt: '浏览器会话',
      annotateAdd: '添加到对话',
      annotateUndo: '撤销',
      annotateRedo: '重做',
      annotateClear: '清空',
      annotatePen: '画笔',
      annotateLine: '直线',
      annotateArrow: '箭头',
      annotateRect: '矩形',
      annotateEllipse: '椭圆',
      annotateText: '文字',
      frameUnavailable: '远程浏览画面需要更新 Host 或 Desktop',
      commandFailed: '浏览器命令失败，请重试。',
      viewportFailed: '无法调整视口。',
      panelActionFailed: '面板操作失败，请重试。',
    };
  }
  return {
    address: 'Address',
    urlPlaceholder: 'Enter URL or localhost:3000',
    reload: 'Reload (Host-committed page)',
    back: 'Back',
    forward: 'Forward',
    newTab: 'New tab',
    closeTab: 'Close tab',
    acceptDialog: 'Accept',
    dismissDialog: 'Dismiss',
    pickDisabled: 'Pick disabled while the agent has the browser',
    pickExit: 'Exit pick mode',
    pickEnter: 'Pick element (⇧⌘S)',
    annotate: 'Annotate page',
    annotateExit: 'Close annotation',
    openExternal: 'Open in system browser (separate session, no shared login)',
    devDrawer: 'Developer drawer (console / network)',
    more: 'More',
    expand: 'Full width',
    collapse: 'Exit full width',
    closePanel: 'Close browser panel',
    restart: 'Restart browser session',
    dismissNotice: 'Dismiss',
    noticeRepeat: 'Repeated {count} times',
    idle: 'Browser idle',
    youHaveControl: 'You have control',
    agentUsing: 'Agent is controlling',
    takeOver: 'Take over',
    giveBack: 'Give back',
    viewportTitle: 'Viewport',
    viewportResponsive: 'Responsive',
    viewportDesktop: 'Desktop',
    viewportMobile: 'Mobile',
    viewportTablet: 'Tablet',
    viewportCustom: 'Custom',
    viewportWidth: 'Width',
    viewportHeight: 'Height',
    viewportApply: 'Apply size',
    viewportSetByAgent: 'Set by Agent',
    viewportFit: 'Fit',
    viewportZoom100: '100%',
    diagCss: 'CSS viewport',
    diagEncoded: 'Encoded',
    diagDpr: 'Source DPR',
    diagDisplay: 'Display',
    diagDensity: 'Density',
    diagQuality: 'JPEG quality',
    diagProducer: 'Producer',
    densityLow: 'Low-resolution mirror',
    densityEncoded: 'Encoded',
    densityRequired: 'Required',
    densityProducer: 'Producer',
    pickPending: 'Resolving element…',
    pickFailed: 'Could not resolve element. Please try again.',
    mirrorStartFailed: 'Could not start the browser mirror.',
    mirrorStopFailed: 'Could not stop the browser mirror.',
    starting: 'Starting browser session…',
    clearHighlight: 'Clear highlight',
    frameAlt: 'Browser session',
    annotateAdd: 'Add to conversation',
    annotateUndo: 'Undo',
    annotateRedo: 'Redo',
    annotateClear: 'Clear',
    annotatePen: 'Pen',
    annotateLine: 'Line',
    annotateArrow: 'Arrow',
    annotateRect: 'Rectangle',
    annotateEllipse: 'Ellipse',
    annotateText: 'Text',
    frameUnavailable: 'Remote browser view needs a Host or Desktop update',
    commandFailed: 'Browser command failed. Try again.',
    viewportFailed: 'Could not change the viewport.',
    panelActionFailed: 'Panel action failed. Try again.',
  };
}

