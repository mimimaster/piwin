import type { ReactElement } from 'react';
import {
  Check,
  Crop,
  MoveUpRight,
  Redo2,
  Square,
  Type,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { IconButton } from '@piwin/ui-kit';
import type { DesktopLocale } from '../i18n/desktop-locale.js';
import {
  detectShortcutDisplayPlatform,
  formatShortcutChordTokens,
} from '../platform/desktop-shortcut-catalog.js';
import type { AnnotationTool } from './annotation-model.js';

const BUTTON_SIZE = 30;

type ToolEntry = { tool: AnnotationTool; icon: LucideIcon; key: string };

const TOOLS: readonly ToolEntry[] = [
  { tool: 'rect', icon: Square, key: 'R' },
  { tool: 'arrow', icon: MoveUpRight, key: 'A' },
  { tool: 'text', icon: Type, key: 'T' },
  { tool: 'crop', icon: Crop, key: 'C' },
];

const TOOL_NAMES: Record<DesktopLocale, Record<AnnotationTool, string>> = {
  'zh-CN': { rect: '矩形', arrow: '箭头', text: '文字', crop: '裁剪' },
  en: { rect: 'Box', arrow: 'Arrow', text: 'Text', crop: 'Crop' },
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

function chordLabel(chord: string): string {
  const platform = detectShortcutDisplayPlatform();
  return formatShortcutChordTokens(chord, platform).join(platform === 'apple' ? '' : '+');
}

/** Floating icon strip; names and keys live in tooltips, not on the buttons. */
export function AnnotationToolbar(props: AnnotationToolbarProps): ReactElement {
  const isZh = props.locale === 'zh-CN';
  const names = TOOL_NAMES[props.locale];
  return (
    <div
      className="screen-capture-toolbar"
      role="toolbar"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="screen-capture-toolbar-group" data-testid="screen-capture-tools">
        {TOOLS.map(({ tool, icon: Icon, key }) => (
          <IconButton
            size={BUTTON_SIZE}
            key={tool}
            label={`${names[tool]}  ${key}`}
            aria-pressed={props.tool === tool}
            data-tool={tool}
            onClick={() => props.onToolChange(tool)}
          >
            <Icon />
          </IconButton>
        ))}
      </div>
      <span className="screen-capture-toolbar-divider" aria-hidden />
      <IconButton
        size={BUTTON_SIZE}
        label={`${isZh ? '撤销' : 'Undo'}  ${chordLabel('⌘Z')}`}
        disabled={!props.canUndo}
        onClick={props.onUndo}
      >
        <Undo2 />
      </IconButton>
      <IconButton
        size={BUTTON_SIZE}
        label={`${isZh ? '重做' : 'Redo'}  ${chordLabel('⇧⌘Z')}`}
        disabled={!props.canRedo}
        onClick={props.onRedo}
      >
        <Redo2 />
      </IconButton>
      <span className="screen-capture-toolbar-divider" aria-hidden />
      <IconButton
        size={BUTTON_SIZE}
        label={isZh ? '取消  Esc' : 'Cancel  Esc'}
        onClick={props.onCancel}
      >
        <X />
      </IconButton>
      <IconButton
        size={BUTTON_SIZE}
        label={isZh ? '添加到对话  ↵' : 'Add to chat  ↵'}
        className="screen-capture-confirm"
        disabled={props.exporting}
        onClick={props.onConfirm}
        data-testid="screen-capture-confirm"
      >
        <Check />
      </IconButton>
    </div>
  );
}
