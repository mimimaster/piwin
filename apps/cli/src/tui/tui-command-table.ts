import type { TuiArtifactController } from './tui-artifact-controller.js';
import type { TuiAttachmentController } from './tui-attachment-controller.js';
import type { TuiBranchController } from './tui-branch-controller.js';
import { TUI_COMMAND_NAMES, TUI_SLASH_COMMANDS } from './tui-commands.js';
import type { TuiComposerProfile } from './tui-composer-profile.js';
import type { TuiPlanController } from './tui-plan-controller.js';
import type { TuiQueueController } from './tui-queue-controller.js';
import type { TuiSessionExport } from './tui-session-export.js';
import type { TuiSessionSearch } from './tui-session-search.js';
import type { TuiSessionSwitcher } from './tui-session-switcher.js';
import type { TuiSideChatController } from './tui-side-chat-controller.js';
import type { TuiSubagentController } from './tui-subagent-controller.js';
import type { TuiTurnActions } from './tui-turn-actions.js';
import type { TuiTurnChangeController } from './tui-turn-change-controller.js';
import type { TuiWalkthroughController } from './tui-walkthrough-controller.js';

type CommandHandler = (argument: string) => void | Promise<void>;

export type TuiCommandTableDeps = {
  /** Desktop owns session switching when the TUI is embedded. */
  embedded: boolean;
  composer: TuiComposerProfile;
  attachments: TuiAttachmentController;
  plans: TuiPlanController;
  queue: TuiQueueController;
  branches: TuiBranchController;
  subagents: TuiSubagentController;
  turnChanges: TuiTurnChangeController;
  walkthroughs: TuiWalkthroughController;
  sideChat: TuiSideChatController;
  artifacts: TuiArtifactController;
  turns: TuiTurnActions;
  sessionSwitcher: TuiSessionSwitcher;
  sessionExport: TuiSessionExport;
  sessionSearch: TuiSessionSearch;
  startDraftSession: () => void;
  loadOlderMessages: () => Promise<void>;
  /** With a name: rename now. Without: ask for one. */
  renameSession: (name: string) => Promise<void>;
  /** Stop the running turn and run this text instead. */
  sendReplacingRun: (text: string) => Promise<void>;
  setComposerText: (text: string) => void;
  hint: (text: string) => void;
  notice: (tone: 'info' | 'error', text: string) => void;
  exit: () => void;
};

const SHORTCUT_HELP =
  'Ctrl+S 会话 · Shift+Tab 权限模式 · Ctrl+V 粘贴图片 · @ 引用文件 · 运行中发送即排队 · Ctrl+O 展开工具输出 · Esc 中断 · Ctrl+C 两次退出 · Shift+Enter 换行';

/** Slash command name → what it does. One entry per row of TUI_SLASH_COMMANDS. */
export function createTuiCommandTable(deps: TuiCommandTableDeps): (name: string, argument: string) => Promise<void> {
  const { composer, attachments, plans, queue, branches, turns } = deps;
  const standaloneOnly = (handler: CommandHandler): CommandHandler =>
    deps.embedded ? () => deps.hint('内嵌模式下请用 Desktop 侧栏切换会话') : handler;

  const handlers: Record<string, CommandHandler> = {
    sessions: standaloneOnly(() => deps.sessionSwitcher.open()),
    new: standaloneOnly(() => deps.startDraftSession()),
    model: () => composer.openModelPicker(),
    thinking: () => composer.openThinkingPicker(),
    permission: () => composer.openPermissionPicker(),
    prompts: () => composer.openPromptPicker(TUI_COMMAND_NAMES, (name) => deps.setComposerText(`/${name} `)),
    skill: () => composer.openSkillPicker(),
    queue: () => queue.open(),
    steer: (argument) => turns.steer(argument),
    replace: (argument) =>
      argument.length === 0 ? deps.hint('用法：/replace <要改为执行的话>') : deps.sendReplacingRun(argument),
    side: (argument) => deps.sideChat.open(argument),
    back: () => deps.sideChat.back(),
    sync: () => deps.sideChat.sync(),
    handoff: () => deps.sideChat.handoffLatest(),
    plan: () => plans.open(),
    subagents: () => deps.subagents.open(),
    attach: (argument) => attachments.attachPaths(argument),
    paste: () => attachments.pasteClipboardImage(),
    detach: () => attachments.detach(),
    compact: (argument) => turns.compact(argument),
    retry: (argument) => turns.retry(argument === 'keep'),
    edit: () => turns.beginEditingLastTurn(),
    walkthrough: (argument) => deps.walkthroughs.open(argument === 'new'),
    artifacts: () => deps.artifacts.open(),
    changes: () => deps.turnChanges.open(),
    undo: () => deps.turnChanges.undoLatest(),
    branches: () => branches.open(),
    fork: (argument) => turns.fork(argument),
    rename: (argument) => deps.renameSession(argument),
    pin: () => deps.sessionSwitcher.toggleCurrentPin(),
    archive: () => deps.sessionSwitcher.archiveCurrent(),
    unarchive: () => deps.sessionSwitcher.unarchiveLastOrCurrent(),
    delete: () => deps.sessionSwitcher.deleteCurrent(),
    export: (argument) => deps.sessionExport.run(argument),
    search: (argument) => deps.sessionSearch.open(argument),
    older: () => deps.loadOlderMessages(),
    help: () =>
      deps.notice(
        'info',
        [...TUI_SLASH_COMMANDS.map((command) => `/${command.name}  ${command.description}`), SHORTCUT_HELP].join('\n'),
      ),
    quit: () => deps.exit(),
  };

  return async (name, argument) => {
    const handler = handlers[name];
    if (handler === undefined) {
      deps.hint(`未知命令 /${name}，/help 查看可用命令`);
      return;
    }
    await handler(argument);
  };
}
