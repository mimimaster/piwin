/**
 * Shell-only UI state for the Inkstone mobile app: where the user is, which
 * sheet is open, local display choices and transient toasts. Everything about
 * sessions, runs, tools and settings lives on the Host (see host/*); nothing
 * here stands in for Host data.
 */

export type InkstoneRoute =
  | 'sessions'
  | 'chat'
  | 'inbox'
  | 'activity'
  | 'plan'
  | 'review'
  | 'workspace'
  | 'workbench'
  | 'tasks'
  | 'shelf'
  | 'desk'
  | 'cards'
  | 'knowledge'
  | 'wiki-detail'
  | 'voice'
  | 'settings'
  | 'settings-detail'
  | 'connect'
  | 'walkthrough'
  | 'library'
  | 'automations';

import { readSessionMode, type SessionMode } from './session-mode.js';

export type InkstoneFace = 'paper' | 'ink';

/**
 * A new conversation that exists only on the phone until its first message:
 * the Host session is created on send, so tapping + never leaves empty
 * sessions behind.
 */
export interface InkstoneDraft {
  mode: SessionMode;
  /** Agent drafts only; undefined starts a general conversation. */
  projectId: string | undefined;
}
export type InkstoneScope = 'once' | 'session' | 'project';
export type InkstoneKnowledgeTab = '维基' | '信源' | '闪卡';

export interface InkstoneState {
  route: InkstoneRoute;
  face: InkstoneFace;
  sheet: string | null;
  sessionFilter: string;
  inboxFilter: string;
  workspaceTab: string;
  settingsSection: string;
  knowledgeTab: InkstoneKnowledgeTab;
  wikiCategory: string;
  /** Wiki concept slug opened in `wiki-detail`. */
  wiki: string;
  /** Last chosen permission remember-scope, reused by the next approval. */
  scope: InkstoneScope;
  toast: { seq: number; message: string };
  /** Which half of the session list is showing; remembered on the device. */
  sessionMode: SessionMode;
  draft: InkstoneDraft | null;
  /** A session just created from a draft whose first message still has to go out. */
  pendingFirstSend: { sessionId: string; text: string } | null;
}

export const INITIAL_INKSTONE_STATE: InkstoneState = {
  route: 'sessions',
  face: 'paper',
  sheet: null,
  sessionFilter: '全部',
  inboxFilter: '待处理',
  workspaceTab: '文件',
  settingsSection: '模型配置',
  knowledgeTab: '维基',
  wikiCategory: '全部',
  wiki: '',
  scope: 'once',
  toast: { seq: 0, message: '' },
  sessionMode: 'chat',
  draft: null,
  pendingFirstSend: null,
};

/** Initial state with device-remembered preferences applied. */
export function createInitialInkstoneState(): InkstoneState {
  return { ...INITIAL_INKSTONE_STATE, sessionMode: readSessionMode() };
}

export type InkstoneAction =
  | { type: 'navigate'; route: InkstoneRoute }
  | { type: 'open-sheet'; key: string }
  | { type: 'close-sheet' }
  | { type: 'toast'; message: string }
  | { type: 'set-face'; face: InkstoneFace }
  | { type: 'toggle-face' }
  | { type: 'session-filter'; value: string }
  | { type: 'inbox-filter'; value: string }
  | { type: 'workspace-tab'; tab: string }
  | { type: 'open-workspace'; tab: string }
  | { type: 'settings-section'; section: string }
  | { type: 'set-knowledge-tab'; tab: InkstoneKnowledgeTab }
  | { type: 'set-wiki-category'; category: string }
  | { type: 'open-wiki'; wikiId: string }
  | { type: 'set-scope'; scope: InkstoneScope }
  | { type: 'set-session-mode'; mode: SessionMode }
  | { type: 'start-draft'; draft: InkstoneDraft }
  | { type: 'set-draft-project'; projectId: string | undefined }
  | { type: 'draft-created'; sessionId: string; text: string }
  | { type: 'first-send-done' };

/** Merged destinations: the inbox lives in 动态, shelf and settings in 案头. */
function resolveRoute(route: InkstoneRoute): InkstoneRoute {
  if (route === 'inbox') return 'activity';
  if (route === 'shelf' || route === 'settings') return 'desk';
  return route;
}

export function inkstoneReducer(state: InkstoneState, action: InkstoneAction): InkstoneState {
  switch (action.type) {
    case 'navigate':
      // Leaving for any page, including an existing session, abandons the draft.
      return { ...state, sheet: null, draft: null, route: resolveRoute(action.route) };
    case 'open-sheet':
      return { ...state, sheet: action.key };
    case 'close-sheet':
      return { ...state, sheet: null };
    case 'toast':
      return { ...state, toast: { seq: state.toast.seq + 1, message: action.message } };
    case 'set-face':
      return { ...state, face: action.face };
    case 'toggle-face':
      return { ...state, face: state.face === 'ink' ? 'paper' : 'ink' };
    case 'session-filter':
      return { ...state, sessionFilter: action.value };
    case 'inbox-filter':
      return { ...state, inboxFilter: action.value };
    case 'workspace-tab':
      return { ...state, workspaceTab: action.tab };
    case 'open-workspace':
      return { ...state, sheet: null, workspaceTab: action.tab, route: 'workspace' };
    case 'settings-section':
      return { ...state, sheet: null, settingsSection: action.section, route: 'settings-detail' };
    case 'set-knowledge-tab':
      return { ...state, knowledgeTab: action.tab };
    case 'set-wiki-category':
      return { ...state, wikiCategory: action.category };
    case 'open-wiki':
      return { ...state, sheet: null, wiki: action.wikiId, route: 'wiki-detail' };
    case 'set-scope':
      return { ...state, scope: action.scope };
    case 'set-session-mode':
      return { ...state, sessionMode: action.mode };
    case 'start-draft':
      return { ...state, sheet: null, route: 'chat', draft: action.draft, pendingFirstSend: null };
    case 'set-draft-project':
      return state.draft === null
        ? state
        : { ...state, sheet: null, draft: { ...state.draft, projectId: action.projectId } };
    case 'draft-created':
      return {
        ...state,
        draft: null,
        pendingFirstSend: { sessionId: action.sessionId, text: action.text },
      };
    case 'first-send-done':
      return { ...state, pendingFirstSend: null };
  }
}
