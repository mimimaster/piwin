/**
 * Validate Codex-compatible pet.json manifests.
 * Soft on optional layout; hard on id/displayName/spritesheetPath.
 */
import type { PetAnimationState, PetManifest } from '@piwin/contracts';
import {
  DEFAULT_PET_STATE_ROWS,
  PET_CELL_HEIGHT,
  PET_CELL_WIDTH,
  PET_SPRITE_COLS,
  PET_SPRITE_ROWS,
} from '@piwin/contracts';

const ANIMATION_STATES: PetAnimationState[] = [
  'idle',
  'running',
  'waiting',
  'failed',
  'waving',
  'jumping',
  'review',
];

export type PetValidationIssue = {
  path: string;
  message: string;
};

export type PetValidationResult =
  | { ok: true; manifest: PetManifest }
  | { ok: false; issues: PetValidationIssue[] };

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

/**
 * Normalize Codex / community field aliases into PetManifest.
 */
export function normalizePetManifestRecord(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = { ...(value as Record<string, unknown>) };
  if (!record.displayName && typeof record.name === 'string') {
    record.displayName = record.name;
  }
  if (!record.spritesheetPath && typeof record.spritesheet === 'string') {
    record.spritesheetPath = record.spritesheet;
  }
  if (!record.spritesheetPath && typeof record.image === 'string') {
    record.spritesheetPath = record.image;
  }
  return record;
}

export function validatePetManifest(value: unknown): PetValidationResult {
  const issues: PetValidationIssue[] = [];
  const normalized = normalizePetManifestRecord(value);
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    return { ok: false, issues: [{ path: '', message: 'manifest must be an object' }] };
  }
  const record = normalized as Record<string, unknown>;

  // Reject executable payloads
  for (const banned of ['js', 'script', 'javascript', 'css', 'hooks']) {
    if (banned in record) {
      issues.push({ path: banned, message: 'executable pet payloads are not allowed' });
    }
  }

  const id = asNonEmptyString(record.id);
  if (!id || !/^[a-z0-9][a-z0-9_-]*$/i.test(id)) {
    issues.push({ path: 'id', message: 'id must be alphanumeric with -/_' });
  }
  const displayName = asNonEmptyString(record.displayName);
  if (!displayName) {
    issues.push({ path: 'displayName', message: 'displayName is required' });
  }
  const spritesheetPath = asNonEmptyString(record.spritesheetPath);
  if (!spritesheetPath) {
    issues.push({ path: 'spritesheetPath', message: 'spritesheetPath is required' });
  } else if (spritesheetPath.includes('..') || spritesheetPath.startsWith('/') || spritesheetPath.includes(':\\') || /^[a-zA-Z]:/.test(spritesheetPath)) {
    issues.push({ path: 'spritesheetPath', message: 'spritesheetPath must be a relative path inside the package' });
  } else if (!/\.(webp|png|gif|jpe?g)$/i.test(spritesheetPath)) {
    issues.push({ path: 'spritesheetPath', message: 'spritesheet must be webp/png/gif/jpg' });
  }

  if (issues.length > 0 || !id || !displayName || !spritesheetPath) {
    return { ok: false, issues };
  }

  const manifest: PetManifest = {
    id: id.toLowerCase(),
    displayName,
    spritesheetPath,
  };

  const description = asNonEmptyString(record.description);
  if (description) manifest.description = description;
  const version = asNonEmptyString(record.version);
  if (version) manifest.version = version;

  const fps = asPositiveInt(record.fps);
  if (record.fps !== undefined) {
    if (!fps || fps > 30) {
      issues.push({ path: 'fps', message: 'fps must be 1..30' });
    } else {
      manifest.fps = fps;
    }
  }

  const cellWidth = asPositiveInt(record.cellWidth);
  if (record.cellWidth !== undefined) {
    if (!cellWidth) issues.push({ path: 'cellWidth', message: 'invalid cellWidth' });
    else manifest.cellWidth = cellWidth;
  }
  const cellHeight = asPositiveInt(record.cellHeight);
  if (record.cellHeight !== undefined) {
    if (!cellHeight) issues.push({ path: 'cellHeight', message: 'invalid cellHeight' });
    else manifest.cellHeight = cellHeight;
  }
  const cols = asPositiveInt(record.cols);
  if (record.cols !== undefined) {
    if (!cols) issues.push({ path: 'cols', message: 'invalid cols' });
    else manifest.cols = cols;
  }
  const rows = asPositiveInt(record.rows);
  if (record.rows !== undefined) {
    if (!rows) issues.push({ path: 'rows', message: 'invalid rows' });
    else manifest.rows = rows;
  }

  if (record.stateRows && typeof record.stateRows === 'object' && !Array.isArray(record.stateRows)) {
    const stateRows: Partial<Record<PetAnimationState, number>> = {};
    const raw = record.stateRows as Record<string, unknown>;
    for (const state of ANIMATION_STATES) {
      if (raw[state] === undefined) continue;
      const row = asPositiveInt(raw[state]);
      if (row === null && raw[state] !== 0) {
        issues.push({ path: `stateRows.${state}`, message: 'row must be a non-negative integer' });
        continue;
      }
      const rowIndex = typeof raw[state] === 'number' ? Math.floor(raw[state] as number) : -1;
      if (rowIndex < 0) {
        issues.push({ path: `stateRows.${state}`, message: 'row must be >= 0' });
      } else {
        stateRows[state] = rowIndex;
      }
    }
    if (Object.keys(stateRows).length > 0) {
      manifest.stateRows = stateRows;
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, manifest };
}

export function resolvePetLayout(manifest: PetManifest): {
  cellWidth: number;
  cellHeight: number;
  cols: number;
  rows: number;
  stateRows: Record<PetAnimationState, number>;
  fps: number;
} {
  const stateRows: Record<PetAnimationState, number> = { ...DEFAULT_PET_STATE_ROWS };
  if (manifest.stateRows) {
    for (const state of ANIMATION_STATES) {
      const override = manifest.stateRows[state];
      if (override !== undefined) stateRows[state] = override;
    }
  }
  return {
    cellWidth: manifest.cellWidth ?? PET_CELL_WIDTH,
    cellHeight: manifest.cellHeight ?? PET_CELL_HEIGHT,
    cols: manifest.cols ?? PET_SPRITE_COLS,
    rows: manifest.rows ?? PET_SPRITE_ROWS,
    stateRows,
    fps: manifest.fps ?? 6,
  };
}
