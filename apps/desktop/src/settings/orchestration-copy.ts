/**
 * Bilingual copy for Settings → orchestration schemes.
 *
 * Kept out of the page and the editor so the two views share one dictionary
 * instead of re-listing every key when passing props down.
 */
export type OrchestrationCopy = {
  /* Page chrome */
  title: string;
  pageDescription: string;
  noModels: string;
  schemeCount: (count: number) => string;
  roleCount: (count: number) => string;

  /* List */
  schemeNew: string;
  schemeEdit: string;
  schemeClone: string;
  schemeCloneSaved: string;
  schemeClonedSuffix: string;
  schemeDelete: string;
  schemeResetBuiltin: string;
  schemeSourceBuiltin: string;
  schemeSourceOverridden: string;
  schemeSourceSettings: string;
  schemeOpenHint: string;
  deleteConfirmTitle: string;
  deleteConfirmBody: string;
  resetConfirmTitle: string;
  resetConfirmBody: string;
  confirmCancel: string;

  /* Detail shell */
  backToList: string;
  detailEditTitle: string;
  detailNewTitle: string;
  schemeSave: string;
  schemeSaved: string;
  schemeCancel: string;

  /* Sections */
  sectionBasics: string;
  sectionRoster: string;
  sectionDispatch: string;
  schemeName: string;
  schemeId: string;
  schemeIdHint: string;
  schemeDesc: string;
  schemeDescHint: string;
  schemeDiscipline: string;
  schemeDisciplineHint: string;

  /* Roster */
  rosterHint: string;
  schemeAddMember: string;
  schemeAddFromTemplate: string;
  schemeRole: string;
  schemeRoleDesc: string;
  schemeRoleDescPlaceholder: string;
  schemeMemberModel: string;
  schemeModelInherit: string;
  schemeThinking: string;
  schemeThinkingInherit: string;
  schemeIsolation: string;
  schemeIsolationReadonly: string;
  schemeIsolationWorktree: string;
  schemeFallback: string;
  schemeFallbackMain: string;
  schemeFallbackNone: string;
  schemeDefaultRoleBadge: string;
  schemeSetDefaultRole: string;
  schemeDefaultRoleHint: string;
  schemeRemoveMember: string;
  schemeCheapModelHint: string;

  /* Dispatch options */
  schemeExposeTitle: string;
  schemeExposeHint: string;
  schemeAdvanced: string;
  schemeMaxConcurrency: string;
  schemeMaxTasks: string;
  schemeMaxThinking: string;
  schemeMaxThinkingInherit: string;

  /* Validation */
  schemeInvalidId: string;
  schemeInvalidRole: string;
  schemeNeedMember: string;
  schemeIncomplete: string;

  /* Global limits */
  advancedTitle: string;
  advancedHint: string;
  maxConcurrency: string;
  maxConcurrencyHint: string;
  maxTasksPerRun: string;
  saveAdvanced: string;
  saved: string;
  saveFailed: string;
  cloneFailed: string;
  loading: string;
};

