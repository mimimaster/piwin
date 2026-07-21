import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import type { PetAnimationState, PetRuntimeSnapshot } from '@piwin/contracts';
import { convertFileSrc } from '@tauri-apps/api/core';

export type PetCompanionProps = {
  snapshot: PetRuntimeSnapshot | null;
  state: PetAnimationState;
};

function spritesheetUrl(absolutePath: string): string {
  try {
    return convertFileSrc(absolutePath);
  } catch {
    return absolutePath.startsWith('/') ? `file://${absolutePath}` : absolutePath;
  }
}

/**
 * CSS spritesheet animator for Codex-compatible pet atlases.
 * Column steps for frames; row selects animation state.
 */
export function PetCompanion({ snapshot, state }: PetCompanionProps): ReactElement {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!snapshot) return;
    const fps = Math.max(1, snapshot.fps);
    const timer = window.setInterval(() => {
      setFrame((current) => (current + 1) % Math.max(1, snapshot.cols));
    }, 1000 / fps);
    return () => window.clearInterval(timer);
  }, [snapshot]);

  const style = useMemo((): CSSProperties | null => {
    if (!snapshot) return null;
    const row = snapshot.stateRows[state] ?? snapshot.stateRows.idle ?? 0;
    const x = -frame * snapshot.cellWidth;
    const y = -row * snapshot.cellHeight;
    const url = spritesheetUrl(snapshot.spritesheetAbsolutePath);
    return {
      width: snapshot.cellWidth,
      height: snapshot.cellHeight,
      backgroundImage: `url("${url}")`,
      backgroundRepeat: 'no-repeat',
      backgroundPosition: `${x}px ${y}px`,
      imageRendering: 'pixelated',
      borderRadius: 8,
      border: '1px solid var(--border)',
      backgroundColor: 'var(--panel-2)',
    };
  }, [snapshot, state, frame]);

  if (!snapshot || !style) {
    return (
      <div className="pet-companion pet-companion-empty" title="No pet loaded">
        <span className="muted">pet</span>
      </div>
    );
  }

  return (
    <div className="pet-companion" title={`${snapshot.displayName} · ${state}`}>
      <div className="pet-sprite" style={style} aria-label={`${snapshot.displayName} ${state}`} />
      <div className="pet-meta muted">
        {snapshot.displayName} · {state}
      </div>
    </div>
  );
}
