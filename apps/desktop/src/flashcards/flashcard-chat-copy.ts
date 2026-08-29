export type FlashcardChatCopy = {
  unnamedDeck: string;
  flipToAnswer: string;
  flipBack: string;
  answer: string;
  source: string;
  openSource: string;
  rated: (label: string) => string;
  change: string;
  cardsCount: (count: number) => string;
  previous: string;
  next: string;
  again: string;
  hard: string;
  good: string;
  easy: string;
};

const ZH: FlashcardChatCopy = {
  unnamedDeck: '闪卡',
  flipToAnswer: '翻看解答',
  flipBack: '翻回',
  answer: '解答',
  source: '来源',
  openSource: '打开源文件',
  rated: (label) => `已记录：${label}`,
  change: '修改',
  cardsCount: (count) => `卡片 (${count})`,
  previous: '上一张',
  next: '下一张',
  again: '忘了',
  hard: '较难',
  good: '记住了',
  easy: '简单',
};

const EN: FlashcardChatCopy = {
  unnamedDeck: 'Card',
  flipToAnswer: 'Flip',
  flipBack: 'Flip back',
  answer: 'Answer',
  source: 'Source',
  openSource: 'Open',
  rated: (label) => `Rated: ${label}`,
  change: 'Change',
  cardsCount: (count) => `Cards (${count})`,
  previous: 'Previous',
  next: 'Next',
  again: 'Again',
  hard: 'Hard',
  good: 'Good',
  easy: 'Easy',
};

export function flashcardChatCopy(locale: 'zh-CN' | 'en'): FlashcardChatCopy {
  return locale === 'en' ? EN : ZH;
}

export function flashcardRateLabel(
  copy: FlashcardChatCopy,
  rating: 'again' | 'hard' | 'good' | 'easy',
): string {
  return copy[rating];
}
