import { forwardRef, type CSSProperties } from 'react';
import {
  Check,
  Circle,
  Grid3x3,
  MoveUpRight,
  Pencil,
  Pin,
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

/** Same order as QQ: shapes, freehand, mosaic, text. */
export const ANNOTATION_TOOLS: readonly ToolEntry[] = [
  { tool: 'rect', icon: Square, key: 'R' },
  { tool: 'ellipse', icon: Circle, key: 'E' },
  { tool: 'arrow', icon: MoveUpRight, key: 'A' },
  { tool: 'pen', icon: Pencil, key: 'P' },
  { tool: 'mosaic', icon: Grid3x3, key: 'M' },
  { tool: 'text', icon: Type, key: 'T' },
];

const TOOL_NAMES: Record<DesktopLocale, Record<AnnotationTool, string>> = {
  'zh-CN': {
    rect: '矩形',
    ellipse: '椭圆',
    arrow: '箭头',
    pen: '画笔',
    mosaic: '马赛克',
    text: '文字',
  },
  en: {
    rect: 'Box',
    ellipse: 'Ellipse',
    arrow: 'Arrow',
    pen: 'Pen',
    mosaic: 'Mosaic',
    text: 'Text',
  },
};

export type AnnotationToolbarProps = {
  locale: DesktopLocale;
  tool: AnnotationTool | null;
  onToolChange: (tool: AnnotationTool) => void;
  canUndo: boolean;
  onUndo: () => void;
  exporting: boolean;
  /** Tooltip for ✓: where the finished image goes. */
  doneLabel: string;
  onCancel: () => void;
  onDone: () => void;
  /** When set, show a pin (贴图) action next to cancel. */
  onPin: (() => void) | undefined;
  style?: CSSProperties;
};

function chordLabel(chord: string): string {
  const platform = detectShortcutDisplayPlatform();
  return formatShortcutChordTokens(chord, platform).join(platform === 'apple' ? '' : '+');
}

/** Floating icon strip beside the region; names and keys live in tooltips. */
export const AnnotationToolbar = forwardRef<HTMLDivElement, AnnotationToolbarProps>(
  function AnnotationToolbar(props, ref) {
    const isZh = props.locale === 'zh-CN';
    const names = TOOL_NAMES[props.locale];
    return (
      <div
        ref={ref}
        className="screen-capture-toolbar"
        role="toolbar"
        style={props.style}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
      >
        <div className="screen-capture-toolbar-group" data-testid="screen-capture-tools">
          {ANNOTATION_TOOLS.map(({ tool, icon: Icon, key }) => (
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
        <span className="screen-capture-toolbar-divider" aria-hidden />
        {props.onPin !== undefined ? (
          <IconButton
            size={BUTTON_SIZE}
            label={isZh ? '贴到屏幕' : 'Pin to screen'}
            onClick={props.onPin}
            data-testid="screen-capture-pin"
          >
            <Pin />
          </IconButton>
        ) : null}
        <IconButton
          size={BUTTON_SIZE}
          label={isZh ? '退出截图  Esc' : 'Cancel  Esc'}
          onClick={props.onCancel}
          data-testid="screen-capture-cancel"
        >
          <X />
        </IconButton>
        <IconButton
          size={BUTTON_SIZE}
          label={`${props.doneLabel}  ↵`}
          className="screen-capture-confirm"
          disabled={props.exporting}
          onClick={props.onDone}
          data-testid="screen-capture-confirm"
        >
          <Check />
        </IconButton>
      </div>
    );
  },
);

export function annotationToolForKey(key: string): AnnotationTool | undefined {
  const upper = key.toUpperCase();
  return ANNOTATION_TOOLS.find((entry) => entry.key === upper)?.tool;
}
