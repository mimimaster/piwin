import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PetAnimationState, PetRuntimeSnapshot } from '@piwin/contracts';
import { DEFAULT_PET_STATE_ROWS } from '@piwin/contracts';
import './pet-sprite.css';

export type PetSpriteProps = {
  pet: PetRuntimeSnapshot;
  /** Called when the user clicks the pet (not drags). */
  onOpenSettings?: () => void;
  /** Called when the user right-clicks the pet — used to toggle system overlay. */
  onToggleOverlay?: () => void;
  /** Hide the sprite entirely. */
  hidden?: boolean;
  /** Overlay mode: center in window instead of fixed bottom-right (system overlay). */
  overlay?: boolean;
};

const IDLE_INTERVAL_MS = 4000;
const ACTION_DURATION_MS = 1200;

type TempAction = PetAnimationState | null;

/** Synchronous image cache so re-renders or state changes do not lose image ref. */
const imageCacheMap = new Map<string, HTMLImageElement>();

export function PetSprite(props: PetSpriteProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const petRef = useRef(props.pet);
  const rafRef = useRef<number>(0);
  const frameRef = useRef<number>(0);
  const [dragging, setDragging] = useState(false);
  const wasDraggingRef = useRef(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const tempActionRef = useRef<TempAction>(null);
  const tempActionUntil = useRef<number>(0);
  const hoverRef = useRef<boolean>(false);
  const lastStateRef = useRef<PetAnimationState | null>(null);

  petRef.current = props.pet;

  // Manage canvas logical size without setting JSX width/height attributes,
  // preventing browser canvas bitmap clears during component re-renders.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== props.pet.cellWidth) {
      canvas.width = props.pet.cellWidth;
    }
    if (canvas.height !== props.pet.cellHeight) {
      canvas.height = props.pet.cellHeight;
    }
  }, [props.pet.cellWidth, props.pet.cellHeight]);

  // Load spritesheet with immediate cache lookup.
  useEffect(() => {
    if (!props.pet.spritesheetAbsolutePath) return;
    const src = convertFileSrc(props.pet.spritesheetAbsolutePath);
    const cached = imageCacheMap.get(src);
    if (cached && (cached.naturalWidth > 0 || cached.complete)) {
      imageRef.current = cached;
      return;
    }

    const img = new Image();
    img.src = src;
    img.onload = () => {
      imageCacheMap.set(src, img);
      imageRef.current = img;
    };
    img.onerror = () => {};
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [props.pet.spritesheetAbsolutePath]);

  // Animation loop.
  useEffect(() => {
    let lastFrame = 0;
    let lastIdle = performance.now();

    function drawFrame(now: number): void {
      const canvas = canvasRef.current;
      const img = imageRef.current;
      const pet = petRef.current;

      const state = effectiveState();
      if (state !== lastStateRef.current) {
        lastStateRef.current = state;
        frameRef.current = 0;
        lastFrame = now;
      }

      if (canvas && img) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const frameMs = 1000 / (pet.fps || 6);
          if (now - lastFrame >= frameMs) {
            frameRef.current = (frameRef.current + 1) % pet.cols;
            lastFrame = now;
          }
          const row = pet.stateRows[state] ?? DEFAULT_PET_STATE_ROWS[state] ?? 0;
          const col = frameRef.current;
          const srcX = col * pet.cellWidth;
          const srcY = row * pet.cellHeight;

          const imgWidth = img.naturalWidth || img.width;
          const imgHeight = img.naturalHeight || img.height;

          if (!imgWidth || !imgHeight || (srcX < imgWidth && srcY < imgHeight)) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(
              img,
              srcX,
              srcY,
              pet.cellWidth,
              pet.cellHeight,
              0,
              0,
              canvas.width,
              canvas.height,
            );
          }
        }
      }
    }

    function tick(now: number): void {
      const pet = petRef.current;
      drawFrame(now);

      // Random idle action.
      if (
        !tempActionRef.current &&
        pet.state === 'idle' &&
        !hoverRef.current &&
        now - lastIdle > IDLE_INTERVAL_MS &&
        Math.random() < 0.02
      ) {
        const actions: PetAnimationState[] = ['waving', 'jumping'];
        const action = actions[Math.floor(Math.random() * actions.length)] ?? 'waving';
        tempActionRef.current = action;
        tempActionUntil.current = now + ACTION_DURATION_MS;
        lastIdle = now;
      }
      if (tempActionRef.current && now > tempActionUntil.current) {
        tempActionRef.current = null;
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  function effectiveState(): PetAnimationState {
    return tempActionRef.current ?? petRef.current.state;
  }

  // Drag handling.
  function onPointerDown(e: React.PointerEvent): void {
    // In overlay mode, the OS-level window drag is handled by PetOverlayApp's
    // mousedown → startDragging(). Skip internal DOM drag to avoid conflict.
    if (props.overlay) return;
    setDragging(true);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      px: pos?.x ?? window.innerWidth - 112,
      py: pos?.y ?? window.innerHeight - 120,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent): void {
    if (props.overlay || !dragging || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPos({ x: dragStart.current.px + dx, y: dragStart.current.py + dy });
  }
  function onPointerUp(e: React.PointerEvent): void {
    if (props.overlay) return;
    // Capture the drag state synchronously before re-render clears it,
    // so onClick can distinguish a drag-terminated release from a real click.
    wasDraggingRef.current = dragging;
    setDragging(false);
    dragStart.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    // Jump on release if dragged.
    if (tempActionRef.current === null) {
      tempActionRef.current = 'jumping';
      tempActionUntil.current = performance.now() + ACTION_DURATION_MS;
    }
  }
  function onClick(): void {
    // Reads the ref synchronously before any re-render; the `dragging` state
    // would already be false by the time the click handler runs.
    if (wasDraggingRef.current) {
      wasDraggingRef.current = false;
      return;
    }
    props.onOpenSettings?.();
  }
  function onMouseEnter(): void {
    hoverRef.current = true;
    if (props.pet.state === 'idle' && tempActionRef.current === null) {
      tempActionRef.current = 'waving';
      tempActionUntil.current = performance.now() + ACTION_DURATION_MS;
    }
  }
  function onMouseLeave(): void {
    hoverRef.current = false;
  }
  function onContextMenu(e: React.MouseEvent): void {
    e.preventDefault();
    props.onToggleOverlay?.();
  }

  const style: React.CSSProperties = pos
    ? { left: `${pos.x}px`, top: `${pos.y}px`, bottom: 'auto', right: 'auto' }
    : {};

  return (
    <div
      className={`pet-sprite-root${props.overlay ? ' overlay' : ''}${dragging ? ' dragging' : ''}${props.hidden ? ' hidden' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}

/**
 * Convert an absolute filesystem path to a Tauri asset URL.
 * In non-Tauri (mock) mode, fall back to a file:// URL.
 */
function convertFileSrc(path: string): string {
  const w = window as unknown as {
    __TAURI_INTERNALS__?: { convertFileSrc?: (p: string) => string };
  };
  if (w.__TAURI_INTERNALS__?.convertFileSrc) {
    return w.__TAURI_INTERNALS__.convertFileSrc(path);
  }
  return `file://${path}`;
}
