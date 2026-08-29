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
  saveCard: string;
  savedCard: string;
  cancelDraft: string;
  duplicateCard: string;
  emptyFrontBack: string;
  hostUnavailable: string;
  saveFailed: string;
  draftDeck: string;
  draftFront: string;
  draftFrontPlaceholder: string;
  draftBack: string;
  draftBackPlaceholder: string;
  retry: string;
  close: string;
  flipAnswer: string;
  flipQuestion: string;
  modelUnavailable: string;
  settingsFallback: string;
  chatFallback: string;
  errorGeneric: string;
  errorInvalid: string;
  errorNotFound: string;
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
  saveCard: '保存卡片',
  savedCard: '已存入闪卡',
  cancelDraft: '取消',
  duplicateCard: '已存在相似卡片',
  emptyFrontBack: '正面和背面不能为空',
  hostUnavailable: 'Host 不可用，无法保存闪卡。',
  saveFailed: '无法保存闪卡。',
  draftDeck: '所属卡组',
  draftFront: '正面（问题）',
  draftFrontPlaceholder: '输入问题…',
  draftBack: '背面（答案）',
  draftBackPlaceholder: '输入答案与解析…',
  retry: '重试',
  close: '关闭',
  flipAnswer: '查看答案',
  flipQuestion: '翻看提问',
  modelUnavailable: '当前没有可用的模型来生成讲解。',
  settingsFallback: '请到设置中配置对话模型。',
  chatFallback: '也可以在聊天中询问。',
  errorGeneric: '无法生成讲解。',
  errorInvalid: '选区无效，请重新选择。',
  errorNotFound: '找不到这张卡片。',
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
  saveCard: 'Save card',
  savedCard: 'Saved to flashcards',
  cancelDraft: 'Cancel',
  duplicateCard: 'A similar card already exists',
  emptyFrontBack: 'Front and back cannot be empty',
  hostUnavailable: 'Host is unavailable, so this card could not be saved.',
  saveFailed: 'Could not save this card.',
  draftDeck: 'Deck',
  draftFront: 'Front (question)',
  draftFrontPlaceholder: 'Enter the question…',
  draftBack: 'Back (answer)',
  draftBackPlaceholder: 'Enter the answer…',
  retry: 'Retry',
  close: 'Close',
  flipAnswer: 'Show answer',
  flipQuestion: 'Show question',
  modelUnavailable: 'No model is available for this explanation.',
  settingsFallback: 'Open Settings to configure a chat model.',
  chatFallback: 'You can also ask in chat.',
  errorGeneric: 'Could not generate an explanation.',
  errorInvalid: 'That selection is not valid. Try again.',
  errorNotFound: 'This card could not be found.',
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

export function tutorErrorMessage(copy: CardTutorCopy, code: string | null | undefined): string {
  switch (code) {
    case 'flashcard-selection-model-unavailable':
      return copy.modelUnavailable;
    case 'flashcard-selection-invalid':
      return copy.errorInvalid;
    case 'flashcard-not-found':
      return copy.errorNotFound;
    case 'flashcard-draft-empty':
      return copy.emptyFrontBack;
    case 'flashcard-draft-duplicate':
      return copy.duplicateCard;
    case 'flashcard-draft-host-unavailable':
      return copy.hostUnavailable;
    case 'flashcard-draft-failed':
      return copy.saveFailed;
    default:
      return copy.errorGeneric;
  }
}