const ZH: OrchestrationCopy = {
  title: '子代理编排',
  pageDescription:
    '为主智能体预置一组可调用的子代理角色。写清每个角色的职责与可选模型，主智能体便会按任务目标自主分派；发送消息时选择方案，选「无」则仅由主智能体执行。',
  noModels: '尚未配置模型。请先在「模型」页面添加服务商。',
  schemeCount: (count) => `${count} 个方案`,
  roleCount: (count) => `${count} 个角色`,

  schemeNew: '新建方案',
  schemeEdit: '编辑',
  schemeClone: '克隆',
  schemeCloneSaved: '已克隆并保存',
  schemeClonedSuffix: '（副本）',
  schemeDelete: '删除',
  schemeResetBuiltin: '恢复默认',
  schemeSourceBuiltin: '内置',
  schemeSourceOverridden: '已修改',
  schemeSourceSettings: '自定义',
  schemeOpenHint: '打开并编辑该方案',
  deleteConfirmTitle: '删除方案',
  deleteConfirmBody: '删除后使用该方案的会话将回到「无」。此操作不可撤销。',
  resetConfirmTitle: '恢复内置方案',
  resetConfirmBody: '将丢弃你对该内置方案的全部修改，恢复到应用自带版本。',
  confirmCancel: '取消',

  backToList: '全部方案',
  detailEditTitle: '编辑方案',
  detailNewTitle: '新建方案',
  schemeSave: '保存方案',
  schemeSaved: '方案已保存',
  schemeCancel: '取消',

  sectionBasics: '基础信息',
  sectionRoster: '子代理角色',
  sectionDispatch: '调度选项',
  schemeName: '名称',
  schemeId: 'ID',
  schemeIdHint: '小写字母、数字与连字符',
  schemeDesc: '简介',
  schemeDescHint: '一句话说明这个方案适合什么任务，会显示在方案选择器里。',
  schemeDiscipline: '编排规则',
  schemeDisciplineHint: '注入主智能体的规则：何时派发、是否等待结果、调用层级限制等。',

  rosterHint: '主智能体依据「职责描述」决定何时调用哪个角色，描述越具体分派越准。',
  schemeAddMember: '添加角色',
  schemeAddFromTemplate: '快捷添加',
  schemeRole: '角色 ID',
  schemeRoleDesc: '职责描述',
  schemeRoleDescPlaceholder:
    '例如：只读调研，定位符号与调用关系，返回带 file:line 的证据报告，不修改文件。',
  schemeMemberModel: '模型',
  schemeModelInherit: '继承主会话',
  schemeThinking: '思考',
  schemeThinkingInherit: '默认',
  schemeIsolation: '工作区',
  schemeIsolationReadonly: '只读',
  schemeIsolationWorktree: '独立工作区 (Worktree)',
  schemeFallback: '不可用时',
  schemeFallbackMain: '主智能体执行',
  schemeFallbackNone: '返回错误',
  schemeDefaultRoleBadge: '默认角色',
  schemeSetDefaultRole: '设为默认',
  schemeDefaultRoleHint: '主智能体未指定 role 时使用该角色',
  schemeRemoveMember: '移除',
  schemeCheapModelHint: '调研类角色建议选用轻量、低延迟的模型；留空则跟随主会话模型。',

  schemeExposeTitle: '允许主智能体指定模型与思考档位',
  schemeExposeHint: '关闭后派发参数由本方案固定，主智能体只看到角色名。',
  schemeAdvanced: '本方案上限（可选）',
  schemeMaxConcurrency: '并发上限',
  schemeMaxTasks: '任务上限',
  schemeMaxThinking: '子代理思考上限',
  schemeMaxThinkingInherit: '不限制',

  schemeInvalidId: 'ID 须为小写字母、数字与连字符',
  schemeInvalidRole: '角色 ID 非法或重复',
  schemeNeedMember: '至少要有一个带职责描述的角色',
  schemeIncomplete: '名称、简介、编排规则和每个角色的职责都不能为空',

  advancedTitle: '全局并行上限',
  advancedHint: '对所有方案生效，方案自己的上限不会超过这里。',
  maxConcurrency: '最大并发任务数',
  maxConcurrencyHint: '该值 + 1 为工作进程池容量，上限 8，保存后立即生效',
  maxTasksPerRun: '单轮派发任务上限',
  saveAdvanced: '保存上限',
  saved: '已保存',
  saveFailed: '保存失败',
  cloneFailed: '克隆失败',
  loading: '正在加载配置…',
};

