/**
 * Modal dialog for expanded multi-line prompt editing.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Button, Dialog } from '@piwin/ui-kit';
import { IconClose } from './shell-icons';

export type ComposerModalEditorProps = {
  open: boolean;
  value: string;
  onSave: (newValue: string) => void;
  onClose: () => void;
};

export function ComposerModalEditor(props: ComposerModalEditorProps): ReactElement | null {
  const [draft, setDraft] = useState(props.value);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (props.open) {
      setDraft(props.value);
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  }, [props.open, props.value]);

  if (!props.open) {
    return null;
  }

  const lineCount = draft.split('\n').length;
  const charCount = draft.length;
  const estTokens = Math.ceil(charCount / 4);

  return (
    <Dialog
      label="Expanded Prompt Editor"
      open={props.open}
      onOpenChange={(open) => !open && props.onClose()}
    >
      <div className="composer-modal-editor" data-testid="composer-modal-editor">
        <div className="composer-modal-header">
          <div className="composer-modal-title">
            <span>Expanded Prompt Editor</span>
            <span className="composer-modal-stats muted">
              {lineCount} {lineCount === 1 ? 'line' : 'lines'} · {charCount} chars · ~{estTokens}{' '}
              tokens
            </span>
          </div>
          <button
            type="button"
            className="composer-modal-close"
            onClick={props.onClose}
            aria-label="Close modal editor"
          >
            <IconClose width={14} height={14} />
          </button>
        </div>

        <div className="composer-modal-body">
          <textarea
            ref={textareaRef}
            className="composer-modal-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type long prompt, code snippets, or structured instructions…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                props.onSave(draft);
                props.onClose();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                props.onClose();
              }
            }}
          />
        </div>

        <div className="composer-modal-footer">
          <span className="composer-modal-hint muted">⌘Enter / Ctrl+Enter to save</span>
          <div className="composer-modal-actions">
            <Button type="button" variant="secondary" onClick={props.onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                props.onSave(draft);
                props.onClose();
              }}
            >
              Apply to Prompt
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
