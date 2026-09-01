import type { SessionListItemUi } from './chat-ui-types';
import { isPlaceholderSessionName } from './title-display';

/**
 * Merge a Host index snapshot or patch onto a known entity.
 * Explicit `false` / empty optional fields clear prior true values; omitted
 * keys keep the existing entity so a name-only push cannot drop pin/archive.
 */
export function mergeSessionListItem(
  existing: SessionListItemUi | undefined,
  patch: SessionListItemUi,
): SessionListItemUi {
  const base: SessionListItemUi = existing ?? { id: patch.id, name: '' };
  const keepExistingName =
    Object.prototype.hasOwnProperty.call(patch, 'name') &&
    isPlaceholderSessionName(patch.name) &&
    !isPlaceholderSessionName(base.name);
  const merged: SessionListItemUi = {
    ...base,
    ...patch,
    id: patch.id,
    name: keepExistingName ? base.name : (patch.name ?? base.name),
  };
  applyOptionalFlag(patch, merged, 'isPinned');
  applyOptionalFlag(patch, merged, 'isArchived');
  if (Object.prototype.hasOwnProperty.call(patch, 'storage')) {
    if (patch.storage === undefined) {
      delete merged.storage;
    } else {
      merged.storage = patch.storage;
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'scope') && patch.scope) {
    merged.scope = patch.scope;
  } else if (base.scope) {
    merged.scope = base.scope;
  }
  return merged;
}

function applyOptionalFlag(
  patch: SessionListItemUi,
  merged: SessionListItemUi,
  key: 'isPinned' | 'isArchived',
): void {
  if (!Object.prototype.hasOwnProperty.call(patch, key)) {
    return;
  }
  if (patch[key] === true) {
    merged[key] = true;
    return;
  }
  delete merged[key];
}
