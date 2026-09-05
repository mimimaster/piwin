/* Demo state and actions for the Inkstone mobile UI.
   Ported 1:1 from docs/design/inkstone/proto-08-mobile.html (foundation state + app.js actions).
   This round is UI-first: everything runs on local prototype data, nothing touches a Host. */

export type InkstoneRoute =
  | 'sessions'
  | 'chat'
  | 'inbox'
  | 'plan'
  | 'review'
  | 'workspace'
  | 'shelf'
  | 'cards'
  | 'voice'
  | 'settings'
  | 'settings-detail'
  | 'connect'
  | 'new'
  | 'walkthrough'
  | 'library'
  | 'automations';

export type InkstoneFace = 'paper' | 'ink';
export type InkstoneRun = 'running' | 'paused' | 'idle';
export type InkstonePermission = 'pending' | 'approved' | 'denied';

export interface InkstoneState {
  route: InkstoneRoute;
  face: InkstoneFace;
  sessionFilter: string;
  inboxFilter: string;
  workspaceTab: string;
  model: string;
  effort: string;
  mode: string;
  scheme: string;
  run: InkstoneRun;
  permission: InkstonePermission;
  planApproved: boolean;
  offline: boolean;
  draft: string;
  attachment: string;
  queue: string;
  messages: string[];
  currentTitle: string;
  cardFlipped: boolean;
  studied: number;
  browsed: number;
  freshSession: boolean;
  studyMode: 'review' | 'browse';
  reviewDone: boolean;
  muted: boolean;
  libraryFilter: string;
  pinned: boolean;
  archived: boolean;
  notifications: boolean;
  handoff: boolean;
  comment: string;
  note: string;
  selectedProject: string;
  settingsSection: string;
  sheet: string | null;
  formDrafts: Record<string, Record<string, string>>;
  toast: { seq: number; message: string };
}

export const INITIAL_INKSTONE_STATE: InkstoneState = {
  route: 'sessions',
  face: 'paper',
  sessionFilter: '全部',
  inboxFilter: '待处理',
  workspaceTab: '文件',
  model: 'Claude Sonnet',
  effort: '标准',
  mode: 'Auto',
  scheme: '单 Agent',
  run: 'running',
  permission: 'pending',
  planApproved: false,
  offline: false,
  draft: '',
  attachment: '',
  queue: '',
  messages: [],
  currentTitle: '让会话拥有记忆',
  cardFlipped: false,
  studied: 0,
  browsed: 0,
  freshSession: false,
  studyMode: 'review',
  reviewDone: false,
  muted: false,
  libraryFilter: '全部',
  pinned: false,
  archived: false,
  notifications: true,
  handoff: true,
  comment: '',
  note: '把每次对话当成一张纸。\n\n状态在页边，内容在中央。\n朱色只留给真正需要我动手的地方。',
  selectedProject: 'piwin',
  settingsSection: '模型配置',
  sheet: null,
  formDrafts: {},
  toast: { seq: 0, message: '' },
};

export const OFFLINE_TOAST = '连接已断开。草稿可继续写，恢复连接后再操作。';

export type InkstoneAction =
  | { type: 'navigate'; route: InkstoneRoute }
  | { type: 'open-sheet'; key: string }
  | { type: 'close-sheet' }
  | { type: 'set-face'; face: InkstoneFace }
  | { type: 'toggle-face' }
  | { type: 'open-session'; title: string }
  | { type: 'session-filter'; value: string }
  | { type: 'inbox-filter'; value: string }
  | { type: 'library-filter'; value: string }
  | { type: 'workspace-tab'; tab: string }
  | { type: 'open-workspace'; tab: string }
  | { type: 'settings-section'; section: string }
  | { type: 'choose-model'; value: string }
  | { type: 'choose-effort'; value: string }
  | { type: 'choose-mode'; value: string }
  | { type: 'choose-scheme'; value: string }
  | { type: 'choose-project'; value: string }
  | { type: 'trust-project' }
  | { type: 'attach'; value: string }
  | { type: 'remove-attachment' }
  | { type: 'add-context'; value: string }
  | { type: 'put-draft'; value: string }
  | { type: 'command'; value: string }
  | { type: 'media-prompt'; value: string }
  | { type: 'prefill'; value: string }
  | { type: 'set-draft'; value: string }
  | { type: 'use-dictation'; value: string }
  | { type: 'terminal-draft'; value: string }
  | { type: 'send' }
  | { type: 'toggle-run' }
  | { type: 'edit-queue' }
  | { type: 'cancel-queue' }
  | { type: 'intervene'; value: string }
  | { type: 'permission'; choice: 'approved' | 'denied'; scope: string }
  | { type: 'reset-permission' }
  | { type: 'execute-plan'; mode: string }
  | { type: 'save-comment'; value: string }
  | { type: 'mark-reviewed' }
  | { type: 'reset-review' }
  | { type: 'save-note'; value: string }
  | { type: 'flip-card' }
  | { type: 'rate-card'; rating: string }
  | { type: 'reset-study' }
  | { type: 'next-card' }
  | { type: 'study-mode'; value: string }
  | { type: 'set-study-mode'; mode: 'review' | 'browse' }
  | { type: 'produce-cards' }
  | { type: 'mute-voice' }
  | { type: 'end-voice' }
  | { type: 'toggle-notifications' }
  | { type: 'toggle-handoff' }
  | { type: 'disconnect' }
  | { type: 'reconnect' }
  | { type: 'pair-demo' }
  | { type: 'manual-connect'; address: string; code: string }
  | { type: 'pin-session' }
  | { type: 'archive-session' }
  | { type: 'restore-archive' }
  | { type: 'rename-session'; title: string }
  | { type: 'switch-branch'; title: string }
  | { type: 'fork-session' }
  | { type: 'history-jump' }
  | { type: 'start-session'; text: string }
  | { type: 'regenerate' }
  | { type: 'save-demo'; values: Record<string, string>; message?: string }
  | { type: 'extension-tab'; tab: string }
  | { type: 'toast'; message: string };

