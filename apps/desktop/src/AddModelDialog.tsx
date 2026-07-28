import { useEffect, useState, type ReactElement } from 'react';
import { Button, Field, Modal, TextInput } from '@piwin/ui-kit';
import type { ModelConfigEntry } from '@piwin/contracts';
import { useDesktopLocale } from './desktop-locale-context';

export type AddModelDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingModelIds: readonly string[];
  onAdd: (model: ModelConfigEntry) => void;
};

export function AddModelDialog({
  open,
  onOpenChange,
  existingModelIds,
  onAdd,
}: AddModelDialogProps): ReactElement {
  const { locale, translator } = useDesktopLocale();
  const copy = translator.settings.provider;
  const common = translator.common;
  const [modelId, setModelId] = useState('');
  const [label, setLabel] = useState('');
  const [groupName, setGroupName] = useState('');
  const [contextWindow, setContextWindow] = useState('');
  const [maxOutputTokens, setMaxOutputTokens] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setModelId('');
    setLabel('');
    setGroupName('');
    setContextWindow('');
    setMaxOutputTokens('');
    setError(null);
  }, [open]);

  function submit(): void {
    const id = modelId.trim();
    if (!id) {
      setError(locale === 'zh-CN' ? '请填写模型 ID。' : 'Model ID is required.');
      return;
    }
    if (existingModelIds.includes(id)) {
      setError(locale === 'zh-CN' ? '该模型 ID 已存在。' : 'This model ID already exists.');
      return;
    }
    const model: ModelConfigEntry = { id };
    const displayName = label.trim();
    if (displayName && displayName !== id) {
      model.label = displayName;
    }
    const group = groupName.trim();
    if (group) {
      model.tooltipMarkdown = group;
    }
    const cw = Number(contextWindow.trim());
    if (contextWindow.trim() && Number.isSafeInteger(cw) && cw > 0) {
      model.contextWindow = cw;
    }
    const mo = Number(maxOutputTokens.trim());
    if (maxOutputTokens.trim() && Number.isSafeInteger(mo) && mo > 0) {
      model.maxOutputTokens = mo;
    }
    onAdd(model);
    onOpenChange(false);
  }

  return (
    <Modal
      title={copy.addModelTitle}
      open={open}
      onOpenChange={onOpenChange}
      testId="add-model-dialog"
      size="md"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Field label={copy.modelId} required error={error}>
          <TextInput
            value={modelId}
            onChange={(event) => setModelId(event.currentTarget.value)}
            placeholder={copy.modelIdPlaceholder}
            spellCheck={false}
            data-testid="add-model-id-input"
            autoFocus
          />
        </Field>
        <Field label={copy.modelDisplayName}>
          <TextInput
            value={label}
            onChange={(event) => setLabel(event.currentTarget.value)}
            placeholder={copy.modelNamePlaceholder}
            data-testid="add-model-label-input"
          />
        </Field>
        <Field label={copy.modelGroupName}>
          <TextInput
            value={groupName}
            onChange={(event) => setGroupName(event.currentTarget.value)}
            placeholder={copy.modelGroupPlaceholder}
            data-testid="add-model-group-input"
          />
        </Field>
        <div style={{ display: 'flex', gap: '16px' }}>
          <div style={{ flex: 1 }}>
            <Field label={copy.contextLimit}>
              <TextInput
                value={contextWindow}
                onChange={(event) => setContextWindow(event.currentTarget.value)}
                placeholder={locale === 'zh-CN' ? '128000' : '128000'}
                spellCheck={false}
                data-testid="add-model-context-input"
              />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label={copy.outputLimit}>
              <TextInput
                value={maxOutputTokens}
                onChange={(event) => setMaxOutputTokens(event.currentTarget.value)}
                placeholder={locale === 'zh-CN' ? '16384' : '16384'}
                spellCheck={false}
                data-testid="add-model-output-input"
              />
            </Field>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
        <Button onClick={() => onOpenChange(false)}>
          {common.cancel}
        </Button>
        <Button variant="primary" onClick={submit} data-testid="add-model-submit">
          {copy.addModelAction}
        </Button>
      </div>
    </Modal>
  );
}
