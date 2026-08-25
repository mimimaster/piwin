import { useState, type ReactElement } from 'react';
import type { RemoteProjectSummary } from '@piwin/contracts';
import { IconClose, IconFolder } from '@piwin/ui-kit';
import { MobileLayer } from '../../mobile-portal.js';

export type ProjectFilesSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  projects: RemoteProjectSummary[];
  activeProjectId?: string | undefined;
  activeProjectName?: string | undefined;
};

type MockFileChange = {
  path: string;
  status: 'modified' | 'added' | 'deleted';
  additions: number;
  deletions: number;
};

const SAMPLE_PROJECT_CHANGES: MockFileChange[] = [
  { path: 'src/App.tsx', status: 'modified', additions: 14, deletions: 5 },
  { path: 'src/components/chat/ModernComposer.tsx', status: 'modified', additions: 32, deletions: 12 },
  { path: 'src/styles/themes.css', status: 'modified', additions: 58, deletions: 20 },
  { path: 'src/styles/layout.css', status: 'added', additions: 84, deletions: 0 },
  { path: 'src/components/modals/ProjectFilesSheet.tsx', status: 'added', additions: 120, deletions: 0 },
];

export function ProjectFilesSheet({
  isOpen,
  onClose,
  projects,
  activeProjectId,
  activeProjectName,
}: ProjectFilesSheetProps): ReactElement | null {
  const [selectedFile, setSelectedFile] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<'changes' | 'all'>('changes');

  const currentProject =
    projects.find((p) => p.projectId === activeProjectId) ??
    projects[0] ?? {
      projectId: 'workspace',
      displayName: activeProjectName || '当前工作区',
    };

  return (
    <MobileLayer isOpen={isOpen} onClose={onClose} overlayClassName="mobile-modal-overlay">
      <div className="mobile-modal-sheet">
        {/* Header */}
        <div className="mobile-modal-header">
          <div className="mobile-modal-header-left">
            <IconFolder size={18} />
            <div>
              <h2 className="mobile-modal-title">工作区文件与变更</h2>
              <span className="mobile-artifact-subtitle">
                {currentProject.displayName}
              </span>
            </div>
          </div>
          <button type="button" className="mobile-modal-close-btn" onClick={onClose} aria-label="关闭">
            <IconClose size={18} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="mobile-picker-tabs" style={{ marginTop: 12 }}>
          <button
            type="button"
            className={`mobile-picker-tab-btn ${activeTab === 'changes' ? 'active' : ''}`}
            onClick={() => setActiveTab('changes')}
          >
            <span>工作区变更 ({SAMPLE_PROJECT_CHANGES.length})</span>
          </button>
          <button
            type="button"
            className={`mobile-picker-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            <span>挂载项目 ({projects.length})</span>
          </button>
        </div>

        {/* Body */}
        <div className="mobile-modal-body">
          {activeTab === 'changes' ? (
            <div className="mobile-model-list">
              <div className="mobile-drawer-section-title">最近修改的文件</div>
              {SAMPLE_PROJECT_CHANGES.map((file) => {
                const isSelected = selectedFile === file.path;
                return (
                  <div
                    key={file.path}
                    className={`mobile-model-card-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedFile(isSelected ? undefined : file.path)}
                  >
                    <div className="mobile-model-card-info" style={{ width: '100%' }}>
                      <div className="mobile-model-name-row" style={{ justifyContent: 'space-between' }}>
                        <span className="mobile-model-name" style={{ fontSize: 13, fontFamily: 'var(--font-mono)' }}>
                          {file.path}
                        </span>
                        <span
                          className={`mobile-tool-status-badge ${
                            file.status === 'modified' ? 'running' : 'done'
                          }`}
                        >
                          +{file.additions} -{file.deletions}
                        </span>
                      </div>
                      <p className="mobile-model-desc">
                        {file.status === 'modified' ? '已修改' : file.status === 'added' ? '新增文件' : '已删除'}
                      </p>
                      {isSelected ? (
                        <div
                          style={{
                            marginTop: 8,
                            padding: '8px 10px',
                            borderRadius: 6,
                            background: 'var(--void)',
                            border: '1px solid var(--line-1)',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 11,
                            color: 'var(--text-2)',
                          }}
                        >
                          <div style={{ color: 'var(--mint)' }}>+ // Refactored with Deck design tokens</div>
                          <div style={{ color: 'var(--coral)' }}>- // Legacy blue theme removed</div>
                          <div>  const isConnected = host.connectionState.kind === 'ready';</div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mobile-model-list">
              <div className="mobile-drawer-section-title">Host 已挂载的项目目录</div>
              {projects.length === 0 ? (
                <p className="mobile-model-desc">暂无挂载的项目目录。</p>
              ) : (
                projects.map((proj) => (
                  <div key={proj.projectId} className="mobile-model-card-item">
                    <div className="mobile-model-card-info">
                      <div className="mobile-model-name-row">
                        <span className="mobile-model-name">{proj.displayName}</span>
                        <span className="mobile-model-badge">{proj.projectId}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </MobileLayer>
  );
}
