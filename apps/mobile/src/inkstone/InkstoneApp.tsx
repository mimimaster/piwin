import { useEffect, useReducer, useRef, useState, type ReactElement } from 'react';
import { INITIAL_INKSTONE_STATE, inkstoneReducer, type InkstoneRoute } from './demo-state.js';
import { InkstoneContext } from './inkstone-context.js';
import { InkstoneIconSprite, Icon } from './icons.js';
import { SessionsPage } from './pages/sessions.js';
import { ChatPage } from './pages/chat.js';
import { InboxPage } from './pages/inbox.js';
import { ActivityPage } from './pages/activity.js';
import { PlanPage } from './pages/plan.js';
import { ReviewPage } from './pages/review.js';
import { WorkspacePage } from './pages/workspace.js';
import { WorkbenchPage } from './pages/workbench.js';
import { TasksPage } from './pages/tasks.js';
import { ShelfPage } from './pages/shelf.js';
import { DeskPage } from './pages/desk.js';
import { CardsPage } from './pages/cards.js';
import { KnowledgePage } from './pages/knowledge.js';
import { WikiDetailPage } from './pages/wiki-detail.js';
import { VoicePage } from './pages/voice.js';
import { SettingsDetailPage, SettingsPage } from './pages/settings.js';
import {
  AutomationsPage,
  ConnectPage,
  LibraryPage,
  NewSessionPage,
  WalkthroughPage,
} from './pages/extras.js';
import { SHEETS } from './sheets/index.js';
import {
  InkstoneHostProvider,
  type InkstoneHostContextValue,
} from './host/inkstone-host-context.js';

const PAGES: Record<InkstoneRoute, () => ReactElement> = {
  sessions: SessionsPage,
  chat: ChatPage,
  inbox: InboxPage,
  activity: ActivityPage,
  plan: PlanPage,
  review: ReviewPage,
  workspace: WorkspacePage,
  workbench: WorkbenchPage,
  tasks: TasksPage,
  shelf: ShelfPage,
  desk: DeskPage,
  cards: CardsPage,
  knowledge: KnowledgePage,
  'wiki-detail': WikiDetailPage,
  voice: VoicePage,
  settings: SettingsPage,
  'settings-detail': SettingsDetailPage,
  connect: ConnectPage,
  new: NewSessionPage,
  walkthrough: WalkthroughPage,
  library: LibraryPage,
  automations: AutomationsPage,
};

const ROUTES = new Set(Object.keys(PAGES));

const THEME_COLORS: Record<string, string> = { paper: '#f8f6f0', ink: '#191714' };

function readHashRoute(): InkstoneRoute {
  const route = window.location.hash.slice(1) as InkstoneRoute;
  return ROUTES.has(route) ? route : 'sessions';
}

/** Deep links like #review must open the same scene the prototype's hash routing opens. */
function initFromHash(state: typeof INITIAL_INKSTONE_STATE): typeof INITIAL_INKSTONE_STATE {
  const hash = window.location.hash.slice(1) as InkstoneRoute;
  if (ROUTES.has(hash) && hash !== 'sessions') {
    return { ...state, route: hash };
  }
  return state;
}

export function InkstoneApp({
  hostContext,
}: {
  hostContext: InkstoneHostContextValue | null;
}): ReactElement {
  const [state, dispatch] = useReducer(inkstoneReducer, INITIAL_INKSTONE_STATE, initFromHash);
  const [toastVisible, setToastVisible] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const handlePop = () => {
      dispatch({ type: 'navigate', route: readHashRoute() });
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  useEffect(() => {
    if (window.location.hash !== `#${state.route}`) {
      window.history.pushState(null, '', `#${state.route}`);
    }
  }, [state.route]);

  useEffect(() => {
    document.documentElement.dataset.face = state.face;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta !== null) {
      meta.setAttribute('content', THEME_COLORS[state.face] ?? '#f8f6f0');
    }
  }, [state.face]);

  useEffect(() => {
    if (state.toast.message === '') {
      return;
    }
    setToastVisible(true);
    const timer = window.setTimeout(() => setToastVisible(false), 3000);
    return () => window.clearTimeout(timer);
  }, [state.toast.seq, state.toast.message]);

  const hostErrorMessage = hostContext?.host.errorMessage;
  useEffect(() => {
    if (hostErrorMessage !== undefined && hostErrorMessage.length > 0) {
      dispatch({ type: 'toast', message: hostErrorMessage });
    }
  }, [hostErrorMessage]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    if (state.sheet !== null && !dialog.open) {
      dialog.showModal();
    } else if (state.sheet === null && dialog.open) {
      dialog.close();
    }
  }, [state.sheet]);

  const Page = PAGES[state.route];
  const sheet = state.sheet !== null ? SHEETS[state.sheet] : undefined;

  return (
    <InkstoneContext.Provider value={{ state, dispatch }}>
      <InkstoneHostProvider value={hostContext}>
        <div className="inkstone-root">
          <InkstoneIconSprite />
          <div className="phone" data-route={state.route}>
            <Page />
          </div>
          <div
            className={`toast ${toastVisible ? 'show' : ''}`.trim()}
            role="status"
            aria-live="polite"
          >
            {state.toast.message}
          </div>
          <dialog
            className="inkstone-sheet"
            ref={dialogRef}
            aria-label={sheet?.title}
            onClick={(event) => {
              if (event.target === dialogRef.current) {
                dispatch({ type: 'close-sheet' });
              }
            }}
            onClose={() => {
              if (state.sheet !== null) {
                dispatch({ type: 'close-sheet' });
              }
            }}
          >
            {sheet !== undefined ? (
              <>
                <div className="sheet-grab" />
                <div className="sheet-head">
                  <h2>{sheet.title}</h2>
                  <button
                    className="icon-button"
                    onClick={() => dispatch({ type: 'close-sheet' })}
                    aria-label="关闭弹层"
                    type="button"
                  >
                    <Icon name="close" />
                  </button>
                </div>
                <div className="sheet-body">{sheet.render()}</div>
              </>
            ) : null}
          </dialog>
        </div>
      </InkstoneHostProvider>
    </InkstoneContext.Provider>
  );
}
