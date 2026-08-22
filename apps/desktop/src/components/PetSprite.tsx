import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PetAnimationState, PetRuntimeSnapshot } from '@piwin/contracts';
import {
  CODEX_PET_FRAME_COUNTS_BY_ROW,
  DEFAULT_PET_STATE_ROWS,
  PET_CELL_HEIGHT,
  PET_CELL_WIDTH,
  PET_SPRITE_COLS,
  PET_SPRITE_ROWS,
} from '@piwin/contracts';
import { PetBubble } from './PetBubble';
import { buildPetBubbleView } from '../pet-bubble-view.js';
import {
  PET_ACTION_DURATION_MS,
  PET_IDLE_ACTION_INTERVAL_MS,
  petSpriteShouldAnimate,
} from './pet-sprite-animation.js';
import { defaultPetContentBounds, detectPetContentBounds, type PetContentBounds } from './pet-content-bounds.js';
import {
  PET_BUBBLE_MAX_WIDTH_PX,
  PET_OVERLAY_PAD_Y_PX,
  resolvePetDisplaySize,
} from './pet-display-size.js';
import { convertPetAssetPath } from './pet-asset-url.js';
import './pet-sprite.css';

export type PetSpriteProps = {
  pet: PetRuntimeSnapshot;
  /** Called when the user clicks the pet (not drags). */
  onOpenSettings?: () => void;
  /** Called when the user right-clicks the pet — used to toggle system overlay. */
  onToggleOverlay?: () => void;
  /** Called by the hover control to hide the system overlay. */
  onHide?: () => void;
  /** Hide the sprite entirely. */
  hidden?: boolean;
  /** Overlay mode: center in window instead of fixed bottom-right (system overlay). */
  overlay?: boolean;
  /** Bubble locale; defaults to zh-CN. */
  locale?: 'zh-CN' | 'en';
};

const IDLE_INTERVAL_MS = PET_IDLE_ACTION_INTERVAL_MS;
const ACTION_DURATION_MS = PET_ACTION_DURATION_MS;

type TempAction = PetAnimationState | null;

/** Synchronous image cache so re-renders or state changes do not lose image ref. */
const imageCacheMap = new Map<string, HTMLImageElement>();

function resolvePetFrameCount(pet: PetRuntimeSnapshot, state: PetAnimationState): number {
  const row = pet.stateRows[state] ?? DEFAULT_PET_STATE_ROWS[state] ?? 0;
  const usesCodexAtlasGeometry =
    pet.cellWidth === PET_CELL_WIDTH &&
    pet.cellHeight === PET_CELL_HEIGHT &&
    pet.cols === PET_SPRITE_COLS &&
    (pet.rows === PET_SPRITE_ROWS || pet.rows === CODEX_PET_FRAME_COUNTS_BY_ROW.length);
  const configuredCount = usesCodexAtlasGeometry ? CODEX_PET_FRAME_COUNTS_BY_ROW[row] : undefined;
  return Math.max(1, Math.min(pet.cols, configuredCount ?? pet.cols));
}

