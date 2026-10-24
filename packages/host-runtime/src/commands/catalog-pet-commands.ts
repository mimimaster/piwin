/**
 * Pet IPC: local and registry installs, store queries, cancel of an in-flight install, and the active pet.
 */
import type { HostCommand, HostResponse } from '@piwin/contracts';
import {
  deletePet,
  installPetFromLocalPath,
  installPetFromLocalPaths,
  installPetFromRegistry,
  listPets,
  queryRemotePetStore,
  scanLocalPets,
  setActivePet,
} from '@piwin/pet';
import { ok } from '../response-helpers.js';
import { fallbackPetSnapshot } from '../pet-snapshot-fallback.js';
import { getPiwinRoot } from '../paths.js';
import type { HostCommandContext } from './host-command-context.js';

/**
 * In-flight pet install/query AbortControllers keyed by request id, so the
 * desktop can cancel a long-running download via `pet/cancel`. Entries are
 * removed by the owning request's `finally` block on completion.
 */
const activePetAborts = new Map<string, AbortController>();

export async function handlePetCatalogCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  switch (command.type) {
    case 'pet/list': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const data = await listPets(rootDir);
      return ok(requestId, 'pet/list', data);
    }
    case 'pet/get-active': {
      const pet = context.petStateStore.snapshot().pet;
      return ok(requestId, 'pet/get-active', { pet });
    }
    case 'pet/set-active': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const pet = await setActivePet(rootDir, command.petId);
      context.petStateStore.setBase(pet);
      return ok(requestId, 'pet/set-active', { pet });
    }
    case 'pet/scan-local': {
      const preview = await scanLocalPets(command.sourcePath);
      return ok(requestId, 'pet/scan-local', preview);
    }
    case 'pet/install-local': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const installed = await installPetFromLocalPath(rootDir, command.sourcePath);
      return ok(requestId, 'pet/install-local', installed);
    }
    case 'pet/install-local-batch': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const result = await installPetFromLocalPaths(rootDir, command.sourcePaths);
      return ok(requestId, 'pet/install-local-batch', result);
    }
    case 'pet/store-query': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const controller = new AbortController();
      if (requestId) activePetAborts.set(requestId, controller);
      try {
        const results = await queryRemotePetStore(rootDir, command.query.query, controller.signal);
        return ok(requestId, 'pet/store-query', { results });
      } finally {
        if (requestId) activePetAborts.delete(requestId);
      }
    }
    case 'pet/install-registry': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const controller = new AbortController();
      if (requestId) activePetAborts.set(requestId, controller);
      try {
        const installed = await installPetFromRegistry(rootDir, command.url, controller.signal);
        return ok(requestId, 'pet/install-registry', installed);
      } finally {
        if (requestId) activePetAborts.delete(requestId);
      }
    }
    case 'pet/cancel': {
      const controller = activePetAborts.get(command.requestId);
      if (controller) {
        controller.abort();
        activePetAborts.delete(command.requestId);
      }
      return ok(requestId, 'pet/cancel', { cancelled: true });
    }
    case 'pet/delete': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const result = await deletePet(rootDir, command.petId);
      if (result.fallbackPet) {
        context.petStateStore.setBase(result.fallbackPet);
      } else if (context.petStateStore.snapshot().pet.petId === command.petId) {
        context.petStateStore.setBase(fallbackPetSnapshot());
      }
      return ok(requestId, 'pet/delete', { deleted: true, fallbackPet: result.fallbackPet });
    }
    default:
      return null;
  }
}
