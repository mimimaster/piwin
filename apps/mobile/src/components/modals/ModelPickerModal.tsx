import { useState, type ReactElement } from 'react';
import {
  IconBrain,
  IconCheck,
  IconClose,
  IconSpark,
} from '@piwin/ui-kit';

export type ModelOption = {
  id: string;
  providerId: string;
  name: string;
  badge?: string | undefined;
  supportsThinking?: boolean | undefined;
  description?: string | undefined;
};

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';

export type ModelPickerModalProps = {
  isOpen: boolean;
  onClose: () => void;
  selectedModelId?: string | undefined;
  selectedThinkingLevel?: ThinkingLevel | undefined;
  onSelectModel: (modelId: string, providerId: string) => void;
  onSelectThinkingLevel: (level: ThinkingLevel) => void;
};

const POPULAR_MODELS: ModelOption[] = [
  {
    id: 'claude-3-7-sonnet',
    providerId: 'anthropic',
    name: 'Claude 3.7 Sonnet',
    badge: '推荐',
    supportsThinking: true,
    description: 'Anthropic 最新混合推理旗舰模型，支持深度思考与复杂架构编码',
  },
  {
    id: 'claude-3-5-sonnet',
    providerId: 'anthropic',
    name: 'Claude 3.5 Sonnet',
    supportsThinking: false,
    description: '极速、精准的经典主力开发模型',
  },
  {
    id: 'gpt-4o',
    providerId: 'openai',
    name: 'GPT-4o',
    supportsThinking: false,
    description: 'OpenAI 多模态旗舰模型，兼具速度与全能表现',
  },
  {
    id: 'o3-mini',
    providerId: 'openai',
    name: 'o3-mini',
    badge: '推理',
    supportsThinking: true,
    description: '专为数学、逻辑与代码深度推理优化的微型推理模型',
  },
  {
    id: 'grok-2',
    providerId: 'xai',
    name: 'Grok 2',
    supportsThinking: false,
    description: 'xAI 实时搜索与代码辅助模型',
  },
];

const THINKING_LEVELS: Array<{ level: ThinkingLevel; label: string; desc: string }> = [
  { level: 'off', label: '关闭思考', desc: '即时快速直接响应' },
  { level: 'low', label: '轻量思考', desc: '简要推理思考 (约 2k tokens)' },
  { level: 'medium', label: '标准思考', desc: '完整逻辑推演 (约 8k tokens)' },
  { level: 'high', label: '深度思考', desc: '复杂问题全维度穷尽推演' },
];

export function ModelPickerModal({
  isOpen,
  onClose,
  selectedModelId = 'claude-3-7-sonnet',
  selectedThinkingLevel = 'medium',
  onSelectModel,
  onSelectThinkingLevel,
}: ModelPickerModalProps): ReactElement | null {
  const [activeTab, setActiveTab] = useState<'model' | 'thinking'>('model');

  if (!isOpen) {
    return null;
  }

  const currentModel = POPULAR_MODELS.find((m) => m.id === selectedModelId) ?? POPULAR_MODELS[0]!;

  return (
    <div className="mobile-drawer-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="mobile-model-picker-sheet" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="mobile-sheet-header">
          <div className="mobile-sheet-title-group">
            <div className="mobile-sheet-icon-wrap">
              <IconBrain size={18} />
            </div>
            <div>
              <h3 className="mobile-sheet-title">模型与推理配置</h3>
              <p className="mobile-sheet-sub">当前：{currentModel.name}</p>
            </div>
          </div>
          <button
            type="button"
            className="mobile-drawer-close-btn"
            onClick={onClose}
            aria-label="关闭"
          >
            <IconClose size={18} />
          </button>
        </div>

        {/* Segmented Switcher */}
        <div className="mobile-picker-tabs">
          <button
            type="button"
            className={`mobile-picker-tab-btn ${activeTab === 'model' ? 'active' : ''}`}
            onClick={() => setActiveTab('model')}
          >
            <IconSpark size={14} />
            <span>选择模型</span>
          </button>
          <button
            type="button"
            className={`mobile-picker-tab-btn ${activeTab === 'thinking' ? 'active' : ''}`}
            onClick={() => setActiveTab('thinking')}
          >
            <IconBrain size={14} />
            <span>思考等级</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="mobile-picker-content">
          {activeTab === 'model' ? (
            <div className="mobile-model-list">
              {POPULAR_MODELS.map((model) => {
                const isSelected = model.id === selectedModelId;
                return (
                  <button
                    key={model.id}
                    type="button"
                    className={`mobile-model-card-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      onSelectModel(model.id, model.providerId);
                      onClose();
                    }}
                  >
                    <div className="mobile-model-card-info">
                      <div className="mobile-model-name-row">
                        <span className="mobile-model-name">{model.name}</span>
                        {model.badge ? (
                          <span className="mobile-model-badge">{model.badge}</span>
                        ) : null}
                      </div>
                      {model.description ? (
                        <p className="mobile-model-desc">{model.description}</p>
                      ) : null}
                    </div>

                    <div className="mobile-model-check-wrap">
                      {isSelected ? <IconCheck size={16} className="selected-check" /> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mobile-thinking-list">
              {THINKING_LEVELS.map((item) => {
                const isSelected = item.level === selectedThinkingLevel;
                return (
                  <button
                    key={item.level}
                    type="button"
                    className={`mobile-thinking-card-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      onSelectThinkingLevel(item.level);
                      onClose();
                    }}
                  >
                    <div className="mobile-thinking-info">
                      <span className="mobile-thinking-label">{item.label}</span>
                      <span className="mobile-thinking-desc">{item.desc}</span>
                    </div>

                    <div className="mobile-model-check-wrap">
                      {isSelected ? <IconCheck size={16} className="selected-check" /> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
