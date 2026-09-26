import type { ReactElement } from 'react';
import {
  AttachSheet,
  CommandsSheet,
  ContextSheet,
  DictationSheet,
  ModeSheet,
  ModelSheet,
  ReferencesSheet,
  SchemeSheet,
  SkillsSheet,
  VoiceSettingsSheet,
} from './composer-sheets.js';
import { HistorySheet, RenameSheet, SessionMenuSheet } from './session-sheets.js';
import { BranchesSheet } from './session-branch-sheets.js';
import {
  DraftProjectSheet,
  ProjectsSheet,
  SearchSheet,
  WorkspacePickerSheet,
} from './session-nav-sheets.js';
import { HostSheet } from './host-connection-sheets.js';
import { NotificationsSheet } from './notifications-sheet.js';
import { AttentionCatchUpSheet } from './attention-catch-up-sheet.js';
import {
  CommentSheet,
  ExecutePlanSheet,
  InterveneSheet,
  PermissionSheet,
  ReviewOptionsSheet,
  SubagentOutputSheet,
  SubagentSheet,
} from './decision-sheets.js';
import {
  ProduceCardsSheet,
  WorkspaceMenuSheet,
} from './workspace-sheets.js';
import { SettingsSearchSheet, SETTINGS_SHEETS } from './settings-sheets.js';
import {
  KnowledgeSearchSheet,
  MountsSheet,
  PlanMenuSheet,
  WikiMenuSheet,
  WikiNewSheet,
} from './knowledge-sheets.js';

export interface SheetDefinition {
  title: string;
  render: () => ReactElement;
}

const sheet = (title: string, Component: () => ReactElement): SheetDefinition => ({
  title,
  render: () => <Component />,
});

export const SHEETS: Record<string, SheetDefinition> = {
  model: sheet('模型与思考', ModelSheet),
  mode: sheet('运行与编排', ModeSheet),
  scheme: sheet('子代理编排', SchemeSheet),
  attach: sheet('添加到这一轮', AttachSheet),
  references: sheet('引用项目文件', ReferencesSheet),
  skills: sheet('已安装的技能', SkillsSheet),
  commands: sheet('常用命令', CommandsSheet),
  context: sheet('这一轮带了什么', ContextSheet),
  dictation: sheet('语音输入', DictationSheet),
  'voice-settings': sheet('语音会话', VoiceSettingsSheet),
  'session-menu': sheet('会话', SessionMenuSheet),
  rename: sheet('重命名', RenameSheet),
  branches: sheet('分叉与来路', BranchesSheet),
  history: sheet('消息历史', HistorySheet),
  projects: sheet('选择项目', ProjectsSheet),
  'draft-project': sheet('在哪个项目里工作', DraftProjectSheet),
  'workspace-picker': sheet('Host 工作区', WorkspacePickerSheet),
  search: sheet('搜索会话', SearchSheet),
  host: sheet('Host 连接', HostSheet),
  notifications: sheet('通知', NotificationsSheet),
  'attention-catch-up': sheet('离开这段时间', AttentionCatchUpSheet),
  permission: sheet('批准这项操作', PermissionSheet),
  'execute-plan': sheet('让计划开始工作', ExecutePlanSheet),
  subagent: sheet('test-runner', SubagentSheet),
  'subagent-output': sheet('子代理的工作记录', SubagentOutputSheet),
  intervene: sheet('补充一条要求', InterveneSheet),
  comment: sheet('在这一行，留一笔', CommentSheet),
  'review-options': sheet('审阅选项', ReviewOptionsSheet),
  'workspace-menu': sheet('展开哪一页？', WorkspaceMenuSheet),
  'produce-cards': sheet('从文件里，留下一点知识', ProduceCardsSheet),
  'plan-menu': sheet('当前计划', PlanMenuSheet),
  mounts: sheet('会话知识库挂载', MountsSheet),
  'knowledge-search': sheet('搜索知识库', KnowledgeSearchSheet),
  'wiki-new': sheet('录入新维基条目', WikiNewSheet),
  'wiki-menu': sheet('词条操作', WikiMenuSheet),
  'settings-search': sheet('查找设置', SettingsSearchSheet),
};

for (const [key, definition] of Object.entries(SETTINGS_SHEETS)) {
  SHEETS[key] = { title: definition.title, render: () => definition.render() };
}
