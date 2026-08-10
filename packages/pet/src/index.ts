/** @piwin/pet — Codex-compatible pet packages + agent state mapping. */

export {
  validatePetManifest,
  normalizePetManifestRecord,
  resolvePetLayout,
} from './validate-manifest.js';
export type {
  PetValidationIssue,
  PetValidationResult,
  ValidatePetManifestOptions,
} from './validate-manifest.js';

export {
  getPetsDir,
  getPetPreferencePath,
  getDefaultCodexPetsDir,
  loadPetPreference,
  savePetPreference,
  listPets,
  loadPetManifest,
  getActivePet,
  setActivePet,
  installPetFromLocalPath,
  installPetFromRegistry,
  queryRemotePetStore,
} from './pet-store.js';
export {
  createPetSourceRegistry,
  discoverAllPets,
  resolvePet,
  installPet,
  queryPetStore,
  type PetSourceRegistry,
} from './pet-source-registry.js';
export {
  PET_SOURCE_PRIORITY,
  type PetSourceProvider,
  type PetSourceProviderContext,
} from './sources/pet-source-provider.js';
export { bundledProvider } from './sources/bundled-provider.js';
export { localProvider } from './sources/local-provider.js';
export { codexProvider, getCodexSelectedPetId } from './sources/codex-provider.js';
export { registryProvider } from './sources/registry-provider.js';
export { downloadAndVerifyPackage, PET_MAX_DOWNLOAD_BYTES } from './sources/registry-download.js';
export {
  installPetFromSlug,
  fetchInstallManifest,
  isPetSlug,
  CODEXPETHUB_ORIGIN,
  INSTALL_MANIFEST_SCHEMA,
} from './sources/install-manifest.js';
export {
  installPetFromCodexPetsNet,
  fetchCodexPetsNetDetail,
  CODEX_PETS_NET_ORIGIN,
} from './sources/codex-pets-net.js';

export {
  createInitialPetAgentContext,
  reducePetAgentContext,
  derivePetAnimationState,
  petStateFromChatFlags,
} from './agent-state-map.js';
export type { PetAgentContext } from './agent-state-map.js';
