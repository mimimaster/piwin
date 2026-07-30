import { useEffect, useRef, useState } from 'react';
import type { PetAnimationState, PetRuntimeSnapshot } from '@piwin/contracts';
import { DEFAULT_PET_STATE_ROWS } from '@piwin/contracts';
import './pet-sprite.css';

export type PetSpriteProps = {
  pet: PetRuntimeSnapshot;
  /** Called when the user clicks the pet (not drags). */
  onOpenSettings?: () => void;
  /** Hide the sprite entirely. */
  hidden?: boolean;
};

const IDLE_INTERVAL_MS = 4000;
const ACTION_DURATION_MS = 1200;

type TempAction = PetAnimationState | null;

export function PetSprite(props: PetSpriteProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef<number>(0);
  const frameRef = useRef<number>(0);
  const [dragging, setDragging] = useState(false);
  const wasDraggingRef = useRef(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [tempAction, setTempAction] = useState<TempAction>(null);
  const tempActionUntil = useRef<number>(0);
  const hoverRef = useRef<boolean>(false);

  // Load spritesheet.
  useEffect(() => {
    if (!props.pet.spritesheetAbsolutePath) return;
    const img = new Image();
    img.src = convertFileSrc(props.pet.spritesheetAbsolutePath);
    img.onload = () => {
      imageRef.current = img;
    };
    // On load failure (404, corrupt), drop any stale ref so we don't render a broken image.
    img.onerror = () => {
      imageRef.current = null;
    };
    return () => {
      // Prevent a slow-loading previous sheet from overwriting a newer ref,
      // and stop in-flight loads from mutating a dead ref after unmount.
      img.onload = null;
      img.onerror = null;
      imageRef.current = null;
    };
  }, [props.pet.spritesheetAbsolutePath]);

  // Animation loop.
  useEffect(() => {
    let lastFrame = 0;
    let lastIdle = performance.now();
    const fps = props.pet.fps || 6;
    const frameMs = 1000 / fps;

    function tick(now: number): void {
      const canvas = canvasRef.current;
      const img = imageRef.current;
      if (canvas && img) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          if (now - lastFrame >= frameMs) {
            frameRef.current = (frameRef.current + 1) % props.pet.cols;
            lastFrame = now;
          }
          const state = effectiveState();
          const row = props.pet.stateRows[state] ?? DEFAULT_PET_STATE_ROWS[state] ?? 0;
          const col = frameRef.current;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(
            img,
            col * props.pet.cellWidth,
            row * props.pet.cellHeight,
            props.pet.cellWidth,
            props.pet.cellHeight,
            0,
            0,
            canvas.width,
            canvas.height,
          );
        }
      }
      // Random idle action.
      if (
        !tempAction &&
        props.pet.state === 'idle' &&
        !hoverRef.current &&
        now - lastIdle > IDLE_INTERVAL_MS &&
        Math.random() < 0.02
      ) {
        const actions: PetAnimationState[] = ['waving', 'jumping'];
        const action = actions[Math.floor(Math.random() * actions.length)] ?? 'waving';
        setTempAction(action);
        tempActionUntil.current = now + ACTION_DURATION_MS;
        lastIdle = now;
      }
      if (tempAction && now > tempActionUntil.current) {
        setTempAction(null);
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [props.pet, tempAction]);

  function effectiveState(): PetAnimationState {
    if (tempAction) return tempAction;
    return props.pet.state;
  }

  // Drag handling.
  function onPointerDown(e: React.PointerEvent): void {
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
    if (!dragging || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPos({ x: dragStart.current.px + dx, y: dragStart.current.py + dy });
  }
  function onPointerUp(e: React.PointerEvent): void {
    // Capture the drag state synchronously before re-render clears it,
    // so onClick can distinguish a drag-terminated release from a real click.
    wasDraggingRef.current = dragging;
    setDragging(false);
    dragStart.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    // Jump on release if dragged.
    if (tempAction === null) {
      setTempAction('jumping');
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
    if (props.pet.state === 'idle' && !tempAction) {
      setTempAction('waving');
      tempActionUntil.current = performance.now() + ACTION_DURATION_MS;
    }
  }
  function onMouseLeave(): void {
    hoverRef.current = false;
  }

  const style: React.CSSProperties = pos
    ? { left: `${pos.x}px`, top: `${pos.y}px`, bottom: 'auto', right: 'auto' }
    : {};

  return (
    <div
      className={`pet-sprite-root${dragging ? ' dragging' : ''}${props.hidden ? ' hidden' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <canvas
        ref={canvasRef}
        width={props.pet.cellWidth}
        height={props.pet.cellHeight}
      />
    </div>
  );
}

/**
 * Convert an absolute filesystem path to a Tauri asset URL.
 * In non-Tauri (mock) mode, fall back to a file:// URL.
 */
function convertFileSrc(path: string): string {
  const w = window as unknown as { __TAURI_INTERNALS__?: { convertFileSrc?: (p: string) => string } };
  if (w.__TAURI_INTERNALS__?.convertFileSrc) {
    return w.__TAURI_INTERNALS__.convertFileSrc(path);
  }
  return `file://${path}`;
}
