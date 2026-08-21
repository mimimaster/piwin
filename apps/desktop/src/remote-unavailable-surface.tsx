import type { ReactElement } from 'react';
import { Notice } from '@piwin/ui-kit';
import type { DesktopLocale } from './desktop-locale.js';

export type RemoteUnavailableFeature =
  | 'browser'
  | 'files'
  | 'review'
  | 'terminal'
  | 'notes'
  | 'flashcards';

const FEATURE_LABELS: Record<
  RemoteUnavailableFeature,
  { en: string; zh: string }
> = {
  browser: { en: 'Browser workbench', zh: '浏览器工作台' },
  files: { en: 'Host file browser', zh: 'Host 文件浏览器' },
  review: { en: 'Git review', zh: 'Git 审查' },
  terminal: { en: 'Interactive terminal', zh: '交互终端' },
  notes: { en: 'Notes library', zh: '笔记库' },
  flashcards: { en: 'Flashcards', zh: '闪卡' },
};

export function RemoteUnavailableSurface(props: {
  feature: RemoteUnavailableFeature;
  locale: DesktopLocale;
}): ReactElement {
  const label = FEATURE_LABELS[props.feature];
  const isChinese = props.locale === 'zh-CN';
  return (
    <div
      className="right-panel-empty"
      data-testid={`remote-unavailable-${props.feature}`}
      style={{ padding: 16 }}
    >
      <Notice tone="info">
        {isChinese
          ? `${label.zh}尚未获得这个远程 Host 的授权协议；当前壳不会发送 Host 路径或本机 PTY 命令。`
          : `${label.en} is not advertised by this remote Host. This shell will not send Host paths or local PTY commands.`}
      </Notice>
    </div>
  );
}
