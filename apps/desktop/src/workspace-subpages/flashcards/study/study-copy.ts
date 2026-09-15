export type FlashcardStudyCopy = {
  back: string;
  unnamedDeck: string;
  question: string;
  answer: string;
  next: string;
  lastCard: string;
  undo: string;
  endRound: string;
  endRoundTitle: string;
  endRoundBody: string;
  endRoundConfirm: string;
  cancel: string;
  close: string;
  needsReview: string;
  needsReviewOn: string;
  newRound: string;
  reinforce: string;
  due: string;
  sequenceTitle: string;
  scheduledTitle: string;
  dueDue: (count: number) => string;
  dueNew: (count: number) => string;
  saving: string;
  saved: string;
  pending: string;
  disconnected: string;
  pendingConfirmation: string;
  readOnly: string;
  claim: string;
  hostTooOld: string;
  again: string;
  hard: string;
  good: string;
  easy: string;
  sibling: (ordinal: number, count: number) => string;
  sequenceCompletedTitle: string;
  sequenceCompleted: (browsed: number, needsReview: number) => string;
  scheduledCompletedTitle: string;
  scheduledCompleted: (count: number) => string;
  endedTitle: string;
  endedBody: (processed: number, remaining: number) => string;
  emptyTitle: string;
  emptyBody: string;
  keyRequired: string;
  genericError: string;
  saveStatus: (kind: 'saving' | 'saved' | 'pending') => string;
};

const ZH: FlashcardStudyCopy = {
  back: '返回卡库',
  unnamedDeck: '闪卡',
  question: '提问',
  answer: '解答',
  next: '下一张',
  lastCard: '结束浏览',
  undo: '撤销',
  endRound: '结束本轮',
  endRoundTitle: '结束本轮？',
  endRoundBody: '已提交的进度会保留，未学项不计完成。',
  endRoundConfirm: '结束本轮',
  cancel: '取消',
  close: '关闭',
  needsReview: '标记需再看',
  needsReviewOn: '已标需再看',
  newRound: '新一轮',
  reinforce: '巩固子集',
  due: '待复习',
  sequenceTitle: '顺序复习',
  scheduledTitle: '待复习',
  dueDue: (count) => `到期 ${count}`,
  dueNew: (count) => `新 ${count}`,
  saving: '保存中',
  saved: '已保存',
  pending: '待确认',
  disconnected: '已断开 Host，进度仍保留。',
  pendingConfirmation: '结果待确认，重连后核对。',
  readOnly: '已在另一设备继续。',
  claim: '在本设备继续',
  hostTooOld: '需要更新 Host',
  again: '忘了',
  hard: '较难',
  good: '记住了',
  easy: '简单',
  sibling: (ordinal, count) => `同卡第 ${ordinal} 题 / ${count}`,
  sequenceCompletedTitle: '本套已浏览完',
  sequenceCompleted: (browsed, needsReview) =>
    needsReview > 0 ? `已浏览 ${browsed} 张，需再看 ${needsReview} 张` : `已浏览 ${browsed} 张`,
  scheduledCompletedTitle: '本轮已复习完',
  scheduledCompleted: (count) => `本轮已复习 ${count} 题`,
  endedTitle: '本轮已结束',
  endedBody: (processed, remaining) =>
    remaining > 0 ? `已处理 ${processed}，未学 ${remaining}` : `已处理 ${processed}`,
  emptyTitle: '这一轮没有卡片',
  emptyBody: '当前范围没有可学的卡片。',
  keyRequired: '这一轮没能开始，请返回卡库后再试一次。',
  genericError: '复习出了点问题，请返回卡库后再试。',
  saveStatus: (kind) => (kind === 'saving' ? '保存中' : kind === 'pending' ? '待确认' : '已保存'),
};

const EN: FlashcardStudyCopy = {
  back: 'Back to cards',
  unnamedDeck: 'Card',
  question: 'Question',
  answer: 'Answer',
  next: 'Next',
  lastCard: 'End browsing',
  undo: 'Undo',
  endRound: 'End round',
  endRoundTitle: 'End this round?',
  endRoundBody: 'Submitted progress is kept. Unstudied cards will not count as completed.',
  endRoundConfirm: 'End round',
  cancel: 'Cancel',
  close: 'Close',
  needsReview: 'Mark for later',
  needsReviewOn: 'Marked for later',
  newRound: 'New round',
  reinforce: 'Review marked cards',
  due: 'Due',
  sequenceTitle: 'Browse',
  scheduledTitle: 'Due',
  dueDue: (count) => `${count} due`,
  dueNew: (count) => `${count} new`,
  saving: 'Saving',
  saved: 'Saved',
  pending: 'Pending',
  disconnected: 'Host disconnected. Saved progress is kept.',
  pendingConfirmation: 'Result pending confirmation. It will be reconciled on reconnect.',
  readOnly: 'Continued on another device.',
  claim: 'Continue on this device',
  hostTooOld: 'Host update required',
  again: 'Again',
  hard: 'Hard',
  good: 'Good',
  easy: 'Easy',
  sibling: (ordinal, count) => `Card item ${ordinal} of ${count}`,
  sequenceCompletedTitle: 'Finished browsing this set',
  sequenceCompleted: (browsed, needsReview) =>
    needsReview > 0
      ? `Browsed ${browsed} cards, ${needsReview} marked for later`
      : `Browsed ${browsed} cards`,
  scheduledCompletedTitle: 'Round complete',
  scheduledCompleted: (count) => `Reviewed ${count} cards this round`,
  endedTitle: 'Round ended',
  endedBody: (processed, remaining) =>
    remaining > 0
      ? `Processed ${processed}, ${remaining} left unstudied`
      : `Processed ${processed}`,
  emptyTitle: 'No cards in this round',
  emptyBody: 'Nothing to study in the current scope.',
  keyRequired: 'This round could not start. Go back to the library and try again.',
  genericError: 'Study hit a problem. Go back to the library and try again.',
  saveStatus: (kind) => (kind === 'saving' ? 'Saving' : kind === 'pending' ? 'Pending' : 'Saved'),
};

export function flashcardStudyCopy(locale: 'zh-CN' | 'en'): FlashcardStudyCopy {
  return locale === 'en' ? EN : ZH;
}

const MACHINE_CODE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

/** Host problem codes must not land in the study chrome as raw kebab-case. */
export function flashcardStudyErrorMessage(
  error: { code: string; message: string },
  copy: FlashcardStudyCopy,
): string {
  if (error.code === 'idempotency-key-required' || error.message === 'idempotency-key-required') {
    return copy.keyRequired;
  }
  if (error.code === 'host-too-old') return copy.hostTooOld;
  if (error.message.length === 0 || MACHINE_CODE.test(error.message)) {
    return copy.genericError;
  }
  return error.message;
}
