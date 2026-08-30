import { useState, type ReactElement } from 'react';
import type { RemoteProjectSummary, RemoteSessionSummary } from '@piwin/contracts';
import {
  IconPlus,
  IconSearch,
  IconClose,
  IconChat,
  IconSettings,
  IconListTree,
  IconFolder,
  IconSpark,
  IconCards,
} from '@piwin/ui-kit';
import { MobileLayer } from '../../mobile-portal.js';

export type MobileSidebarDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  projects: RemoteProjectSummary[];
  sessions: RemoteSessionSummary[];
  activeSessionId?: string | undefined;
  onSelectSession: (sessionId: string) => void;
  onNewChat: (projectId?: string) => void;
  onPinSession?: ((sessionId: string, isPinned: boolean) => void) | undefined;
  onRenameSession?: ((sessionId: string, newName: string) => void) | undefined;
  onDeleteSession?: ((sessionId: string) => void) | undefined;
  onOpenSettings: () => void;
  onOpenInbox: () => void;
  onOpenFiles?: (() => void) | undefined;
  onOpenSkills?: (() => void) | undefined;
  onOpenShare?: (() => void) | undefined;
  onOpenFlashcards?: (() => void) | undefined;
  activeRunCount?: number | undefined;
  endpoint?: string | undefined;
  isConnected: boolean;
};