const EN: OrchestrationCopy = {
  title: 'Orchestration',
  pageDescription:
    'Give the main agent a roster of named subagent roles. Describe each duty (and optionally pin a model); the main agent decides who to call. Pick a scheme in Composer — "None" keeps everything on the main agent.',
  noModels: 'No models configured. Add a provider under Models first.',
  schemeCount: (count) => `${count} scheme${count === 1 ? '' : 's'}`,
  roleCount: (count) => `${count} role${count === 1 ? '' : 's'}`,

  schemeNew: 'New scheme',
  schemeEdit: 'Edit',
  schemeClone: 'Clone',
  schemeCloneSaved: 'Cloned and saved',
  schemeClonedSuffix: ' (copy)',
  schemeDelete: 'Delete',
  schemeResetBuiltin: 'Reset default',
  schemeSourceBuiltin: 'Bundled',
  schemeSourceOverridden: 'Modified',
  schemeSourceSettings: 'Custom',
  schemeOpenHint: 'Open this scheme',
  deleteConfirmTitle: 'Delete scheme',
  deleteConfirmBody: 'Sessions using it fall back to "None". This cannot be undone.',
  resetConfirmTitle: 'Reset bundled scheme',
  resetConfirmBody: 'Discards every change you made and restores the version shipped with the app.',
  confirmCancel: 'Cancel',

  backToList: 'All schemes',
  detailEditTitle: 'Edit scheme',
  detailNewTitle: 'New scheme',
  schemeSave: 'Save scheme',
  schemeSaved: 'Scheme saved',
  schemeCancel: 'Cancel',

  sectionBasics: 'Basics',
  sectionRoster: 'Subagent roles',
  sectionDispatch: 'Dispatch options',
  schemeName: 'Name',
  schemeId: 'ID',
  schemeIdHint: 'Lowercase letters, digits, hyphens',
  schemeDesc: 'Summary',
  schemeDescHint: 'One line on what this scheme is for. Shown in the scheme picker.',
  schemeDiscipline: 'Main discipline',
  schemeDisciplineHint:
    'Injected into the main agent: when to delegate, whether to wait for results, nesting limits.',

  rosterHint:
    'The main agent picks a role from its duty text — the more concrete the duty, the better the routing.',
  schemeAddMember: 'Add role',
  schemeAddFromTemplate: 'Quick add',
  schemeRole: 'Role ID',
  schemeRoleDesc: 'Duty',
  schemeRoleDescPlaceholder:
    'e.g. Read-only scout: locate symbols and call paths, return evidence with file:line, never edit files.',
  schemeMemberModel: 'Model',
  schemeModelInherit: 'Inherit main session',
  schemeThinking: 'Thinking',
  schemeThinkingInherit: 'Default',
  schemeIsolation: 'Workspace',
  schemeIsolationReadonly: 'Read-only',
  schemeIsolationWorktree: 'Worktree',
  schemeFallback: 'If unavailable',
  schemeFallbackMain: 'Main agent does it',
  schemeFallbackNone: 'Fail',
  schemeDefaultRoleBadge: 'Default role',
  schemeSetDefaultRole: 'Make default',
  schemeDefaultRoleHint: 'Used when the main agent omits a role',
  schemeRemoveMember: 'Remove',
  schemeCheapModelHint:
    'Pin a cheaper model on scout roles when possible; empty may match main model cost.',

  schemeExposeTitle: 'Let the main agent set model and thinking',
  schemeExposeHint: 'When off, spawn parameters are fixed here and the main agent only sees roles.',
  schemeAdvanced: 'Scheme caps (optional)',
  schemeMaxConcurrency: 'Concurrency cap',
  schemeMaxTasks: 'Task cap',
  schemeMaxThinking: 'Subagent thinking cap',
  schemeMaxThinkingInherit: 'No cap',

  schemeInvalidId: 'ID must be lowercase letters, digits, hyphens',
  schemeInvalidRole: 'Invalid or duplicate role id',
  schemeNeedMember: 'Need at least one role with a duty description',
  schemeIncomplete: 'Name, summary, discipline, and every role duty are required',

  advancedTitle: 'Global concurrency',
  advancedHint: 'Applies to every scheme; a scheme cap never exceeds these.',
  maxConcurrency: 'Max running at once',
  maxConcurrencyHint: 'This value + 1 is the worker process pool (cap 8). Saves apply immediately.',
  maxTasksPerRun: 'Max per dispatch',
  saveAdvanced: 'Save limits',
  saved: 'Saved',
  saveFailed: 'Save failed',
  cloneFailed: 'Clone failed',
  loading: 'Loading configuration…',
};

export function buildOrchestrationCopy(isChinese: boolean): OrchestrationCopy {
  return isChinese ? ZH : EN;
}