export function PetSprite(props: PetSpriteProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const petRef = useRef(props.pet);
  const rafRef = useRef<number>(0);
  const loopRunningRef = useRef(false);
  const idleActionTimerRef = useRef<number>(0);
  const startLoopRef = useRef<() => void>(() => {});
  const stopLoopRef = useRef<() => void>(() => {});
  const scheduleIdleActionRef = useRef<() => void>(() => {});
  const frameRef = useRef<number>(0);
  const [dragging, setDragging] = useState(false);
  const wasDraggingRef = useRef(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const tempActionRef = useRef<TempAction>(null);
  const tempActionUntil = useRef<number>(0);
  const hoverRef = useRef<boolean>(false);
  const lastStateRef = useRef<PetAnimationState | null>(null);
  const [contentBounds, setContentBounds] = useState<PetContentBounds>(() =>
    defaultPetContentBounds(props.pet.cellWidth, props.pet.cellHeight),
  );
  const boundsRef = useRef<PetContentBounds>(contentBounds);
  boundsRef.current = contentBounds;

  petRef.current = props.pet;

  // Manage canvas logical size without setting JSX width/height attributes,
  // preventing browser canvas bitmap clears during component re-renders.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== contentBounds.width) {
      canvas.width = contentBounds.width;
    }
    if (canvas.height !== contentBounds.height) {
      canvas.height = contentBounds.height;
    }
  }, [contentBounds.width, contentBounds.height]);

  // Load spritesheet with immediate cache lookup.
  useEffect(() => {
    if (!props.pet.spritesheetAbsolutePath) return;
    const src = convertPetAssetPath(props.pet.spritesheetAbsolutePath);
    if (!src) return;
    const cached = imageCacheMap.get(src);
    if (cached && (cached.naturalWidth > 0 || cached.complete)) {
      imageRef.current = cached;
      const detected = detectPetContentBounds(
        cached,
        props.pet.cellWidth,
        props.pet.cellHeight,
        props.pet.cols,
        props.pet.rows,
      );
      setContentBounds(detected);
      startLoopRef.current();
      return;
    }

    // Switching pets: drop the previous sheet so the loop does not slice the
    // old image with the new pet's cell geometry/rows while this one loads.
    imageRef.current = null;
    setContentBounds(defaultPetContentBounds(props.pet.cellWidth, props.pet.cellHeight));

    const img = new Image();
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      imageCacheMap.set(src, img);
      imageRef.current = img;
      const detected = detectPetContentBounds(
        img,
        props.pet.cellWidth,
        props.pet.cellHeight,
        props.pet.cols,
        props.pet.rows,
      );
      setContentBounds(detected);
      startLoopRef.current();
    };
    // Attach onload before src. A cached WKWebView asset can complete
    // synchronously; assigning onload after src misses the pet entirely and
    // leaves a floating speech bubble with no sprite.
    img.onload = finish;
    img.onerror = () => {};
    img.src = src;
    if (img.complete && (img.naturalWidth > 0 || img.naturalHeight > 0 || img.width > 0)) {
      finish();
    }
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [props.pet.spritesheetAbsolutePath]);

  // Animation loop. Idle + no hover + no bubble is static; rAF only runs
  // while something is actually moving. Random wave/jump is a one-shot timer.
  useEffect(() => {
    let lastFrame = 0;

    function shouldAnimateNow(): boolean {
      const pet = petRef.current;
      return petSpriteShouldAnimate({
        state: pet.state,
        hovered: hoverRef.current,
        hasTempAction: tempActionRef.current !== null,
        hasBubble: buildPetBubbleView(pet) !== null,
        visibilityState: document.visibilityState,
      });
    }

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
          const frameCount = resolvePetFrameCount(pet, state);
          if (frameRef.current >= frameCount) {
            frameRef.current = 0;
          }
          if (now - lastFrame >= frameMs) {
            frameRef.current = (frameRef.current + 1) % frameCount;
            lastFrame = now;
          }
          const row = pet.stateRows[state] ?? DEFAULT_PET_STATE_ROWS[state] ?? 0;
          const col = frameRef.current;
          const srcX = col * pet.cellWidth;
          const srcY = row * pet.cellHeight;

          const imgWidth = img.naturalWidth || img.width;
          const imgHeight = img.naturalHeight || img.height;

          const bounds = boundsRef.current;
          if (!imgWidth || !imgHeight || (srcX < imgWidth && srcY < imgHeight)) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(
              img,
              srcX + bounds.x,
              srcY + bounds.y,
              bounds.width,
              bounds.height,
              0,
              0,
              canvas.width,
              canvas.height,
            );
          }
        }
      }
    }

    function stopLoop(): void {
      if (rafRef.current !== 0) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      loopRunningRef.current = false;
    }

    function startLoop(): void {
      if (loopRunningRef.current) {
        return;
      }
      loopRunningRef.current = true;
      function tick(now: number): void {
        if (tempActionRef.current && now >= tempActionUntil.current) {
          tempActionRef.current = null;
        }
        drawFrame(now);
        if (!shouldAnimateNow()) {
          rafRef.current = 0;
          loopRunningRef.current = false;
          scheduleIdleAction();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    function clearIdleActionTimer(): void {
      if (idleActionTimerRef.current !== 0) {
        window.clearTimeout(idleActionTimerRef.current);
        idleActionTimerRef.current = 0;
      }
    }

    function scheduleIdleAction(): void {
      clearIdleActionTimer();
      const pet = petRef.current;
      if (
        pet.state !== 'idle' ||
        hoverRef.current ||
        tempActionRef.current !== null ||
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      idleActionTimerRef.current = window.setTimeout(() => {
        idleActionTimerRef.current = 0;
        if (
          petRef.current.state !== 'idle' ||
          hoverRef.current ||
          tempActionRef.current !== null ||
          document.visibilityState === 'hidden'
        ) {
          return;
        }
        const actions: PetAnimationState[] = ['waving', 'jumping'];
        const action = actions[Math.floor(Math.random() * actions.length)] ?? 'waving';
        tempActionRef.current = action;
        tempActionUntil.current = performance.now() + ACTION_DURATION_MS;
        startLoop();
      }, IDLE_INTERVAL_MS);
    }

    startLoopRef.current = startLoop;
    stopLoopRef.current = stopLoop;
    scheduleIdleActionRef.current = scheduleIdleAction;

    function onVisibilityChange(): void {
      if (document.visibilityState === 'hidden') {
        stopLoop();
        clearIdleActionTimer();
        return;
      }
      if (shouldAnimateNow()) {
        startLoop();
      } else {
        drawFrame(performance.now());
        scheduleIdleAction();
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    if (shouldAnimateNow()) {
      startLoop();
    } else {
      drawFrame(performance.now());
      scheduleIdleAction();
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearIdleActionTimer();
      stopLoop();
    };
  }, [props.pet.state]);

  function effectiveState(): PetAnimationState {
    return tempActionRef.current ?? petRef.current.state;
  }

  // Drag handling.
  function onPointerDown(e: React.PointerEvent): void {
    // In overlay mode, the OS-level window drag is handled by PetOverlayApp's
    // mousedown → startDragging(). Skip internal DOM drag to avoid conflict.
    if (props.overlay) return;
    setDragging(true);
    const display = resolvePetDisplaySize(petRef.current.cellWidth, petRef.current.cellHeight);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      px: pos?.x ?? window.innerWidth - display.width - 16,
      py: pos?.y ?? window.innerHeight - display.height - 16,
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
      startLoopRef.current();
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
    startLoopRef.current();
  }
  function onMouseLeave(): void {
    hoverRef.current = false;
  }
  function onContextMenu(e: React.MouseEvent): void {
    e.preventDefault();
    props.onToggleOverlay?.();
  }
  function onHidePointerDown(e: React.PointerEvent<HTMLButtonElement>): void {
    e.preventDefault();
    e.stopPropagation();
  }
  function onHideClick(e: React.MouseEvent<HTMLButtonElement>): void {
    e.preventDefault();
    e.stopPropagation();
    props.onHide?.();
  }

  const displaySize = useMemo(
    () => resolvePetDisplaySize(props.pet.cellWidth, props.pet.cellHeight),
    [contentBounds.width, contentBounds.height],
  );

  const style: React.CSSProperties = {
    // CSS custom props drive width/height so the hit box matches the cell aspect.
    ['--pet-display-w' as string]: `${displaySize.width}px`,
    ['--pet-display-h' as string]: `${displaySize.height}px`,
    ['--pet-bubble-max-w' as string]: `${PET_BUBBLE_MAX_WIDTH_PX}px`,
    ['--pet-overlay-pad-y' as string]: `${PET_OVERLAY_PAD_Y_PX}px`,
    ...(pos ? { left: `${pos.x}px`, top: `${pos.y}px`, bottom: 'auto', right: 'auto' } : {}),
  };

  return (
    <div
      className={`pet-sprite-root${props.overlay ? ' overlay' : ''}${dragging ? ' dragging' : ''}${props.hidden ? ' hidden' : ''}`}
      style={style}
      data-pet-display-w={displaySize.width}
      data-pet-display-h={displaySize.height}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <PetBubble pet={props.pet} locale={props.locale ?? 'zh-CN'} />
      <canvas ref={canvasRef} />
      {props.onHide ? (
        <button
          type="button"
          className="pet-sprite-hide-button"
          data-pet-overlay-control="hide"
          aria-label={props.locale === 'en' ? 'Hide pet' : '隐藏宠物'}
          title={props.locale === 'en' ? 'Hide pet' : '隐藏宠物'}
          onPointerDown={onHidePointerDown}
          onClick={onHideClick}
        >
          <svg aria-hidden="true" focusable="false" viewBox="0 0 20 20">
            <path d="M5.5 5.5 14.5 14.5M14.5 5.5 5.5 14.5" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