function withToast(state: InkstoneState, message: string): InkstoneState {
  state.toast = { seq: state.toast.seq + 1, message };
  return state;
}

/** Prototype guard: while offline only reading and drafting are allowed. */
function online(state: InkstoneState): boolean {
  if (!state.offline) return true;
  withToast(state, OFFLINE_TOAST);
  return false;
}

function closeSheetOnly(state: InkstoneState): void {
  state.sheet = null;
}

function navigate(state: InkstoneState, route: InkstoneRoute): void {
  closeSheetOnly(state);
  state.route = route;
}

function putDraft(state: InkstoneState, text: string): void {
  state.draft = text;
  navigate(state, 'chat');
  withToast(state, '已放入砚台，可修改后再发送');
}

export function inkstoneReducer(state: InkstoneState, action: InkstoneAction): InkstoneState {
  const next: InkstoneState = {
    ...state,
    messages: [...state.messages],
    formDrafts: { ...state.formDrafts },
    toast: { ...state.toast },
  };
  switch (action.type) {
    case 'navigate':
      navigate(next, action.route);
      return next;
    case 'open-sheet':
      if (!SHEET_KEYS.has(action.key)) {
        return withToast(next, '这个入口的演示暂未定义');
      }
      next.sheet = action.key;
      return next;
    case 'close-sheet':
      closeSheetOnly(next);
      return next;
    case 'set-face':
      next.face = action.face;
      return next;
    case 'toggle-face':
      next.face = next.face === 'ink' ? 'paper' : 'ink';
      return next;
    case 'open-session':
      next.currentTitle = action.title;
      next.archived = false;
      next.freshSession = false;
      navigate(next, 'chat');
      return next;
    case 'session-filter':
      next.sessionFilter = action.value;
      return next;
    case 'inbox-filter':
      next.inboxFilter = action.value;
      return next;
    case 'library-filter':
      next.libraryFilter = action.value;
      return next;
    case 'workspace-tab':
      next.workspaceTab = action.tab;
      return next;
    case 'open-workspace':
      next.workspaceTab = action.tab;
      navigate(next, 'workspace');
      return next;
    case 'settings-section':
      next.settingsSection = action.section;
      navigate(next, 'settings-detail');
      return next;
    case 'choose-model':
      next.model = action.value;
      return next;
    case 'choose-effort':
      next.effort = action.value;
      return next;
    case 'choose-mode':
      next.mode = action.value;
      return next;
    case 'choose-scheme':
      next.scheme = action.value;
      return next;
    case 'choose-project':
      next.selectedProject = action.value;
      closeSheetOnly(next);
      return withToast(next, `已选择项目：${action.value}`);
    case 'trust-project':
      closeSheetOnly(next);
      return withToast(next, '示例项目已打开，未改变真实项目权限');
    case 'attach':
      next.attachment = action.value;
      navigate(next, 'chat');
      return withToast(next, '已加入示例附件，可随消息发送');
    case 'remove-attachment':
      next.attachment = '';
      return next;
    case 'add-context':
      next.attachment = action.value;
      navigate(next, 'chat');
      return withToast(next, '已加入对话上下文');
    case 'put-draft':
    case 'command':
    case 'media-prompt':
      putDraft(next, action.value);
      return next;
    case 'prefill':
      next.draft = action.value;
      return next;
    case 'set-draft':
      next.draft = action.value;
      return next;
    case 'use-dictation':
      if (action.value) putDraft(next, action.value);
      else return withToast(next, '先留下一句文字');
      return next;
    case 'terminal-draft':
      if (action.value) putDraft(next, `请执行并检查结果：${action.value}`);
      else return withToast(next, '请先输入命令');
      return next;
    case 'send': {
      if (!online(next)) return next;
      if (next.run === 'running' && !next.draft.trim()) {
        next.run = 'paused';
        return withToast(next, '演示已暂停，可以修改要求或继续');
      }
      if (!next.draft.trim()) {
        if (next.run === 'paused') {
          next.run = 'running';
          return withToast(next, '演示继续运行');
        }
        return withToast(next, '先写一句话，再发送');
      }
      if (next.run === 'running') {
        next.queue = next.draft;
        next.draft = '';
        return withToast(next, '已排到当前工作之后');
      }
      next.messages.push(next.draft + (next.attachment ? ` [${next.attachment}]` : ''));
      next.draft = '';
      next.attachment = '';
      next.run = 'running';
      return withToast(next, '演示消息已发出，Agent 继续工作');
    }
    case 'toggle-run': {
      if (!online(next)) return next;
      next.run = next.run === 'running' ? 'paused' : 'running';
      closeSheetOnly(next);
      return withToast(next, next.run === 'running' ? '演示继续运行' : '演示工作已暂停');
    }
    case 'edit-queue':
      next.draft = next.queue;
      next.queue = '';
      return withToast(next, '已取回砚台，修改后可重新排队');
    case 'cancel-queue':
      next.queue = '';
      return withToast(next, '已取消这条排队消息');
    case 'intervene': {
      if (!online(next)) return next;
      if (!action.value) return withToast(next, '先写下追加的要求');
      next.queue = action.value;
      navigate(next, 'chat');
      return withToast(next, '补充要求已进入演示队列');
    }
    case 'permission': {
      if (!online(next)) return next;
      const scope = action.scope || 'once';
      next.permission = action.choice;
      closeSheetOnly(next);
      const scopeLabel =
        scope === 'once' ? '本次操作' : scope === 'session' ? '本会话同类操作' : '本项目同类操作';
      return withToast(
        next,
        action.choice === 'approved' ? `允 · 演示已批准${scopeLabel}` : '否 · 演示请求已拒绝',
      );
    }
    case 'reset-permission':
      next.permission = 'pending';
      return next;
    case 'execute-plan': {
      if (!online(next)) return next;
      next.planApproved = true;
      next.scheme = action.mode === 'agents' ? 'Ultra Code' : '单 Agent';
      next.run = 'running';
      navigate(next, 'plan');
      return withToast(next, '演示计划开始执行');
    }
    case 'save-comment': {
      if (!action.value) return withToast(next, '先写下你的审阅意见');
      next.comment = action.value;
      closeSheetOnly(next);
      return withToast(next, '批注已保存到当前演示，并关联主会话');
    }
    case 'mark-reviewed':
      next.reviewDone = !next.reviewDone;
      return withToast(next, next.reviewDone ? '已标记看过 · 未提交或发布代码' : '已取消审阅标记');
    case 'reset-review':
      next.reviewDone = false;
      closeSheetOnly(next);
      return next;
    case 'save-note':
      next.note = action.value;
      return withToast(next, '笔记已保存在当前演示中');
    case 'flip-card':
      next.cardFlipped = !next.cardFlipped;
      return next;
    case 'rate-card':
      next.studied += 1;
      next.cardFlipped = false;
      return withToast(next, `已记录「${action.rating}」· 演示下一张`);
    case 'reset-study':
      next.studied = 0;
      next.cardFlipped = false;
      return next;
    case 'next-card':
      next.browsed = (next.browsed + 1) % 12;
      next.cardFlipped = false;
      return next;
    case 'study-mode':
      next.studyMode = action.value === '计划复习' ? 'review' : 'browse';
      next.cardFlipped = false;
      return next;
    case 'set-study-mode':
      next.studyMode = action.mode;
      next.cardFlipped = false;
      navigate(next, 'cards');
      return next;
    case 'produce-cards':
      navigate(next, 'cards');
      return withToast(next, '演示生成了 3 张卡片，已进入卡片工作台');
    case 'mute-voice':
      next.muted = !next.muted;
      return next;
    case 'end-voice':
      next.muted = false;
      navigate(next, 'chat');
      return withToast(next, '语音演示已结束，对话仍在这里');
    case 'toggle-notifications':
      next.notifications = !next.notifications;
      return next;
    case 'toggle-handoff':
      next.handoff = !next.handoff;
      return next;
    case 'disconnect':
      next.offline = true;
      navigate(next, 'chat');
      return withToast(next, '正在演示断线状态，可以继续写草稿');
    case 'reconnect':
      next.offline = false;
      closeSheetOnly(next);
      return withToast(next, '演示连接已恢复；草稿保留，未自动发送');
    case 'pair-demo':
      next.offline = false;
      navigate(next, 'sessions');
      return withToast(next, '已连接示例 Host，未访问真实网络');
    case 'manual-connect':
      if (!action.address || !action.code) return withToast(next, '请填写示例地址和配对码');
      next.offline = false;
      navigate(next, 'sessions');
      return withToast(next, '已连接示例 Host，未访问真实网络');
    case 'pin-session':
      next.pinned = !next.pinned;
      closeSheetOnly(next);
      return withToast(next, next.pinned ? '已置顶示例会话' : '已取消置顶');
    case 'archive-session':
      next.archived = true;
      navigate(next, 'sessions');
      return withToast(next, '会话已归档，可在设置的归档管理恢复');
    case 'restore-archive':
      next.archived = false;
      navigate(next, 'sessions');
      return withToast(next, '示例会话已恢复');
    case 'rename-session':
      if (!action.title) return withToast(next, '名字不能为空');
      next.currentTitle = action.title;
      closeSheetOnly(next);
      return next;
    case 'switch-branch':
      next.currentTitle = action.title;
      navigate(next, 'chat');
      return withToast(next, '已打开示例分支');
    case 'fork-session':
      next.currentTitle = `${next.currentTitle} · 分叉`;
      next.run = 'idle';
      navigate(next, 'chat');
      return withToast(next, '已在原型中另起一个分支');
    case 'history-jump':
      navigate(next, 'chat');
      return withToast(next, '已定位到最初的用户消息');
    case 'start-session': {
      if (!online(next)) return next;
      const text = action.text.trim();
      if (!text) return withToast(next, '先写一句你想做的事');
      next.freshSession = true;
      next.currentTitle = text.slice(0, 16);
      next.messages = [text];
      next.draft = '';
      next.run = 'running';
      navigate(next, 'chat');
      return withToast(next, '新的演示会话已开始');
    }
    case 'regenerate': {
      if (!online(next)) return next;
      next.run = 'running';
      return withToast(next, '正在演示重新生成，历史回复仍保留');
    }
    case 'save-demo':
      if (next.sheet) next.formDrafts[next.sheet] = { ...action.values };
      closeSheetOnly(next);
      return withToast(next, action.message ?? '已保存当前演示');
    case 'extension-tab': {
      const map: Record<string, string> = {
        技能: 'skills',
        MCP: 'mcp',
        扩展: 'extension-install',
        提示词: 'prompt-template',
        插件: 'extension-install',
      };
      const key = map[action.tab] ?? action.tab;
      if (!SHEET_KEYS.has(key)) return withToast(next, '这个入口的演示暂未定义');
      next.sheet = key;
      return next;
    }
    case 'toast':
      return withToast(next, action.message);
    default:
      return state;
  }
}

/** Sheet registry; kept in sync with the sheets components. */
export const SHEET_KEYS = new Set<string>([
  'model',
  'mode',
  'scheme',
  'attach',
  'references',
  'skills',
  'commands',
  'context',
  'session-menu',
  'rename',
  'branches',
  'history',
  'projects',
  'workspace-picker',
  'trust',
  'search',
  'permission',
  'execute-plan',
  'subagent',
  'subagent-output',
  'intervene',
  'goal',
  'comment',
  'review-options',
  'workspace-menu',
  'folder',
  'file',
  'terminal-command',
  'console',
  'artifact-source',
  'dictation',
  'voice-settings',
  'host',
  'pairing',
  'manual-connect',
  'handoff',
  'notifications',
  'card-options',
  'produce-cards',
  'asset',
  'media-new',
  'settings-search',
  'provider',
  'automation-new',
  'automation-edit',
  'hook',
  'mcp',
  'extension-install',
  'prompt-template',
  'web-search',
  'web-fetch',
  'knowledge-model',
  'session-policy',
  'cold-storage',
  'artifact-settings',
  'oauth',
  'skill-detail',
  'rules',
  'runtime',
  'storage-pack',
  'usage-model',
  'compact-context',
]);
