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
import {
  BranchesSheet,
  HandoffSheet,
  HistorySheet,
  HostSheet,
  ManualConnectSheet,
  PairingSheet,
  ProjectsSheet,
  RenameSheet,
  SearchSheet,
  SessionMenuSheet,
  TrustSheet,
  WorkspacePickerSheet,
} from './session-sheets.js';
import { NotificationsSheet } from './notifications-sheet.js';
import { AttentionCatchUpSheet } from './attention-catch-up-sheet.js';
import {
  CommentSheet,
  ExecutePlanSheet,
  GoalSheet,
  InterveneSheet,
  PermissionSheet,
  ReviewOptionsSheet,
  SubagentOutputSheet,
  SubagentSheet,
} from './decision-sheets.js';
import {
  ArtifactSourceSheet,
  AssetSheet,
  CardOptionsSheet,
  ConsoleSheet,
  FileSheet,
  FolderSheet,
  MediaNewSheet,
  ProduceCardsSheet,
  TerminalCommandSheet,
  WorkspaceMenuSheet,
} from './workspace-sheets.js';
import { SettingsSearchSheet, SETTINGS_SHEETS } from './settings-sheets.js';
import {
  KnowledgeSearchSheet,
  MountsSheet,
  PlanMenuSheet,
  SourceDetailSheet,
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
  attach: sheet('把上下文捎进来', AttachSheet),
  references: sheet('引用项目文件', ReferencesSheet),
  skills: sheet('已安装的技能', SkillsSheet),
  commands: sheet('常用命令', CommandsSheet),
  context: sheet('这一轮带了什么', ContextSheet),
  dictation: sheet('先说，再落笔', DictationSheet),
  'voice-settings': sheet('语音会话', VoiceSettingsSheet),
  'session-menu': sheet('这一段会话', SessionMenuSheet),
  rename: sheet('给这页换个名字', RenameSheet),
  branches: sheet('会话的来路', BranchesSheet),
  history: sheet('历史刻度', HistorySheet),
  projects: sheet('选择项目', ProjectsSheet),
  'workspace-picker': sheet('Host 工作区', WorkspacePickerSheet),
  trust: sheet('信任这个项目？', TrustSheet),
  search: sheet('找一段思路', SearchSheet),
  handoff: sheet('在桌面接着写', HandoffSheet),
  host: sheet('连着自己的书案', HostSheet),
  pairing: sheet('扫描桌面配对码', PairingSheet),
  'manual-connect': sheet('手动连接', ManualConnectSheet),
  notifications: sheet('只在需要时，来敲门', NotificationsSheet),
  'attention-catch-up': sheet('离开这段时间', AttentionCatchUpSheet),
  permission: sheet('读清楚，再批准', PermissionSheet),
  'execute-plan': sheet('让计划开始工作', ExecutePlanSheet),
  subagent: sheet('test-runner', SubagentSheet),
  'subagent-output': sheet('子代理的工作记录', SubagentOutputSheet),
  intervene: sheet('补充一条要求', InterveneSheet),
  goal: sheet('持续目标', GoalSheet),
  comment: sheet('在这一行，留一笔', CommentSheet),
  'review-options': sheet('审阅选项', ReviewOptionsSheet),
  'workspace-menu': sheet('展开哪一页？', WorkspaceMenuSheet),
  folder: sheet('项目目录', FolderSheet),
  file: sheet('session-index.ts', FileSheet),
  'terminal-command': sheet('让 Agent 执行', TerminalCommandSheet),
  console: sheet('浏览器控制台', ConsoleSheet),
  'artifact-source': sheet('Artifact 源码', ArtifactSourceSheet),
  'card-options': sheet('怎样读这叠卡片', CardOptionsSheet),
  'produce-cards': sheet('从文件里，留下一点知识', ProduceCardsSheet),
  asset: sheet('资料详情', AssetSheet),
  'media-new': sheet('想生成什么？', MediaNewSheet),
  'plan-menu': sheet('当前计划', PlanMenuSheet),
  mounts: sheet('会话知识库挂载', MountsSheet),
  'knowledge-search': sheet('搜索知识库', KnowledgeSearchSheet),
  'wiki-new': sheet('录入新维基条目', WikiNewSheet),
  'source-detail': sheet('信源详情', SourceDetailSheet),
  'wiki-menu': sheet('词条操作', WikiMenuSheet),
  'settings-search': sheet('查找设置', SettingsSearchSheet),
};

for (const [key, definition] of Object.entries(SETTINGS_SHEETS)) {
  SHEETS[key] = { title: definition.title, render: () => definition.render() };
}