export function MobileSidebarDrawer({
  isOpen,
  onClose,
  projects,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onPinSession,
  onRenameSession,
  onDeleteSession,
  onOpenSettings,
  onOpenInbox,
  onOpenFiles,
  onOpenSkills,
  onOpenShare,
  onOpenFlashcards,
  activeRunCount = 0,
  endpoint,
  isConnected,
}: MobileSidebarDrawerProps): ReactElement | null {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(undefined);
  const [editingSessionId, setEditingSessionId] = useState<string | undefined>(undefined);
  const [editingName, setEditingName] = useState('');

  const handleStartRename = (session: RemoteSessionSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSessionId(session.sessionId);
    setEditingName(session.name ?? session.sessionId);
  };

  const handleConfirmRename = (sessionId: string, e: React.FormEvent | React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (editingName.trim() && onRenameSession) {
      onRenameSession(sessionId, editingName.trim());
    }
    setEditingSessionId(undefined);
  };

  const filteredSessions = sessions.filter((s) => {
    if (selectedProjectId !== undefined && s.projectId !== selectedProjectId) {
      return false;
    }
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase();
      const name = (s.name ?? s.sessionId).toLowerCase();
      return name.includes(q);
    }
    return true;
  });

  return (
    <MobileLayer isOpen={isOpen} onClose={onClose}>
      <div className="mobile-drawer-panel">
        {/* 1. Drawer Header */}
        <div className="mobile-drawer-header">
          <div className="mobile-drawer-host-info">
            <span className={`mobile-host-dot ${isConnected ? 'online' : 'offline'}`} />
            <div className="mobile-host-text">
              <span className="mobile-host-title">
                {isConnected ? 'Host 已就绪' : 'Host 未连接'}
              </span>
              <span className="mobile-host-sub">{endpoint || 'ws://127.0.0.1:8787'}</span>
            </div>
          </div>
          <button
            type="button"
            className="mobile-drawer-close-btn"
            onClick={onClose}
            aria-label="关闭侧边栏"
          >
            <IconClose size={18} />
          </button>
        </div>

        {/* 2. Primary New Chat Button */}
        <div className="mobile-drawer-action-row">
          <button
            type="button"
            className="mobile-drawer-new-chat-btn"
            onClick={() => {
              onNewChat(selectedProjectId);
              onClose();
            }}
          >
            <IconPlus size={16} />
            <span>新建对话</span>
          </button>
        </div>

        {/* 3. Search Bar */}
        <div className="mobile-drawer-search-bar">
          <IconSearch size={14} className="mobile-search-icon" />
          <input
            type="text"
            placeholder="搜索历史会话…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="mobile-search-input"
          />
        </div>

        {/* 4. Project Filter Pills */}
        {projects.length > 0 ? (
          <div className="mobile-drawer-project-pills">
            <button
              type="button"
              className={`mobile-project-filter-pill ${selectedProjectId === undefined ? 'active' : ''}`}
              onClick={() => setSelectedProjectId(undefined)}
            >
              全部 ({sessions.length})
            </button>
            {projects.map((p) => (
              <button
                key={p.projectId}
                type="button"
                className={`mobile-project-filter-pill ${selectedProjectId === p.projectId ? 'active' : ''}`}
                onClick={() => setSelectedProjectId(p.projectId)}
              >
                {p.displayName}
              </button>
            ))}
          </div>
        ) : null}

        {/* 5. Sessions Scroll List */}
        <div className="mobile-drawer-sessions-list">
          <div className="mobile-drawer-section-title">历史会话</div>
          {filteredSessions.length === 0 ? (
            <div className="mobile-drawer-empty-sessions">暂无匹配的会话</div>
          ) : (
            filteredSessions.map((session) => {
              const isSelected = session.sessionId === activeSessionId;
              const isEditing = editingSessionId === session.sessionId;

              return (
                <div
                  key={session.sessionId}
                  className={`mobile-drawer-session-item-row ${isSelected ? 'active' : ''}`}
                >
                  {isEditing ? (
                    <form
                      className="mobile-drawer-rename-form"
                      onSubmit={(e) => handleConfirmRename(session.sessionId, e)}
                    >
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={(e) => handleConfirmRename(session.sessionId, e)}
                        autoFocus
                        className="mobile-drawer-rename-input"
                      />
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="mobile-drawer-session-item-btn"
                      onClick={() => {
                        onSelectSession(session.sessionId);
                        onClose();
                      }}
                    >
                      <IconChat size={15} className="mobile-session-item-icon" />
                      <span className="mobile-drawer-session-item-name">
                        {session.pinned ? '📌 ' : ''}{session.name ?? session.sessionId}
                      </span>
                      {session.messageCount !== undefined ? (
                        <span className="mobile-session-item-count">{session.messageCount}</span>
                      ) : null}
                    </button>
                  )}

                  {!isEditing ? (
                    <div className="mobile-drawer-session-actions">
                      {onPinSession ? (
                        <button
                          type="button"
                          className={`mobile-session-action-btn ${session.pinned ? 'pinned' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onPinSession(session.sessionId, Boolean(session.pinned));
                          }}
                          aria-label={session.pinned ? '取消置顶' : '置顶会话'}
                        >
                          📌
                        </button>
                      ) : null}

                      {onRenameSession ? (
                        <button
                          type="button"
                          className="mobile-session-action-btn"
                          onClick={(e) => handleStartRename(session, e)}
                          aria-label="重命名会话"
                        >
                          ✏️
                        </button>
                      ) : null}

                      {onDeleteSession ? (
                        <button
                          type="button"
                          className="mobile-session-action-btn delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteSession(session.sessionId);
                          }}
                          aria-label="删除会话"
                        >
                          🗑️
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {/* 6. Drawer Bottom Navigation Hub */}
        <div className="mobile-drawer-footer">
          {onOpenFlashcards ? (
            <button
              type="button"
              className="mobile-drawer-footer-btn"
              data-testid="mobile-open-flashcards"
              onClick={() => {
                onOpenFlashcards();
              }}
            >
              <IconCards size={16} />
              <span>闪卡</span>
            </button>
          ) : null}

          <button
            type="button"
            className="mobile-drawer-footer-btn"
            onClick={() => {
              onOpenInbox();
              onClose();
            }}
          >
            <div className="mobile-footer-icon-wrap">
              <IconListTree size={16} />
              {activeRunCount > 0 ? <span className="mobile-footer-badge" /> : null}
            </div>
            <span>任务收件箱</span>
            {activeRunCount > 0 ? (
              <span className="mobile-footer-count-tag">{activeRunCount} 运行中</span>
            ) : null}
          </button>

          {onOpenFiles ? (
            <button
              type="button"
              className="mobile-drawer-footer-btn"
              onClick={() => {
                onOpenFiles();
                onClose();
              }}
            >
              <IconFolder size={16} />
              <span>工作区文件与变更</span>
            </button>
          ) : null}

          {onOpenSkills ? (
            <button
              type="button"
              className="mobile-drawer-footer-btn"
              onClick={() => {
                onOpenSkills();
                onClose();
              }}
            >
              <IconSpark size={16} />
              <span>技能与 MCP 状态</span>
            </button>
          ) : null}

          {onOpenShare ? (
            <button
              type="button"
              className="mobile-drawer-footer-btn"
              onClick={() => {
                onOpenShare();
                onClose();
              }}
            >
              <span className="footer-emoji-icon">📤</span>
              <span>导出与分享</span>
            </button>
          ) : null}

          <button
            type="button"
            className="mobile-drawer-footer-btn"
            onClick={() => {
              onOpenSettings();
              onClose();
            }}
          >
            <IconSettings size={16} />
            <span>外观与设置</span>
          </button>
        </div>
      </div>
    </MobileLayer>
  );
}
