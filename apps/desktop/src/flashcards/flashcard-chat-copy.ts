export type FlashcardChatCopy = {
  unnamedDeck: string;
  generatedCards: (count: number) => string;
  deckSep: (deck: string) => string;
  clickToFlip: string;
  questionMic: string;
  answerMic: string;
  flipToAnswer: string;
  flipBack: string;
  answer: string;
  source: string;
  openSource: string;
  rated: (label: string) => string;
  change: string;
  rateHint: string;
  previous: string;
  next: string;
  again: string;
  hard: string;
  good: string;
  easy: string;
};

const ZH: FlashcardChatCopy = {
  unnamedDeck: '闪卡',
  generatedCards: (count) => `生成了 ${count} 张知识卡片`,
  deckSep: (deck) => `· 牌组 ${deck} · 点击翻转`,
  clickToFlip: '点击翻转',
  questionMic: '问',
  answerMic: '答',
  flipToAnswer: '点击翻转',
  flipBack: '点击翻回',
  answer: '答',
  source: '来源',
  openSource: '打开源文件',
  rated: (label) => `已记录：${label}`,
  change: '修改',
  rateHint: '评分后进入下一张 · 1–4 直接按键',
  previous: '上一张',
  next: '下一张',
  again: '忘了',
  hard: '模糊',
  good: '记得',
  easy: '熟练',
};

const EN: FlashcardChatCopy = {
  unnamedDeck: 'Card',
  generatedCards: (count) =>
    count === 1 ? 'Generated 1 knowledge card' : `Generated ${count} knowledge cards`,
  deckSep: (deck) => `· Deck ${deck} · Click to flip`,
  clickToFlip: 'Click to flip',
  questionMic: 'Q',
  answerMic: 'A',
  flipToAnswer: 'Click to flip',
  flipBack: 'Click to flip back',
  answer: 'A',
  source: 'Source',
  openSource: 'Open',
  rated: (label) => `Rated: ${label}`,
  change: 'Change',
  rateHint: 'Rate to advance · keys 1–4',
  previous: 'Previous',
  next: 'Next',
  again: 'Forgot',
  hard: 'Fuzzy',
  good: 'Remembered',
  easy: 'Fluent',
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
