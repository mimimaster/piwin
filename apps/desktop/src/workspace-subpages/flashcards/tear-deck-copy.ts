export type TearDeckLabels = {
  flipHint: string;
  tear: string;
  lastCard: string;
  close: string;
  deleteCard: string;
  deleteSet: string;
  answer: string;
  question: string;
  remaining: (count: number) => string;
  revealShortcut: string;
  nextShortcut: string;
  completedTitle: string;
  completedDescription: (count: number) => string;
  restart: string;
};

const ZH: TearDeckLabels = {
  flipHint: '点击或按空格翻面',
  tear: '下一张',
  lastCard: '结束浏览',
  close: '关闭',
  deleteCard: '删这张',
  deleteSet: '删整套',
  answer: '解答',
  question: '提问',
  remaining: (count) => `剩余 ${count}`,
  revealShortcut: 'Space',
  nextShortcut: 'Enter',
  completedTitle: '本套已浏览完',
  completedDescription: (count) => `已浏览 ${count} 张`,
  restart: '再看一遍',
};

const EN: TearDeckLabels = {
  flipHint: 'Click or press Space to flip',
  tear: 'Next',
  lastCard: 'End browsing',
  close: 'Close',
  deleteCard: 'Delete this card',
  deleteSet: 'Delete this set',
  answer: 'Answer',
  question: 'Question',
  remaining: (count) => `${count} left`,
  revealShortcut: 'Space',
  nextShortcut: 'Enter',
  completedTitle: 'Finished browsing this set',
  completedDescription: (count) => `Browsed ${count} cards`,
  restart: 'Browse again',
};

export function tearDeckLabels(locale: 'zh-CN' | 'en'): TearDeckLabels {
  return locale === 'en' ? EN : ZH;
}
