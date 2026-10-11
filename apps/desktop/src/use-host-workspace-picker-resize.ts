import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  clampPickerMeasure,
  HOST_PICKER_COLUMN_WIDTH,
  HOST_PICKER_DIALOG_MIN_HEIGHT,
  HOST_PICKER_DIALOG_MIN_WIDTH,
  HOST_PICKER_SIDEBAR_WIDTH,
} from './host-workspace-picker-nav.js';

export function useHostWorkspacePickerResize() {
  const [sidebarWidth, setSidebarWidth] = useState(HOST_PICKER_SIDEBAR_WIDTH);
  const [columnWidthByPath, setColumnWidthByPath] = useState<Record<string, number>>({});
  const [layoutResizing, setLayoutResizing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  function sizeTarget(): HTMLElement | null {
    return rootRef.current?.closest<HTMLElement>('.workspace-open-dialog') ?? rootRef.current;
  }

  function columnWidth(path: string): number {
    return columnWidthByPath[path] ?? HOST_PICKER_COLUMN_WIDTH;
  }

  function onHorizontalResizePointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    startWidth: number,
    min: number,
    max: number,
    commit: (width: number) => void,
  ): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const originX = event.clientX;
    const handle = event.currentTarget;
    handle.setPointerCapture?.(pointerId);
    setLayoutResizing(true);

    function onMove(moveEvent: PointerEvent): void {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      commit(clampPickerMeasure(startWidth + (moveEvent.clientX - originX), min, max));
    }

    function onUp(upEvent: PointerEvent): void {
      if (upEvent.pointerId !== pointerId) {
        return;
      }
      handle.releasePointerCapture?.(pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setLayoutResizing(false);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function onDialogResizePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }
    const target = sizeTarget();
    if (!target) {
      return;
    }
    const surface: HTMLElement = target;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const originX = event.clientX;
    const originY = event.clientY;
    const startWidth = surface.getBoundingClientRect().width;
    const startHeight = surface.getBoundingClientRect().height;
    const handle = event.currentTarget;
    handle.setPointerCapture?.(pointerId);
    setLayoutResizing(true);

    function onMove(moveEvent: PointerEvent): void {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      const maxWidth = Math.max(HOST_PICKER_DIALOG_MIN_WIDTH, window.innerWidth - 40);
      const maxHeight = Math.max(HOST_PICKER_DIALOG_MIN_HEIGHT, window.innerHeight - 48);
      surface.style.width = `${clampPickerMeasure(
        startWidth + (moveEvent.clientX - originX),
        HOST_PICKER_DIALOG_MIN_WIDTH,
        maxWidth,
      )}px`;
      surface.style.height = `${clampPickerMeasure(
        startHeight + (moveEvent.clientY - originY),
        HOST_PICKER_DIALOG_MIN_HEIGHT,
        maxHeight,
      )}px`;
      surface.style.maxWidth = 'calc(100vw - 40px)';
      surface.style.maxHeight = 'calc(100dvh - 48px)';
    }

    function onUp(upEvent: PointerEvent): void {
      if (upEvent.pointerId !== pointerId) {
        return;
      }
      handle.releasePointerCapture?.(pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setLayoutResizing(false);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  return {
    sidebarWidth,
    setSidebarWidth,
    setColumnWidthByPath,
    layoutResizing,
    rootRef,
    columnWidth,
    onHorizontalResizePointerDown,
    onDialogResizePointerDown,
  };
}
