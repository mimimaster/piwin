import { useState, type ReactElement } from 'react';
import type { ConfiguredChatModel, ThinkingLevel } from '@piwin/contracts';
import {
  IconBrain,
  IconCheck,
  IconClose,
  IconSpark,
} from '@piwin/ui-kit';

export type { ThinkingLevel };

export type ModelPickerModalProps = {
  isOpen: boolean;
  onClose: () => void;
  models: readonly ConfiguredChatModel[];
  selectedProviderId?: string | undefined;
  selectedModelId?: string | undefined;
  selectedThinkingLevel?: ThinkingLevel | undefined;
  onSelectModel: (modelId: string, providerId: string) => void;
  onSelectThinkingLevel: (level: ThinkingLevel) => void;
};

const THINKING_LEVELS: Array<{ level: ThinkingLevel; label: string; desc: string }> = [
  { level: 'off', label: '关闭思考', desc: '即时快速直接响应' },
  { level: 'minimal', label: '最低思考', desc: '尽量短的推理痕迹' },
  { level: 'low', label: '轻量思考', desc: '简要推理思考' },
  { level: 'medium', label: '标准思考', desc: '完整逻辑推演' },
  { level: 'high', label: '深度思考', desc: '复杂问题全维度穷尽推演' },
  { level: 'xhigh', label: '更高思考', desc: '更长的推理预算' },
  { level: 'max', label: '最大思考', desc: '模型协议允许的最高档' },
  { level: 'ultra', label: '增强思考', desc: '产品增强档，Host 映射到协议上限' },
];

function modelLabel(model: ConfiguredChatModel): string {
  return model.label?.trim() || model.modelId;
}

export function ModelPickerModal({
  isOpen,
  onClose,
  models,
  selectedProviderId,
  selectedModelId,
  selectedThinkingLevel = 'off',
  onSelectModel,
  onSelectThinkingLevel,
}: ModelPickerModalProps): ReactElement | null {
  const [activeTab, setActiveTab] = useState<'model' | 'thinking'>('model');

  if (!isOpen) {
    return null;
  }

  const currentModel =
    models.find(
      (model) => model.providerId === selectedProviderId && model.modelId === selectedModelId,
    ) ?? models[0];
  const thinkingOptions = THINKING_LEVELS.filter((item) =>
    currentModel?.thinkingLevels?.includes(item.level),
  );
  const showThinkingTab = thinkingOptions.length > 0;

  return (
    <div className="mobile-drawer-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="mobile-model-picker-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mobile-sheet-header">
          <div className="mobile-sheet-title-group">
            <div className="mobile-sheet-icon-wrap">
              <IconBrain size={18} />
            </div>
            <div>
              <h3 className="mobile-sheet-title">模型与推理配置</h3>
              <p className="mobile-sheet-sub">
                当前：{currentModel ? modelLabel(currentModel) : '未配置模型'}
              </p>
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

        {showThinkingTab ? (
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
        ) : null}

        <div className="mobile-picker-content">
          {activeTab === 'thinking' && showThinkingTab ? (
            <div className="mobile-thinking-list">
              {thinkingOptions.map((item) => {
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
          ) : (
            <div className="mobile-model-list">
              {models.length === 0 ? (
                <p className="mobile-model-desc">Host 尚未返回可用聊天模型。</p>
              ) : (
                models.map((model) => {
                  const isSelected =
                    model.providerId === selectedProviderId && model.modelId === selectedModelId;
                  return (
                    <button
                      key={`${model.providerId}::${model.modelId}`}
                      type="button"
                      className={`mobile-model-card-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => {
                        onSelectModel(model.modelId, model.providerId);
                        onClose();
                      }}
                    >
                      <div className="mobile-model-card-info">
                        <div className="mobile-model-name-row">
                          <span className="mobile-model-name">{modelLabel(model)}</span>
                          <span className="mobile-model-badge">{model.providerId}</span>
                        </div>
                        <p className="mobile-model-desc">{model.modelId}</p>
                      </div>
                      <div className="mobile-model-check-wrap">
                        {isSelected ? <IconCheck size={16} className="selected-check" /> : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
