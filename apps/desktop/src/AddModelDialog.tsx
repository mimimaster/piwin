import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Button, Field, Modal, TextInput } from '@piwin/ui-kit';
import type { ModelCatalogEntry, ModelConfigEntry } from '@piwin/contracts';
import { useDesktopLocale } from './desktop-locale-context';

export type AddModelDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingModelIds: readonly string[];
  onAdd: (model: ModelConfigEntry) => void;
  /** Optional catalog autocomplete (host `models/catalog/search`). */
  searchCatalog?: (query: string) => Promise<ModelCatalogEntry[]>;
};

export function AddModelDialog({
  open,
  onOpenChange,
  existingModelIds,
  onAdd,
  searchCatalog,
}: AddModelDialogProps): ReactElement {
  const { locale, translator } = useDesktopLocale();
  const copy = translator.settings.provider;
  const common = translator.common;
  const isChinese = locale === 'zh-CN';
  const [modelId, setModelId] = useState('');
  const [label, setLabel] = useState('');
  const [groupName, setGroupName] = useState('');
  const [contextWindow, setContextWindow] = useState('');
  const [maxOutputTokens, setMaxOutputTokens] = useState('');
  const [supportsImage, setSupportsImage] = useState(false);
  const [reasoning, setReasoning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<ModelCatalogEntry[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setModelId('');
    setLabel('');
    setGroupName('');
    setContextWindow('');
    setMaxOutputTokens('');
    setSupportsImage(false);
    setReasoning(true);
    setError(null);
    setSuggestions([]);
    setCatalogOpen(false);
  }, [open]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) {
        clearTimeout(searchTimer.current);
      }
    };
  }, []);

  function applyCatalogEntry(entry: ModelCatalogEntry): void {
    setModelId(entry.modelId);
    setLabel(entry.name !== entry.modelId ? entry.name : '');
    setContextWindow(String(entry.contextWindow));
    setMaxOutputTokens(String(entry.maxTokens));
    setSupportsImage(entry.input.includes('image'));
    setReasoning(entry.reasoning);
    setCatalogOpen(false);
    setSuggestions([]);
  }

  function onModelIdChange(value: string): void {
    setModelId(value);
    if (!searchCatalog) {
      return;
    }
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
    }
    const query = value.trim();
    if (query.length < 2) {
      setSuggestions([]);
      setCatalogOpen(false);
      return;
    }
    searchTimer.current = setTimeout(() => {
      void searchCatalog(query)
        .then((entries) => {
          setSuggestions(entries.slice(0, 8));
          setCatalogOpen(entries.length > 0);
        })
        .catch(() => {
          setSuggestions([]);
          setCatalogOpen(false);
        });
    }, 200);
  }

  function submit(): void {
    const id = modelId.trim();
    if (!id) {
      setError(isChinese ? '请填写模型 ID。' : 'Model ID is required.');
      return;
    }
    if (existingModelIds.includes(id)) {
      setError(isChinese ? '该模型 ID 已存在。' : 'This model ID already exists.');
      return;
    }
    const model: ModelConfigEntry = {
      id,
      input: supportsImage ? ['text', 'image'] : ['text'],
      reasoning,
    };
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
          <div style={{ position: 'relative' }}>
            <TextInput
              value={modelId}
              onChange={(event) => onModelIdChange(event.currentTarget.value)}
              placeholder={copy.modelIdPlaceholder}
              spellCheck={false}
              data-testid="add-model-id-input"
              autoFocus
              onFocus={() => {
                if (suggestions.length > 0) setCatalogOpen(true);
              }}
            />
            {catalogOpen && suggestions.length > 0 ? (
              <ul
                data-testid="add-model-catalog-suggestions"
                style={{
                  position: 'absolute',
                  zIndex: 20,
                  left: 0,
                  right: 0,
                  top: '100%',
                  margin: 0,
                  padding: '4px 0',
                  listStyle: 'none',
                  background: 'var(--surface, #1a1d24)',
                  border: '1px solid var(--line-soft)',
                  borderRadius: 8,
                  maxHeight: 220,
                  overflow: 'auto',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                }}
              >
                {suggestions.map((entry) => (
                  <li key={`${entry.catalogProviderId}:${entry.modelId}`}>
                    <button
                      type="button"
                      onClick={() => applyCatalogEntry(entry)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 12px',
                        background: 'transparent',
                        border: 0,
                        color: 'var(--text)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>
                        {entry.modelId}
                      </div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {entry.catalogProviderId}
                        {entry.input.includes('image') ? ' · vision' : ''}
                        {entry.reasoning ? ' · reasoning' : ''}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Field>
        <Field label={copy.modelDisplayName}>
          <TextInput
            value={label}
            onChange={(event) => setLabel(event.currentTarget.value)}
            placeholder={copy.modelNamePlaceholder}
            data-testid="add-model-label-input"
          />
        </Field>
        <Field label={copy.modelTooltipLabel}>
          <TextInput
            value={groupName}
            onChange={(event) => setGroupName(event.currentTarget.value)}
            placeholder={copy.modelTooltipPlaceholder}
            data-testid="add-model-tooltip-input"
          />
        </Field>
        <div style={{ display: 'flex', gap: '16px' }}>
          <div style={{ flex: 1 }}>
            <Field label={copy.contextLimit}>
              <TextInput
                value={contextWindow}
                onChange={(event) => setContextWindow(event.currentTarget.value)}
                placeholder="128000"
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
                placeholder="16384"
                spellCheck={false}
                data-testid="add-model-output-input"
              />
            </Field>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={supportsImage}
              onChange={(event) => setSupportsImage(event.currentTarget.checked)}
              data-testid="add-model-supports-image"
            />
            {isChinese ? '支持图像输入（Vision）' : 'Supports image input (Vision)'}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={reasoning}
              onChange={(event) => setReasoning(event.currentTarget.checked)}
              data-testid="add-model-reasoning"
            />
            {isChinese ? '支持推理 / Thinking' : 'Supports reasoning / thinking'}
          </label>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
        <Button onClick={() => onOpenChange(false)}>{common.cancel}</Button>
        <Button variant="primary" onClick={submit} data-testid="add-model-submit">
          {copy.addModelAction}
        </Button>
      </div>
    </Modal>
  );
}
