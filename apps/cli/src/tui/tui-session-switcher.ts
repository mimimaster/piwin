import {
  isRunActive,
  type ExecutionRunRecord,
  type RemoteProjectSummary,
  type RemoteSessionListData,
} from '@piwin/contracts';
import { TextOverlay } from './choice-overlay.js';
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
  /** Short status-line flash (e.g. no session yet). */
  onHint: (text: string) => void;
  /** Multi-line notice after pin/unpin from a slash command. */
  onNotice: (tone: 'info' | 'error', text: string) => void;
  requestRender: () => void;
};

/**
 * Drives the session picker overlay against the Host's session index.
 * Rename, pin, archive and delete go to the Host; the list is re-read rather
 * than patched, so it also reflects changes made from Desktop or the phone.
 */
export class TuiSessionSwitcher {
  private picker: SessionPicker | undefined;
  private loadToken = 0;
  /** Last session archived from this shell; `/unarchive` with no id undoes it. */
  private lastArchived:
    | { sessionId: string; title: string }
    | undefined;

  public constructor(private readonly options: TuiSessionSwitcherOptions) {}

  public async open(): Promise<void> {
    const { modals } = this.options;
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
        onPin: (sessionId, pinned) => {
          this.setPinned(sessionId, !pinned)
            .then(() => this.refresh())
            .catch(this.options.onError);
        },
        onArchive: (sessionId, archived, title) => {
          this.toggleArchive(sessionId, archived, title)
            .then(() => this.refresh())
            .catch(this.options.onError);
        },
        onDelete: (sessionId, title) => {
          this.beginDelete(sessionId, title).catch(this.options.onError);
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

  /**
   * `/pin` on the session this shell is showing. Looks up the current pin
   * flag on the Host index so Desktop and TUI stay on one record.
   */
  public async toggleCurrentPin(): Promise<void> {
    const sessionId = this.options.getCurrentSessionId();
    if (sessionId === undefined) {
      this.options.onHint('当前还没有会话');
      return;
    }
    const pinned = await this.isPinned(sessionId);
    await this.setPinned(sessionId, !pinned);
    this.options.onNotice('info', pinned ? '已取消置顶' : '已置顶');
    this.refresh();
  }

  /** `/archive` — archive the open session; `/unarchive` undoes the last one. */
  public async archiveCurrent(): Promise<void> {
    const sessionId = this.options.getCurrentSessionId();
    if (sessionId === undefined) {
      this.options.onHint('当前还没有会话');
      return;
    }
    const title = await this.sessionTitle(sessionId);
    await this.toggleArchive(sessionId, false, title);
  }

  /** Undo the last archive from this shell, or unarchive the open session. */
  public async unarchiveLastOrCurrent(): Promise<void> {
    const target =
      this.lastArchived ??
      (this.options.getCurrentSessionId() === undefined
        ? undefined
        : {
            sessionId: this.options.getCurrentSessionId()!,
            title: await this.sessionTitle(this.options.getCurrentSessionId()!),
          });
    if (target === undefined) {
      this.options.onHint('没有可撤销的归档');
      return;
    }
    await this.toggleArchive(target.sessionId, true, target.title);
  }

  /**
   * `/delete` — permanent delete of the open session after typing its title.
   * Archive-first on the Host; a live run is refused with a reason.
   */
  public async deleteCurrent(): Promise<void> {
    const sessionId = this.options.getCurrentSessionId();
    if (sessionId === undefined) {
      this.options.onHint('当前还没有会话');
      return;
    }
    const title = await this.sessionTitle(sessionId);
    await this.beginDelete(sessionId, title);
  }

  private async beginDelete(sessionId: string, title: string): Promise<void> {
    const busy = await this.runningDeleteBlockReason(sessionId);
    if (busy !== undefined) {
      this.options.onNotice('error', busy);
      return;
    }
    // Replacing the picker so the confirm field owns the keyboard.
    this.options.modals.show(
      new TextOverlay({
        title: '永久删除会话',
        message: `输入会话标题确认删除：${title}\n删除后无法恢复。`,
        onSubmit: (value) => {
          this.options.modals.close();
          if (value.trim() !== title) {
            this.options.onHint('标题不匹配，已取消删除');
            return;
          }
          this.performDelete(sessionId, title).catch(this.options.onError);
        },
        onCancel: () => this.options.modals.close(),
      }),
    );
  }

  private async performDelete(sessionId: string, title: string): Promise<void> {
    try {
      hostData(await this.options.link.request({ type: 'session/delete', sessionId }));
    } catch (error) {
      this.options.onNotice('error', deleteFailureMessage(error));
      return;
    }
    if (this.lastArchived?.sessionId === sessionId) this.lastArchived = undefined;
    // Draft first: startDraftSession clears the transcript, so the notice
    // must land on the empty conversation that replaces the deleted one.
    if (this.options.getCurrentSessionId() === sessionId) {
      this.options.onNew();
    }
    this.options.onNotice('info', `已永久删除「${title}」`);
    this.refresh();
  }

  private async toggleArchive(
    sessionId: string,
    currentlyArchived: boolean,
    title: string,
  ): Promise<void> {
    hostData(
      await this.options.link.request({
        type: currentlyArchived ? 'session/unarchive' : 'session/archive',
        sessionId,
      }),
    );
    if (currentlyArchived) {
      if (this.lastArchived?.sessionId === sessionId) this.lastArchived = undefined;
      this.options.onNotice('info', `已取消归档「${title}」`);
    } else {
      this.lastArchived = { sessionId, title };
      this.options.onNotice('info', `已归档「${title}」。/unarchive 可撤销`);
    }
  }

  private async runningDeleteBlockReason(sessionId: string): Promise<string | undefined> {
    const response = await this.options.link.request({
      type: 'session/foreground-run',
      sessionId,
    });
    if (!response.success) return undefined;
    const data = response.data as { run?: ExecutionRunRecord | null } | undefined;
    const run = data?.run;
    if (run !== null && run !== undefined && isRunActive(run.status)) {
      return '会话正在运行，无法删除。请先中断或等它结束。';
    }
    return undefined;
  }

  private async setPinned(sessionId: string, pinned: boolean): Promise<void> {
    hostData(
      await this.options.link.request({
        type: pinned ? 'session/pin' : 'session/unpin',
        sessionId,
      }),
    );
  }

  private async isPinned(sessionId: string): Promise<boolean> {
    const session = await this.findSession(sessionId);
    return session?.pinned === true;
  }

  private async sessionTitle(sessionId: string): Promise<string> {
    const session = await this.findSession(sessionId);
    const name = session?.name?.trim() || session?.lastPreview?.trim();
    return name && name.length > 0 ? name.replace(/\s+/g, ' ') : '未命名会话';
  }

  private async findSession(sessionId: string) {
    const list = hostData<RemoteSessionListData>(
      await this.options.link.request({
        type: 'session/list',
        scopeRef: { kind: 'all-authorized' },
        order: 'updated',
        maxItems: SESSION_LIST_LIMIT,
        includeArchived: true,
      }),
    );
    return list.sessions.find((session) => session.sessionId === sessionId);
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

function deleteFailureMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes('foreground-run')) {
    return '会话正在运行，无法删除。请先中断或等它结束。';
  }
  if (text.includes('body-job')) {
    return '会话正忙（压缩/清理等），稍后再删。';
  }
  if (text.includes('archived before permanent delete')) {
    return '请先归档再永久删除。';
  }
  return text.length > 0 ? text : '删除失败';
}
