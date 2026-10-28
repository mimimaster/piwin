/** Small HTML pieces laid over the capture stage: hint, size badge, text field. */
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import type { DesktopLocale } from '../i18n/desktop-locale.js';
import { ANNOTATION_FONT_FAMILY, ANNOTATION_FONT_WEIGHT } from './annotation-export.js';
import type { ImagePoint, ImageRect } from './annotation-model.js';

export function SelectHint({ locale }: { locale: DesktopLocale }): ReactElement {
  return (
    <div className="screen-capture-hint">
      {locale === 'zh-CN'
        ? '拖动选择截图区域 · 单击选择整个屏幕 · Esc 退出'
        : 'Drag to select · Click for the whole screen · Esc to exit'}
    </div>
  );
}

/** Region size in image pixels (physical pixels on the overlay). */
export function SizeBadge({
  selection,
  position,
}: {
  selection: ImageRect;
  position: { left: number; top: number };
}): ReactElement {
  return (
    <div className="screen-capture-size" style={position}>
      {`${Math.round(selection.width)} × ${Math.round(selection.height)}`}
    </div>
  );
}

export type TextFieldProps = {
  locale: DesktopLocale;
  value: string;
  /** View pixels inside the stage. */
  anchor: ImagePoint;
  fontSize: number;
  color: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onDiscard: () => void;
};

/** Inline on-canvas field, not a form control, so ui-kit TextInput does not fit. */
export function AnnotationTextField(props: TextFieldProps): ReactElement {
  const handleKey = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      props.onCommit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      props.onDiscard();
    }
  };
  return (
    <input
      autoFocus
      className="screen-capture-text-input"
      value={props.value}
      placeholder={props.locale === 'zh-CN' ? '输入文字，回车确认' : 'Type, then Enter'}
      onChange={(event) => props.onChange(event.target.value)}
      onKeyDown={handleKey}
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        left: props.anchor.x,
        top: props.anchor.y,
        fontSize: props.fontSize,
        fontFamily: ANNOTATION_FONT_FAMILY,
        fontWeight: ANNOTATION_FONT_WEIGHT,
        color: props.color,
      }}
    />
  );
}
