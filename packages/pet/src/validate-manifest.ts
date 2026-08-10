/**
 * Validate Codex-compatible pet.json manifests.
 * Soft on optional layout; hard on id/displayName/spritesheetPath.
 *
 * Accepts both piwin-native fields and CodexPetHub `codexpet.v1` packages
 * (name/atlas/states, no id/spritesheetPath in pet.json — filled via defaults
 * from the install-manifest or package layout).
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

const SAFE_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;

/** Codex state names that map onto piwin animation states. */
const CODEX_STATE_ALIASES: Record<string, PetAnimationState> = {
  idle: 'idle',
  running: 'running',
  'running-right': 'running',
  'running-left': 'running',
  waiting: 'waiting',
  failed: 'failed',
  waving: 'waving',
  jumping: 'jumping',
  review: 'review',
};

export type PetValidationIssue = {
  path: string;
  message: string;
};

export type PetValidationResult =
  | { ok: true; manifest: PetManifest }
  | { ok: false; issues: PetValidationIssue[] };

export type ValidatePetManifestOptions = {
  /**
   * When pet.json has no usable id (common for codexpet.v1), use this
   * (usually the install slug, e.g. "guga").
   */
  defaultId?: string;
  /**
   * When pet.json has no spritesheetPath (Codex keeps the sheet as a sibling
   * file declared only on the install-manifest), default relative name.
   */
  defaultSpritesheetPath?: string;
};

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

function isSafePetId(value: string): boolean {
  return SAFE_ID_RE.test(value);
}

/**
 * Map codexpet.v1 `states: [{ name, row }]` into piwin `stateRows`.
 * Prefer exact names; directional running-* fills `running` only if unset.
 */
function stateRowsFromCodexStates(
  states: unknown,
): Partial<Record<PetAnimationState, number>> | undefined {
  if (!Array.isArray(states)) return undefined;
  const stateRows: Partial<Record<PetAnimationState, number>> = {};
  const deferredRunning: number[] = [];

  for (const item of states) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rowRecord = item as Record<string, unknown>;
    const name = asNonEmptyString(rowRecord.name)?.toLowerCase();
    if (!name) continue;
    const row = asNonNegativeInt(rowRecord.row);
    if (row === null) continue;
    const mapped = CODEX_STATE_ALIASES[name];
    if (!mapped) continue;
    if (name === 'running-right' || name === 'running-left') {
      deferredRunning.push(row);
      continue;
    }
    stateRows[mapped] = row;
  }

  if (stateRows.running === undefined && deferredRunning.length > 0) {
    // Prefer running-right when both exist (first deferred is running-right if ordered).
    stateRows.running = deferredRunning[0];
  }

  return Object.keys(stateRows).length > 0 ? stateRows : undefined;
}

/**
 * Normalize Codex / community field aliases into a piwin-shaped record.
 */
export function normalizePetManifestRecord(
  value: unknown,
  options: ValidatePetManifestOptions = {},
): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = { ...(value as Record<string, unknown>) };

  // displayName
  if (!record.displayName && typeof record.name === 'string') {
    record.displayName = record.name;
  }

  // id: slug / pet.id aliases / install default
  if (!asNonEmptyString(record.id) || !isSafePetId(String(record.id).trim())) {
    const slug = asNonEmptyString(record.slug);
    if (slug && isSafePetId(slug)) {
      record.id = slug;
    } else if (options.defaultId && isSafePetId(options.defaultId.trim())) {
      record.id = options.defaultId.trim();
    }
  }

  // spritesheetPath aliases + Codex sibling default
  if (!record.spritesheetPath && typeof record.spritesheet === 'string') {
    record.spritesheetPath = record.spritesheet;
  }
  if (!record.spritesheetPath && typeof record.image === 'string') {
    record.spritesheetPath = record.image;
  }
  if (!asNonEmptyString(record.spritesheetPath)) {
    const schema = asNonEmptyString(record.schema_version) ?? asNonEmptyString(record.schemaVersion);
    const looksCodex =
      schema?.toLowerCase().startsWith('codexpet') === true ||
      record.atlas !== undefined ||
      Array.isArray(record.states);
    if (looksCodex || options.defaultSpritesheetPath) {
      record.spritesheetPath = options.defaultSpritesheetPath ?? 'spritesheet.webp';
    }
  }

  // atlas → cell / grid layout
  if (record.atlas && typeof record.atlas === 'object' && !Array.isArray(record.atlas)) {
    const atlas = record.atlas as Record<string, unknown>;
    if (record.cellWidth === undefined && atlas.cell_width !== undefined) {
      record.cellWidth = atlas.cell_width;
    }
    if (record.cellWidth === undefined && atlas.cellWidth !== undefined) {
      record.cellWidth = atlas.cellWidth;
    }
    if (record.cellHeight === undefined && atlas.cell_height !== undefined) {
      record.cellHeight = atlas.cell_height;
    }
    if (record.cellHeight === undefined && atlas.cellHeight !== undefined) {
      record.cellHeight = atlas.cellHeight;
    }
    if (record.cols === undefined && atlas.columns !== undefined) {
      record.cols = atlas.columns;
    }
    if (record.cols === undefined && atlas.cols !== undefined) {
      record.cols = atlas.cols;
    }
    if (record.rows === undefined && atlas.rows !== undefined) {
      record.rows = atlas.rows;
    }
  }

  // states[] → stateRows
  if (!record.stateRows && Array.isArray(record.states)) {
    const mapped = stateRowsFromCodexStates(record.states);
    if (mapped) {
      record.stateRows = mapped;
    }
  }

  // version may be number on Codex packages
  if (record.version !== undefined && typeof record.version === 'number') {
    record.version = String(record.version);
  }

  return record;
}

export function validatePetManifest(
  value: unknown,
  options: ValidatePetManifestOptions = {},
): PetValidationResult {
  const issues: PetValidationIssue[] = [];
  const normalized = normalizePetManifestRecord(value, options);
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
  if (!id || !isSafePetId(id)) {
    issues.push({ path: 'id', message: 'id must be alphanumeric with -/_' });
  }
  const displayName = asNonEmptyString(record.displayName);
  if (!displayName) {
    issues.push({ path: 'displayName', message: 'displayName is required' });
  }
  const spritesheetPath = asNonEmptyString(record.spritesheetPath);
  if (!spritesheetPath) {
    issues.push({ path: 'spritesheetPath', message: 'spritesheetPath is required' });
  } else if (
    spritesheetPath.includes('..') ||
    spritesheetPath.startsWith('/') ||
    spritesheetPath.includes(':\\') ||
    /^[a-zA-Z]:/.test(spritesheetPath)
  ) {
    issues.push({
      path: 'spritesheetPath',
      message: 'spritesheetPath must be a relative path inside the package',
    });
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
      const rowIndex = typeof raw[state] === 'number' ? Math.floor(raw[state] as number) : -1;
      if (rowIndex < 0 || !Number.isFinite(rowIndex)) {
        issues.push({ path: `stateRows.${state}`, message: 'row must be a non-negative integer' });
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
