import { useState } from 'react';
import { Button, TextInput, TextArea } from '@piwin/ui-kit';
import { useRendererRelaunchGuard } from '../hooks/use-renderer-relaunch-guard.js';

export function NoteEditor(props: {
  initialTitle: string;
  initialContent: string;
  busy: boolean;
  isZh: boolean;
  onSave: (input: { title: string; content: string }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(props.initialTitle);
  const [content, setContent] = useState(props.initialContent);
  useRendererRelaunchGuard(
    props.busy || title !== props.initialTitle || content !== props.initialContent,
  );
  const isZh = props.isZh;

  return (
    <div className="notes-editor-card" data-testid="notes-editor">
      <h4>
        {props.initialTitle ? (isZh ? '编辑笔记' : 'Edit Note') : isZh ? '新建笔记' : 'New Note'}
      </h4>
      <div className="notes-editor-title-wrap">
        <TextInput
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={isZh ? '笔记标题…' : 'Title…'}
          data-testid="notes-editor-title"
        />
      </div>
      <div className="notes-editor-content-wrap">
        <TextArea
          value={content}
          onChange={(val) => setContent(val)}
          placeholder={isZh ? '输入 Markdown 格式内容…' : 'Markdown content…'}
          testId="notes-editor-content"
          rows={12}
        />
      </div>
      <div className="notes-editor-actions">
        <Button
          variant="primary"
          disabled={props.busy || !title.trim() || !content.trim()}
          data-testid="notes-editor-save"
          onClick={() => props.onSave({ title: title.trim(), content })}
        >
          💾 {isZh ? '保存笔记' : 'Save'}
        </Button>
        <Button variant="secondary" onClick={props.onCancel}>
          {isZh ? '取消' : 'Cancel'}
        </Button>
      </div>
    </div>
  );
}
