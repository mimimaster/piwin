/**
 * One-line answer to "will my next session get code_search?" for the
 * Settings → Code search header. Pure so every branch is unit-tested; the page
 * only feeds it facts.
 */
export type CodeSearchStatusTone = 'off' | 'blocked' | 'pending' | 'ready';

export type CodeSearchStatus = {
  tone: CodeSearchStatusTone;
  title: string;
  detail: string;
};

export type CodeSearchStatusFacts = {
  enabled: boolean;
  persistedEnabled: boolean;
  dirty: boolean;
  /** What still blocks the chosen engine, already phrased for the user. */
  missingStep: string | undefined;
};

export function describeCodeSearchStatus(facts: CodeSearchStatusFacts, zh: boolean): CodeSearchStatus {
  if (!facts.enabled) {
    return {
      tone: 'off',
      title: zh ? '已关闭' : 'Off',
      detail: facts.persistedEnabled
        ? zh
          ? '保存后，新会话中将不会出现 code_search。'
          : 'After saving, new sessions will not get code_search.'
        : zh
          ? '会话中不会出现 code_search。选好可用的搜索引擎会自动开启。'
          : 'Sessions will not get code_search. Picking a ready engine turns it on.',
    };
  }
  if (facts.missingStep) {
    return { tone: 'blocked', title: zh ? '还差一步' : 'One step left', detail: facts.missingStep };
  }
  if (facts.dirty || !facts.persistedEnabled) {
    return {
      tone: 'pending',
      title: zh ? '待保存' : 'Unsaved',
      detail: zh
        ? '保存后生效：新会话立即可用，进行中的会话在本轮结束后更新。'
        : 'Takes effect on save: new sessions get it immediately, running ones after the current turn.',
    };
  }
  return {
    tone: 'ready',
    title: zh ? '已生效' : 'Active',
    detail: zh
      ? '代理会优先用 code_search 定位相关文件与行号。'
      : 'The agent reaches for code_search first to locate relevant files and lines.',
  };
}
