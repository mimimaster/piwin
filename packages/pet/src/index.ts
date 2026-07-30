/** @piwin/pet — Codex-compatible pet packages + agent state mapping. */

export {
  validatePetManifest,
  normalizePetManifestRecord,
  resolvePetLayout,
} from './validate-manifest.js';
export type { PetValidationIssue, PetValidationResult } from './validate-manifest.js';

export {
  getPetsDir,
  getPetPreferencePath,
  getDefaultCodexPetsDir,
  loadPetPreference,
  savePetPreference,
  ensureBundledPetsInstalled,
  listPets,
  loadPetManifest,
  getActivePet,
  setActivePet,
  installPetFromLocalPath,
} from './pet-store.js';

export {
  createInitialPetAgentContext,
  reducePetAgentContext,
  derivePetAnimationState,
  petStateFromChatFlags,
} from './agent-state-map.js';
export type { PetAgentContext } from './agent-state-map.js';
