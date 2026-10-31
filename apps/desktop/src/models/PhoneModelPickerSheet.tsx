/**
 * Phone model and thinking effort picker sheet.
 *
 * Designed for mobile touch interaction:
 * - Single-scroll container with touch-action: pan-y (no nested scroll traps).
 * - "常用" (Recent) tab backed by automatic recent-models tracking.
 * - "全部模型" (All Models) grouped by vendor with default-collapsed accordions
 *   (only the active model's vendor is expanded on initial open).
 * - Compact inline thinking pills (Low / Med / High / xHigh etc.) on model cards.
 * - Zero star clutter, no redundant hints.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { ThinkingLevel } from '@piwin/contracts';
import { IconClose, IconSearch } from '../tool-cards/shell-icons';
import { getSupportedThinkingLevels } from './model-thinking-policy';
import { useDesktopLocale } from '../i18n/desktop-locale-context';
import { formatThinkingLabel } from '../usage/usage-panel-statistics.js';
import {
  readRecentModels,
  pushRecentModel,
  readModelLastThinking,
  saveModelLastThinking,
} from './recent-models';
import type { ThinkingEffortModelOption } from './ThinkingEffortControl';

export type PhoneModelPickerSheetProps = {
  models: readonly ThinkingEffortModelOption[];
  selectedModelKey: string;
  currentEffort: ThinkingLevel;
  ultraEnabled: boolean;
  disabled: boolean;
  onSelect: (modelKey: string, effort?: ThinkingLevel) => void;
  onClose: () => void;
};

export function formatInlineThinkingLabel(level: ThinkingLevel, isZh: boolean): string {
  if (isZh) {
    return formatThinkingLabel(level, true);
  }
  switch (level) {
    case 'off':
      return 'Off';
    case 'minimal':
      return 'Min';
    case 'low':
      return 'Low';
    case 'medium':
      return 'Med';
    case 'high':
      return 'High';
    case 'xhigh':
      return 'xHigh';
    case 'max':
      return 'Max';
    case 'ultra':
      return 'Ultra';
    default:
      return level;
  }
}

export function parseModelVendorAndName(model: ThinkingEffortModelOption): {
  vendor: string;
  name: string;
} {
  const providerName = model.providerName?.trim();
  const trimmed = model.label.trim();
  const slashParts = trimmed.split(/\s*\/\s*/);
  if (slashParts.length > 1 && slashParts[0]) {
    return {
      vendor: providerName || slashParts[0],
      name: slashParts.slice(1).join(' / '),
    };
  }
  return {
    vendor: providerName || model.providerId || 'Other',
    name: trimmed || 'Model',
  };
}

