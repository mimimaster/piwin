/**
 * Browser session host tools (ADR 0020 §3, §5).
 *
 * Public barrel: existing imports from `./browser-tools.js` keep working.
 * Implementations live in `browser-navigate-permission.ts` and
 * `browser-tool-registrations.ts`.
 */
export { evaluateBrowserNavigatePermission } from './browser-navigate-permission.js';
export { createBrowserToolDefinitions } from './browser-tool-registrations.js';
export type { BrowserToolDefinitionOptions } from './browser-tool-registrations.js';
