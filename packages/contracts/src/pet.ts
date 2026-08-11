/** Codex-compatible pet package contracts. */
import type { SessionRunPhase } from './host.js';

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

/**
 * Populated frame counts for the standard Codex 8-column atlas rows.
 * Trailing cells are intentionally transparent and must not be played as frames.
 */
export const CODEX_PET_FRAME_COUNTS_BY_ROW: readonly number[] = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8];

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
  /** Manifest metadata needed for small previews in desktop lists. */
  manifest?: PetManifest;
  source: PetSourceKind;
  active: boolean;
  valid: boolean;
  issues: string[];
};

export type PetPreference = {
  activePetId: string;
};

/**
 * Raw activity info derived from the AgentEvent stream, carried alongside
 * the animation state so the desktop can render a localized text bubble
 * ("Running read_file…", "规划下一步", etc.) next to the pet.
 *
 * The host does NOT localize — it only forwards raw field values. The
 * desktop maps these to a human-readable phrase via its activity-string
 * layer (which already supports zh-CN / en).
 */
export type PetActivityInfo = {
  /** Name of the currently running tool, if any. */
  toolName?: string;
  /** Permission action string (e.g. "bash", "write"), if waiting for approval. */
  permissionAction?: string;
  /** Current run phase, if a run is active. */
  phase?: SessionRunPhase;
  /**
   * Short host-normalized work detail for the bubble (path, command, query).
   * Sourced from ToolPresentation.summary when a tool is active.
   */
  detail?: string;
  /**
   * Host-side action verb from ToolPresentation (e.g. "Read", "Ran command").
   * Desktop may localize; host does not.
   */
  actionVerb?: string;
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
  /** Live activity info for the text bubble; absent when idle. */
  activity?: PetActivityInfo;
};

/** Stable identifier for where a pet package came from. */
export type PetSourceKind = 'bundled' | 'local' | 'codex-live' | 'registry';

/** A pet discovered by a provider during enumeration (no payload fetched). */
export type PetDiscoveredEntry = {
  petId: string;
  displayName: string;
  description?: string;
  version?: string;
  /** Manifest metadata retained so clients can render the package preview. */
  manifest?: PetManifest;
  source: PetSourceKind;
  /** Absolute path for local sources; URL for registry; empty for bundled. */
  location: string;
  /** True if the package is already installed locally and resolvable. */
  installed: boolean;
  /** Validation issues found during discovery (missing spritesheet, etc). */
  issues: string[];
};

/** A fully resolved, ready-to-render pet package. */
export type PetResolvedPackage = {
  petId: string;
  displayName: string;
  description?: string;
  version?: string;
  source: PetSourceKind;
  /** Absolute path to the package directory (or temp dir for registry staging). */
  packagePath: string;
  /** Absolute path to the spritesheet file. */
  spritesheetAbsolutePath: string;
  manifest: PetManifest;
};

/** Result of installing a pet from any source. */
export type PetInstallResult = {
  petId: string;
  source: PetSourceKind;
  path: string;
  /**
   * Remote origin when source is `registry` (e.g. `codexpethub.com`,
   * `codex-pets.net`) so the UI can show where the package came from.
   */
  registryLabel?: string;
};

/** One package candidate found while scanning a user-selected local directory. */
export type PetLocalImportCandidate = {
  /** Absolute package directory that can be passed to pet/install-local. */
  sourcePath: string;
  /** Missing when pet.json could not be parsed or validated. */
  petId?: string;
  /** Manifest display name, or the directory name for invalid packages. */
  displayName: string;
  description?: string;
  version?: string;
  valid: boolean;
  issues: string[];
};

/** Result of scanning one local package directory or a directory of packages. */
export type PetLocalImportPreview = {
  sourcePath: string;
  candidates: PetLocalImportCandidate[];
};

/** One local package that failed during a batch import. */
export type PetLocalImportFailure = {
  sourcePath: string;
  error: string;
};

/** Partial-success result for a multi-package local import. */
export type PetLocalImportBatchResult = {
  installed: PetInstallResult[];
  failed: PetLocalImportFailure[];
};

/** Query payload for the remote registry browse command. */
export type PetStoreQuery = {
  /** Search text; empty string lists all. */
  query: string;
  /** Optional source filter; default 'registry'. */
  source?: PetSourceKind;
};

/** One hit from a store query. */
export type PetStoreQueryResult = {
  petId: string;
  displayName: string;
  description?: string;
  version?: string;
  source: PetSourceKind;
  /** Registry URL or local path. */
  location: string;
  /** True if already installed under ~/.piwin/pets. */
  installed: boolean;
  /** SHA256 hex of the package tarball, if known by the registry. */
  sha256?: string;
  /** Package size in bytes, if known. */
  sizeBytes?: number;
};

/** A single entry in the remote registry catalog (CodexPetHub shape). */
export type PetRegistryEntry = {
  id: string;
  displayName: string;
  description?: string;
  version?: string;
  /** HTTPS URL to the package tarball (zip). */
  url: string;
  sha256: string;
  sizeBytes: number;
};
