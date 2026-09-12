import type { ComposerActivityLocale } from './composer-activity-model.js';

export type ComposerActivityCopy = {
  pillTitle: string;
  backgroundTasks: string;
  terminalJobs: string;
  stopAll: string;
  jumpHint: string;
  close: string;
  stop: string;
  zsh: string;
};

export function composerActivityCopy(locale: ComposerActivityLocale): ComposerActivityCopy {
  if (locale === 'en') {
    return {
      pillTitle: 'Background activity',
      backgroundTasks: 'Background tasks',
      terminalJobs: 'Terminal processes',
      stopAll: 'Stop all',
      jumpHint: 'Click to jump to the card',
      close: 'Close',
      stop: 'Stop',
      zsh: 'zsh',
    };
  }
  return {
    pillTitle: '后台任务',
    backgroundTasks: '后台任务',
    terminalJobs: '终端进程',
    stopAll: '全部停止',
    jumpHint: '点击可跳至卡片',
    close: '关闭',
    stop: '停止',
    zsh: 'zsh',
  };
}
