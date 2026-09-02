import { useState, type ReactElement } from 'react';
import { IconClose, IconSpark } from '@piwin/ui-kit';
import { MobileLayer } from '../../mobile-portal.js';

export type SkillsInspectorSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  endpoint?: string | undefined;
};

type InstalledSkill = {
  id: string;
  name: string;
  description: string;
  source: string;
  enabled: boolean;
};

type McpServerInfo = {
  name: string;
  status: 'connected' | 'idle' | 'error';
  toolCount: number;
  description: string;
};

const SAMPLE_SKILLS: InstalledSkill[] = [
  {
    id: 'agy-customizations',
    name: 'AGY Customizations',
    description: 'Guide and reference for Antigravity rules, skills, plugins, hooks, and MCP servers.',
    source: 'builtin/skills/agy-customizations',
    enabled: true,
  },
  {
    id: 'antigravity-guide',
    name: 'Antigravity Guide',
    description: 'Comprehensive guide and quick reference for AGY CLI, SDK, and Agent workflows.',
    source: 'builtin/skills/antigravity_guide',
    enabled: true,
  },
];

const SAMPLE_MCP_SERVERS: McpServerInfo[] = [
  {
    name: 'workpanel',
    status: 'connected',
    toolCount: 1,
    description: '本机任务看板便签便笺服务 (note)',
  },
  {
    name: 'agent-memory',
    status: 'connected',
    toolCount: 3,
    description: '跨会话实体与长程记忆存储库',
  },
];

export function SkillsInspectorSheet({
  isOpen,
  onClose,
  endpoint,
}: SkillsInspectorSheetProps): ReactElement | null {
  const [activeTab, setActiveTab] = useState<'skills' | 'mcp'>('skills');

  return (
    <MobileLayer isOpen={isOpen} onClose={onClose} overlayClassName="mobile-modal-overlay">
      <div className="mobile-modal-sheet">
        {/* Header */}
        <div className="mobile-modal-header">
          <div className="mobile-modal-header-left">
            <IconSpark size={18} />
            <div>
              <h2 className="mobile-modal-title">技能与 MCP 工具</h2>
              <span className="mobile-artifact-subtitle">{endpoint || '当前 Host 已加载能力'}</span>
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
            className={`mobile-picker-tab-btn ${activeTab === 'skills' ? 'active' : ''}`}
            onClick={() => setActiveTab('skills')}
          >
            <span>已加载技能 ({SAMPLE_SKILLS.length})</span>
          </button>
          <button
            type="button"
            className={`mobile-picker-tab-btn ${activeTab === 'mcp' ? 'active' : ''}`}
            onClick={() => setActiveTab('mcp')}
          >
            <span>MCP 服务 ({SAMPLE_MCP_SERVERS.length})</span>
          </button>
        </div>

        {/* Body */}
        <div className="mobile-modal-body">
          {activeTab === 'skills' ? (
            <div className="mobile-model-list">
              <div className="mobile-drawer-section-title">生效中的 Agent 技能包</div>
              {SAMPLE_SKILLS.map((skill) => (
                <div key={skill.id} className="mobile-model-card-item">
                  <div className="mobile-model-card-info">
                    <div className="mobile-model-name-row">
                      <span className="mobile-model-name">{skill.name}</span>
                      <span
                        className="mobile-model-badge"
                        style={{ background: 'var(--iris-soft)', color: 'var(--iris)' }}
                      >
                        Active
                      </span>
                    </div>
                    <p className="mobile-model-desc" style={{ color: 'var(--text-2)', marginTop: 4 }}>
                      {skill.description}
                    </p>
                    <span
                      style={{
                        display: 'block',
                        marginTop: 4,
                        fontSize: 10,
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--text-3)',
                      }}
                    >
                      {skill.source}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mobile-model-list">
              <div className="mobile-drawer-section-title">Host 连接的 MCP 服务器</div>
              {SAMPLE_MCP_SERVERS.map((server) => (
                <div key={server.name} className="mobile-model-card-item">
                  <div className="mobile-model-card-info">
                    <div className="mobile-model-name-row">
                      <span className="mobile-model-name" style={{ fontFamily: 'var(--font-mono)' }}>
                        {server.name}
                      </span>
                      <span
                        className="mobile-tool-status-badge done"
                      >
                        ● {server.toolCount} 工具
                      </span>
                    </div>
                    <p className="mobile-model-desc" style={{ color: 'var(--text-2)', marginTop: 4 }}>
                      {server.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </MobileLayer>
  );
}
