import type { RemoteProjectSummary, RemoteSessionListData } from '@piwin/contracts';
import { buildSessionRows } from './session-list-model.js';
import { SessionPicker } from './session-picker.js';
import { hostData, type TuiHostLink } from './tui-host-link.js';
import type { TuiModalStack } from './tui-modals.js';

const SESSION_LIST_LIMIT = 500;

export type TuiSessionSwitcherOptions = {
  link: TuiHostLink;
  modals: TuiModalStack;
  getProjects: () => readonly RemoteProjectSummary[];
  getCurrentSessionId: () => string | undefined;
  onOpen: (sessionId: string) => void;
  onNew: () => void;
  onRename: (sessionId: string, name: string) => Promise<void>;
  onError: (error: unknown) => void;
  requestRender: () => void;
};

/**
 * Drives the session picker overlay against the Host's session index.
 * Rename and archive go to the Host; the list is re-read rather than patched,
 * so it also reflects changes made from Desktop or the phone. Grouping, the
 * project filter and the archived fold happen on the rows already loaded.
 */
export class TuiSessionSwitcher {
  private picker: SessionPicker | undefined;
  private loadToken = 0;

  public constructor(private readonly options: TuiSessionSwitcherOptions) {}

  public async open(): Promise<void> {
    const { modals, link } = this.options;
    const picker = new SessionPicker(
      {
        onOpen: (sessionId) => {
          modals.close();
          this.options.onOpen(sessionId);
        },
        onNew: () => {
          modals.close();
          this.options.onNew();
        },
        onRename: (sessionId, name) => {
          this.options
            .onRename(sessionId, name)
            .then(() => this.refresh())
            .catch(this.options.onError);
        },
        onArchive: (sessionId, archived) => {
          link
            .request({ type: archived ? 'session/unarchive' : 'session/archive', sessionId })
            .then(hostData)
            .then(() => this.refresh())
            .catch(this.options.onError);
        },
        onClose: () => modals.close(),
      },
      this.options.getCurrentSessionId(),
    );
    picker.setLoading();
    modals.show(picker);
    this.picker = picker;
    await this.loadRows(picker);
  }

  /** The overlay was closed, by the user or by another overlay replacing it. */
  public handleOverlayClosed(): void {
    this.picker = undefined;
  }

  /** Re-read the list if the picker is open; a no-op otherwise. */
  public refresh(): void {
    const picker = this.picker;
    if (picker === undefined) return;
    this.loadRows(picker).catch(this.options.onError);
  }

  private async loadRows(picker: SessionPicker): Promise<void> {
    const token = ++this.loadToken;
    try {
      const projects = this.options.getProjects();
      const now = new Date();
      const list = hostData<RemoteSessionListData>(
        await this.options.link.request({
          type: 'session/list',
          scopeRef: { kind: 'all-authorized' },
          order: 'updated',
          maxItems: SESSION_LIST_LIMIT,
          includeArchived: true,
        }),
      );
      if (this.picker !== picker || token !== this.loadToken) return;
      picker.setRows(
        buildSessionRows(list.sessions, projects, now),
        this.options.getCurrentSessionId(),
        projects,
      );
      this.options.requestRender();
    } catch (error) {
      if (this.picker !== picker || token !== this.loadToken) return;
      picker.setError(
        error instanceof Error && error.message.length > 0 ? error.message : '加载失败',
      );
      this.options.requestRender();
    }
  }
}
