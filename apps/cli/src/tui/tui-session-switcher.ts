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
 * so it also reflects changes made from Desktop or the phone.
 */
export class TuiSessionSwitcher {
  private picker: SessionPicker | undefined;
  private showsArchived = false;

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
        onArchive: (sessionId) => {
          link
            .request({ type: this.showsArchived ? 'session/unarchive' : 'session/archive', sessionId })
            .then(hostData)
            .then(() => this.refresh())
            .catch(this.options.onError);
        },
        onToggleArchived: () => {
          this.showsArchived = !this.showsArchived;
          this.refresh();
        },
        onClose: () => modals.close(),
      },
      this.options.getCurrentSessionId(),
    );
    this.showsArchived = false;
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
    const archived = this.showsArchived;
    const list = hostData<RemoteSessionListData>(
      await this.options.link.request({
        type: 'session/list',
        scopeRef: { kind: 'all-authorized' },
        order: 'updated',
        maxItems: SESSION_LIST_LIMIT,
        includeArchived: archived,
      }),
    );
    if (this.picker !== picker || archived !== this.showsArchived) return;
    const sessions = list.sessions.filter((session) => (session.archived === true) === archived);
    picker.setRows(
      buildSessionRows(sessions, [...this.options.getProjects()], new Date()),
      archived,
      this.options.getCurrentSessionId(),
    );
    this.options.requestRender();
  }
}