export function PhoneModelPickerSheet({
  models,
  selectedModelKey,
  currentEffort,
  ultraEnabled,
  disabled,
  onSelect,
  onClose,
}: PhoneModelPickerSheetProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const [activeTab, setActiveTab] = useState<'recent' | 'all'>('recent');
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedVendors, setCollapsedVendors] = useState<Record<string, boolean>>({});
  const hasInitializedAllTab = useRef(false);

  const selectedModel = useMemo(
    () => models.find((m) => m.key === selectedModelKey),
    [models, selectedModelKey],
  );

  const selectedVendor = useMemo(() => {
    if (!selectedModel) return null;
    return parseModelVendorAndName(selectedModel).vendor;
  }, [selectedModel]);

  // Initial accordion setup: only the currently active model's vendor is expanded.
  const resetVendorAccordions = (): void => {
    const nextCollapsed: Record<string, boolean> = {};
    for (const m of models) {
      const { vendor } = parseModelVendorAndName(m);
      if (!(vendor in nextCollapsed)) {
        nextCollapsed[vendor] = vendor !== selectedVendor;
      }
    }
    setCollapsedVendors(nextCollapsed);
  };

  useEffect(() => {
    if (activeTab === 'all' && !hasInitializedAllTab.current) {
      resetVendorAccordions();
      hasInitializedAllTab.current = true;
    }
  }, [activeTab, selectedVendor]);

  // Recent models: read from recent-models store, fallback to first 3 models if none stored.
  const recentModels = useMemo(() => {
    const keys = readRecentModels();
    const matches = keys
      .map((k) => models.find((m) => m.key === k))
      .filter((m): m is ThinkingEffortModelOption => m !== undefined);
    if (matches.length > 0) return matches;
    return models.slice(0, 4);
  }, [models]);

  // Filtered models for search.
  const filteredModels = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return null;
    return models.filter((m) => {
      const { vendor, name } = parseModelVendorAndName(m);
      const haystack = [m.label, m.providerName ?? '', m.providerId ?? '', vendor, name]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [models, searchQuery]);

  // Grouped by vendor for "全部模型" tab.
  const vendorGroups = useMemo(() => {
    const groups = new Map<string, ThinkingEffortModelOption[]>();
    for (const m of models) {
      const { vendor } = parseModelVendorAndName(m);
      const list = groups.get(vendor) ?? [];
      list.push(m);
      groups.set(vendor, list);
    }
    return Array.from(groups.entries());
  }, [models]);

  function handleChooseModel(model: ThinkingEffortModelOption): void {
    pushRecentModel(model.key);
    const levels = getSupportedThinkingLevels(model, ultraEnabled);
    let targetLevel: ThinkingLevel | undefined;
    if (levels.length > 0) {
      const last = readModelLastThinking(model.key) as ThinkingLevel | undefined;
      if (last && levels.includes(last)) {
        targetLevel = last;
      } else if (levels.includes(currentEffort)) {
        targetLevel = currentEffort;
      } else {
        targetLevel = levels[0];
      }
    }
    onSelect(model.key, targetLevel);
    onClose();
  }

  function handleChooseEffort(
    event: React.MouseEvent,
    model: ThinkingEffortModelOption,
    level: ThinkingLevel,
  ): void {
    event.stopPropagation();
    pushRecentModel(model.key);
    saveModelLastThinking(model.key, level);
    onSelect(model.key, level);
    onClose();
  }

  function toggleVendor(vendor: string): void {
    setCollapsedVendors((prev) => ({
      ...prev,
      [vendor]: !prev[vendor],
    }));
  }

  function renderModelRow(model: ThinkingEffortModelOption, showVendor = true): ReactElement {
    const isSelected = model.key === selectedModelKey;
    const { vendor, name } = parseModelVendorAndName(model);
    const levels = getSupportedThinkingLevels(model, ultraEnabled);
    const lastLevel = readModelLastThinking(model.key) as ThinkingLevel | undefined;

    return (
      <div
        key={model.key}
        className={`phone-model-card ${isSelected ? 'is-selected' : ''}`}
        onClick={() => handleChooseModel(model)}
        role="button"
        tabIndex={0}
        data-testid={`phone-model-card-${model.key}`}
      >
        <div className="phone-model-info">
          <span className="phone-model-name" title={model.label}>
            {name}
          </span>
          {showVendor ? <span className="phone-model-vendor">{vendor}</span> : null}
        </div>

        {levels.length > 0 ? (
          <div
            className="phone-model-effort-cluster"
            onClick={(e) => e.stopPropagation()}
            role="toolbar"
            aria-label="Effort levels"
          >
            {levels.map((lvl) => {
              const isActive = isSelected && currentEffort === lvl;
              const isLastHint = !isSelected && lastLevel === lvl;
              const pillClass = `phone-effort-pill ${isActive ? 'is-active' : ''} ${
                isLastHint ? 'is-last-hint' : ''
              }`;
              return (
                <button
                  key={lvl}
                  type="button"
                  className={pillClass}
                  disabled={disabled}
                  onClick={(e) => handleChooseEffort(e, model, lvl)}
                  data-testid={`phone-effort-${model.key}-${lvl}`}
                >
                  {formatInlineThinkingLabel(lvl, isZh)}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="phone-model-picker-sheet" data-testid="phone-model-picker-sheet">
      {/* 1. Header with search and close button */}
      <div className="phone-model-sheet-header">
        <div className="phone-model-search-row">
          <div className="phone-model-search-box">
            <IconSearch width={13} height={13} aria-hidden />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isZh ? '搜索模型或厂商…' : 'Search models or providers…'}
              data-testid="thinking-model-search-input"
              spellCheck={false}
              autoComplete="off"
            />
            {searchQuery ? (
              <button
                type="button"
                className="phone-model-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                <IconClose width={12} height={12} />
              </button>
            ) : null}
          </div>

          <button
            type="button"
            className="phone-model-sheet-close"
            onClick={onClose}
            aria-label="Close"
            data-testid="phone-model-sheet-close"
          >
            ✕
          </button>
        </div>

        {/* 2. Tabs Row: 常用 (Recent) / 全部模型 (All Models) without hint text */}
        {!searchQuery ? (
          <div className="phone-model-tabs-row" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'recent'}
              className={`phone-model-tab ${activeTab === 'recent' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('recent')}
              data-testid="phone-model-tab-recent"
            >
              <span>{isZh ? '常用' : 'Recent'}</span>
              <span className="phone-model-tab-count">{recentModels.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'all'}
              className={`phone-model-tab ${activeTab === 'all' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('all')}
              data-testid="phone-model-tab-all"
            >
              <span>{isZh ? '全部模型' : 'All Models'}</span>
              <span className="phone-model-tab-count">{models.length}</span>
            </button>
          </div>
        ) : null}
      </div>

      {/* 3. Single Scrollable Container */}
      <div className="phone-model-sheet-body">
        {searchQuery ? (
          filteredModels && filteredModels.length > 0 ? (
            <div className="phone-model-list-group">
              {filteredModels.map((m) => renderModelRow(m, true))}
            </div>
          ) : (
            <div className="phone-model-empty">
              {isZh
                ? `没有匹配“${searchQuery.trim()}”的模型`
                : `No models match “${searchQuery.trim()}”`}
            </div>
          )
        ) : activeTab === 'recent' ? (
          <div className="phone-model-list-group">
            {recentModels.map((m) => renderModelRow(m, true))}
          </div>
        ) : (
          <div className="phone-model-vendor-groups">
            {vendorGroups.map(([vendor, groupModels]) => {
              const isClosed = Boolean(collapsedVendors[vendor]);
              const isCurrentVendor = vendor === selectedVendor;
              return (
                <div key={vendor} className="phone-model-vendor-section">
                  <button
                    type="button"
                    className="phone-model-vendor-header"
                    onClick={() => toggleVendor(vendor)}
                    data-testid={`phone-vendor-header-${vendor}`}
                  >
                    <span className="phone-model-vendor-title">
                      <span>{vendor}</span>
                      <span className="phone-model-vendor-count">{groupModels.length}</span>
                      {isCurrentVendor ? <span className="phone-model-vendor-dot" /> : null}
                    </span>
                    <span className={`phone-model-vendor-arrow ${isClosed ? 'is-closed' : ''}`}>
                      ▾
                    </span>
                  </button>
                  {!isClosed ? (
                    <div className="phone-model-vendor-body">
                      {groupModels.map((m) => renderModelRow(m, false))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
