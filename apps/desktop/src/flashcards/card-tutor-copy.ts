import type { FlashcardTutorFace } from '@piwin/contracts';

export type CardTutorCopy = {
  hint: string;
  explain: string;
  hintCard: string;
  explainCard: string;
  loadingHint: string;
  loadingExplain: string;
  example: string;
  simplify: string;
  makeCard: string;
  retry: string;
  close: string;
  flipAnswer: string;
  flipQuestion: string;
  modelUnavailable: string;
  settingsFallback: string;
  chatFallback: string;
  errorGeneric: string;
  panelHint: string;
  panelExplain: string;
  readyLiveHint: string;
  readyLiveExplain: string;
  selectionPopover: string;
};

const ZH: CardTutorCopy = {
  hint: '给我提示',
  explain: '讲解',
  hintCard: '给我提示',
  explainCard: '讲解这张卡',
  loadingHint: '正在生成提示…',
  loadingExplain: '正在讲解…',
  example: '举例',
  simplify: '换个说法',
  makeCard: '做成新卡',
  retry: '重试',
  close: '关闭',
  flipAnswer: '查看答案',
  flipQuestion: '翻看提问',
  modelUnavailable: '当前没有可用的模型来生成讲解。',
  settingsFallback: '请到设置中配置对话模型。',
  chatFallback: '也可以在聊天中询问。',
  errorGeneric: '无法生成讲解。',
  panelHint: '提示',
  panelExplain: '讲解',
  readyLiveHint: '提示已生成。',
  readyLiveExplain: '讲解已生成。',
  selectionPopover: '选区动作',
};

const EN: CardTutorCopy = {
  hint: 'Hint',
  explain: 'Explain',
  hintCard: 'Hint for this card',
  explainCard: 'Explain this card',
  loadingHint: 'Generating a hint…',
  loadingExplain: 'Explaining…',
  example: 'Example',
  simplify: 'Say it simpler',
  makeCard: 'Make a new card',
  retry: 'Retry',
  close: 'Close',
  flipAnswer: 'Show answer',
  flipQuestion: 'Show question',
  modelUnavailable: 'No model is available for this explanation.',
  settingsFallback: 'Open Settings to configure a chat model.',
  chatFallback: 'You can also ask in chat.',
  errorGeneric: 'Could not generate an explanation.',
  panelHint: 'Hint',
  panelExplain: 'Explanation',
  readyLiveHint: 'Hint is ready.',
  readyLiveExplain: 'Explanation is ready.',
  selectionPopover: 'Selection action',
};

export function cardTutorCopy(locale: 'zh-CN' | 'en'): CardTutorCopy {
  return locale === 'en' ? EN : ZH;
}

export function primaryActionLabel(locale: 'zh-CN' | 'en', face: FlashcardTutorFace): string {
  const copy = cardTutorCopy(locale);
  return face === 'front' ? copy.hint : copy.explain;
}

export function fallbackActionLabel(locale: 'zh-CN' | 'en', face: FlashcardTutorFace): string {
  const copy = cardTutorCopy(locale);
  return face === 'front' ? copy.hintCard : copy.explainCard;
}
