import type { ReactElement } from 'react';
import { Redo2, Undo2 } from 'lucide-react';
import { Button, IconButton, SegmentedControl } from '@piwin/ui-kit';
import type { DesktopLocale } from '../i18n/desktop-locale.js';
import type { AnnotationTool } from './annotation-model.js';

const TOOL_ORDER: readonly AnnotationTool[] = ['rect', 'arrow', 'text', 'crop'];

const TOOL_LABELS: Record<DesktopLocale, Record<AnnotationTool, string>> = {
  'zh-CN': { rect: '矩形 R', arrow: '箭头 A', text: '文字 T', crop: '裁剪 C' },
  en: { rect: 'Box R', arrow: 'Arrow A', text: 'Text T', crop: 'Crop C' },
};

export type AnnotationToolbarProps = {
  locale: DesktopLocale;
  tool: AnnotationTool;
  onToolChange: (tool: AnnotationTool) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  exporting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function isAnnotationTool(value: string): value is AnnotationTool {
  return (TOOL_ORDER as readonly string[]).includes(value);
}

export function AnnotationToolbar(props: AnnotationToolbarProps): ReactElement {
  const isZh = props.locale === 'zh-CN';
  return (
    <div className="screen-capture-toolbar">
      <SegmentedControl
        testId="screen-capture-tools"
        value={props.tool}
        onChange={(value) => {
          if (isAnnotationTool(value)) {
            props.onToolChange(value);
          }
        }}
        data={TOOL_ORDER.map((tool) => ({ value: tool, label: TOOL_LABELS[props.locale][tool] }))}
      />
      <IconButton label={isZh ? '撤销' : 'Undo'} disabled={!props.canUndo} onClick={props.onUndo}>
        <Undo2 size={16} />
      </IconButton>
      <IconButton label={isZh ? '重做' : 'Redo'} disabled={!props.canRedo} onClick={props.onRedo}>
        <Redo2 size={16} />
      </IconButton>
      <span className="screen-capture-toolbar-spacer" />
      <Button variant="ghost" onClick={props.onCancel}>
        {isZh ? '取消' : 'Cancel'}
      </Button>
      <Button
        variant="primary"
        disabled={props.exporting}
        onClick={props.onConfirm}
        data-testid="screen-capture-confirm"
      >
        {isZh ? '添加到对话' : 'Add to chat'}
      </Button>
    </div>
  );
}
