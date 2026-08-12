export type {
  ContextMenuActionId,
  ContextMenuCapabilities,
  ContextMenuItemSpec,
  ContextMenuSurface,
  ContextMenuTarget,
} from './types.js';
export { buildContextMenuItems } from './catalog.js';
export { mapTargetToContextRef, copyAsRefText } from './map-to-ref.js';
export { PRESET_TEMPLATES } from './presets.js';
export type { PresetTemplateId } from './presets.js';
export {
  dispatchContextMenuAction,
  type ContextMenuDispatchers,
} from './dispatch.js';
export { ContextMenuFromCatalog } from './ContextMenuFromCatalog.js';
export {
  DesktopContextMenuProvider,
  useDesktopContextMenu,
} from './desktop-context-menu-context.js';
export type { DesktopContextMenuValue } from './desktop-context-menu-context.js';
