import { useState, type ReactElement } from 'react';
import type { RemoteProjectSummary, RemoteSessionSummary } from '@piwin/contracts';
import { Button, Card, TextInput, IconPlus, IconChat, IconChevronRight } from '@piwin/ui-kit';

export type SessionsSurfaceProps = {
  projects: RemoteProjectSummary[];
  sessions: RemoteSessionSummary[];
  activeSessionId?: string | undefined;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: (projectId?: string) => Promise<string | undefined>;
  onNavigateToChat: () => void;
};

export function SessionsSurface({
  projects,
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  onNavigateToChat,
}: SessionsSurfaceProps): ReactElement {
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const filteredSessions = sessions.filter((session) => {
    // Project filter
    if (selectedProjectId !== undefined) {
      if (session.scope !== 'project') {
        return false;
      }
    }
    // Search filter
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase();
      const name = (session.name ?? session.sessionId).toLowerCase();
      return name.includes(q);
    }
    return true;
  });

  const handleCreate = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const newId = await onCreateSession(selectedProjectId);
      if (newId !== undefined) {
        onNavigateToChat();
      }
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="mobile-surface-container sessions-surface">
      {/* 1. Projects horizontal scroll filters */}
      <div className="mobile-project-filters" role="tablist" aria-label="项目分类">
        <button
          type="button"
          className={`mobile-project-chip ${selectedProjectId === undefined ? 'active' : ''}`}
          onClick={() => setSelectedProjectId(undefined)}
        >
          全部项目 ({projects.length})
        </button>
        {projects.map((project) => (
          <button
            key={project.projectId}
            type="button"
            className={`mobile-project-chip ${selectedProjectId === project.projectId ? 'active' : ''}`}
            onClick={() => setSelectedProjectId(project.projectId)}
          >
            {project.displayName}
          </button>
        ))}
      </div>

      {/* 2. Search & Create Toolbar */}
      <div className="mobile-session-toolbar">
        <div className="mobile-session-search">
          <TextInput
            placeholder="搜索会话…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.currentTarget.value)}
            size="compact"
          />
        </div>
        <Button
          variant="primary"
          size="compact"
          onClick={() => void handleCreate()}
          disabled={isCreating}
        >
          <IconPlus size={14} />
          {isCreating ? '创建中…' : '新建'}
        </Button>
      </div>

      {/* 3. Session List Card */}
      <Card className="mobile-slice-card" withBorder>
        <div className="mobile-card-heading">
          <div>
            <p className="mobile-eyebrow">SESSIONS LIST</p>
            <h2>
              {selectedProjectId
                ? projects.find((p) => p.projectId === selectedProjectId)?.displayName
                : '所有会话'}
            </h2>
          </div>
          <span className="mobile-session-count">{filteredSessions.length} 个会话</span>
        </div>

        {filteredSessions.length === 0 ? (
          <p className="mobile-muted">暂无匹配的会话</p>
        ) : (
          <div className="mobile-session-card-list">
            {filteredSessions.map((session) => {
              const isSelected = session.sessionId === activeSessionId;
              return (
                <button
                  type="button"
                  key={session.sessionId}
                  className={`mobile-session-card-row ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    onSelectSession(session.sessionId);
                    onNavigateToChat();
                  }}
                >
                  <div className="mobile-session-card-left">
                    <div className={`mobile-session-card-icon ${isSelected ? 'active' : ''}`}>
                      <IconChat size={16} />
                    </div>
                    <div className="mobile-session-card-info">
                      <span className="mobile-session-card-title">
                        {session.name ?? session.sessionId}
                      </span>
                      <div className="mobile-session-card-meta">
                        <span className="mobile-session-scope-tag">
                          {session.scope === 'project' ? '项目' : '通用'}
                        </span>
                        {session.messageCount !== undefined ? (
                          <span className="mobile-session-msg-count">
                            {session.messageCount} 条消息
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <IconChevronRight size={16} className="mobile-session-chevron" />
                </button>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
