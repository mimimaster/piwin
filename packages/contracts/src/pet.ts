/** Codex-compatible pet package contracts. */

/** Animation state driven by agent runtime. */
export type PetAnimationState =
  'idle' | 'running' | 'waiting' | 'failed' | 'waving' | 'jumping' | 'review';

/** Standard Codex spritesheet layout (8×9 cells of 192×208). */
export const PET_SPRITE_COLS = 8;
export const PET_SPRITE_ROWS = 9;
export const PET_CELL_WIDTH = 192;
export const PET_CELL_HEIGHT = 208;
export const PET_SHEET_WIDTH = PET_SPRITE_COLS * PET_CELL_WIDTH; // 1536
export const PET_SHEET_HEIGHT = PET_SPRITE_ROWS * PET_CELL_HEIGHT; // 1872

/**
 * Default row index per animation state on an 8×9 atlas.
 * Column advances for frame animation (0..7).
 */
export const DEFAULT_PET_STATE_ROWS: Record<PetAnimationState, number> = {
  idle: 0,
  running: 1,
  waiting: 2,
  failed: 3,
  waving: 4,
  jumping: 5,
  review: 6,
};

export type PetManifest = {
  id: string;
  /** Gallery / UI title (Codex uses displayName). */
  displayName: string;
  description?: string;
  /** Relative path inside package; usually spritesheet.webp */
  spritesheetPath: string;
  version?: string;
  /** Optional overrides for atlas row per state. */
  stateRows?: Partial<Record<PetAnimationState, number>>;
  /** Frames per second for column stepping. Default 6. */
  fps?: number;
  /** Optional non-standard cell size (bundled pets may use smaller atlases). */
  cellWidth?: number;
  cellHeight?: number;
  cols?: number;
  rows?: number;
};

export type PetSummary = {
  id: string;
  displayName: string;
  description?: string;
  path: string;
  spritesheetAbsolutePath: string;
  source: 'bundled' | 'user' | 'codex-import' | 'codex-live';
  active: boolean;
  valid: boolean;
  issues: string[];
};

export type PetPreference = {
  activePetId: string;
};

export type PetRuntimeSnapshot = {
  petId: string;
  displayName: string;
  spritesheetAbsolutePath: string;
  state: PetAnimationState;
  fps: number;
  cellWidth: number;
  cellHeight: number;
  cols: number;
  rows: number;
  stateRows: Record<PetAnimationState, number>;
};
