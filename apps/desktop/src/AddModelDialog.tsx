import { useEffect, useState, type ReactElement } from 'react';
import { Button, Dialog, IconButton } from '@piwin/ui-kit';
import type { ModelConfigEntry } from '@piwin/contracts';
import { useDesktopLocale } from './desktop-locale-context';
import { IconClose } from './shell-icons';

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
    <Dialog
      label={copy.addModelTitle}
      open={open}
      onOpenChange={onOpenChange}
      testId="add-model-dialog"
      closeOnInteractOutside
    >
      <div className="cherry-dialog">
        <header className="cherry-dialog-header">
          <h3>{copy.addModelTitle}</h3>
          <IconButton label={common.close} onClick={() => onOpenChange(false)}>
            <IconClose width={16} height={16} />
          </IconButton>
        </header>
        <div className="cherry-dialog-body">
          <label className="cherry-field">
            <span>
              <em aria-hidden>*</em>
              {copy.modelId}
            </span>
            <input
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              placeholder={copy.modelIdPlaceholder}
              spellCheck={false}
              data-testid="add-model-id-input"
              autoFocus
            />
          </label>
          <label className="cherry-field">
            <span>{copy.modelDisplayName}</span>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={copy.modelNamePlaceholder}
              data-testid="add-model-label-input"
            />
          </label>
          <label className="cherry-field">
            <span>{copy.modelGroupName}</span>
            <input
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              placeholder={copy.modelGroupPlaceholder}
              data-testid="add-model-group-input"
            />
          </label>
          <div className="cherry-dialog-row">
            <label className="cherry-field">
              <span>{copy.contextLimit}</span>
              <input
                value={contextWindow}
                onChange={(event) => setContextWindow(event.target.value)}
                placeholder={locale === 'zh-CN' ? '128000' : '128000'}
                spellCheck={false}
                data-testid="add-model-context-input"
              />
            </label>
            <label className="cherry-field">
              <span>{copy.outputLimit}</span>
              <input
                value={maxOutputTokens}
                onChange={(event) => setMaxOutputTokens(event.target.value)}
                placeholder={locale === 'zh-CN' ? '16384' : '16384'}
                spellCheck={false}
                data-testid="add-model-output-input"
              />
            </label>
          </div>
          {error ? <p className="cherry-inline-error">{error}</p> : null}
        </div>
        <footer className="cherry-dialog-footer">
          <Button onClick={() => onOpenChange(false)}>
            {common.cancel}
          </Button>
          <Button variant="primary" onClick={submit} data-testid="add-model-submit">
            {copy.addModelAction}
          </Button>
        </footer>
      </div>
    </Dialog>
  );
}
