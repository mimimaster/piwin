import { Modal } from '@piwin/ui-kit';
import type { ReactElement } from 'react';
import { ProviderIcon } from './provider-icons.js';
import {
  PROVIDER_GROUP_LABELS,
  presetDesc,
  presetTitle,
  presetsByGroup,
  type ProviderPreset,
} from './provider-presets.js';

type ProviderAddCopy = {
  addProviderTitle: string;
  addProviderDesc?: string;
};

export type ProviderAddDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isChinese: boolean;
  copy: ProviderAddCopy;
  onAdd: (preset: ProviderPreset) => void;
};

export function ProviderAddDialog({
  open,
  onOpenChange,
  isChinese,
  copy,
  onAdd,
}: ProviderAddDialogProps): ReactElement {
  return (
    <Modal
      title={copy.addProviderTitle}
      open={open}
      onOpenChange={onOpenChange}
      testId="provider-add-dialog"
      size="lg"
    >
      {/* Custom endpoints lead: they back most configured providers. */}
      {copy.addProviderDesc && (
        <p className="provider-add-dialog-desc muted" data-testid="provider-add-dialog-desc">
          {copy.addProviderDesc}
        </p>
      )}
      <div className="provider-preset-picker" data-testid="provider-preset-picker">
        {(
          Object.entries(presetsByGroup()) as Array<[ProviderPreset['group'], ProviderPreset[]]>
        ).map(([group, presets]) => {
          if (presets.length === 0) return null;
          const groupLabel = isChinese
            ? (
                {
                  cloud: '云厂商',
                  gateway: '网关 / 聚合',
                  local: '本地',
                  custom: '自定义接口',
                } as const
              )[group]
            : PROVIDER_GROUP_LABELS[group];
          return (
            <section key={group} className="provider-preset-group">
              <h4 className="provider-preset-group-title">{groupLabel}</h4>
              <ul
                className={`provider-preset-grid${group === 'custom' ? ' provider-preset-grid--featured' : ''}`}
              >
                {presets.map((preset) => (
                  <li key={preset.presetId}>
                    <button
                      type="button"
                      className="provider-preset-card"
                      data-testid={`provider-preset-${preset.presetId}`}
                      onClick={() => onAdd(preset)}
                    >
                      <ProviderIcon id={preset.presetId} size={32} />
                      <span className="provider-preset-card-text">
                        <strong className="provider-preset-card-name">
                          {presetTitle(preset, isChinese)}
                        </strong>
                        <span className="provider-preset-card-meta muted">
                          {presetDesc(preset, isChinese)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
