export type MobileFlashcardStudyCopy = {
  backCatalog: string;
  backChat: string;
  catalogTitle: string;
  unnamedDeck: string;
  question: string;
  answer: string;
  next: string;
  lastCard: string;
  pause: string;
  resume: string;
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
  continueRound: string;
  sequenceTitle: string;
  scheduledTitle: string;
  allScope: string;
  searchPlaceholder: string;
  dueDue: (count: number) => string;
  dueNew: (count: number) => string;
  unfinished: (processed: number, total: number) => string;
  saving: string;
  saved: string;
  pending: string;
  pausedTitle: string;
  pausedBody: string;
  disconnected: string;
  pendingConfirmation: string;
  readOnly: string;
  claim: string;
  hostTooOld: string;
  hostTooOldBody: string;
  notConnected: string;
  notConnectedBody: string;
  roundMissing: string;
  roundMissingBody: string;
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
  emptyCatalogTitle: string;
  emptyCatalogBody: string;
  enterStudy: string;
  sourceHint: string;
  loadMore: string;
  saveStatus: (kind: 'saving' | 'saved' | 'pending') => string;
};

export const MOBILE_FLASHCARD_STUDY_COPY: MobileFlashcardStudyCopy = {
  backCatalog: '返回卡库',
  backChat: '返回',
  catalogTitle: '闪卡',
  unnamedDeck: '闪卡',
  question: '提问',
  answer: '解答',
  next: '下一张',
  lastCard: '结束浏览',
  pause: '暂停',
  resume: '继续',
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
  continueRound: '继续',
  sequenceTitle: '顺序复习',
  scheduledTitle: '待复习',
  allScope: '全部',
  searchPlaceholder: '搜索卡套或预览…',
  dueDue: (count) => `到期 ${count}`,
  dueNew: (count) => `新 ${count}`,
  unfinished: (processed, total) => `未完成 ${processed}/${total}`,
  saving: '保存中',
  saved: '已保存',
  pending: '待确认',
  pausedTitle: '已暂停',
  pausedBody: '题面已隐藏。继续后回到同一张卡。',
  disconnected: '已断开 Host，进度仍保留。',
  pendingConfirmation: '结果待确认，重连后核对。',
  readOnly: '已在另一设备继续。',
  claim: '在本设备继续',
  hostTooOld: '需要更新 Host',
  hostTooOldBody: '当前 Host 没有复习台能力，无法在手机上开始学习。',
  notConnected: '未连接 Host',
  notConnectedBody: '第一版需要在线学习。连接 Host 后再打开闪卡。',
  roundMissing: '找不到这一轮',
  roundMissingBody: '该轮次在 Host 上不存在或已经失效。',
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
  emptyCatalogTitle: '还没有闪卡',
  emptyCatalogBody: '连接同一 Host 后可读取卡库。生成与管理仍在电脑上进行。',
  enterStudy: '进入复习台',
  sourceHint: '可查看摘录；完整来源需在电脑查看',
  loadMore: '加载更多',
  saveStatus: (kind) => (kind === 'saving' ? '保存中' : kind === 'pending' ? '待确认' : '已保存'),
};
