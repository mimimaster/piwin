/**
 * App-owned shell navigation stack for the desktop titleband back/forward controls.
 *
 * This is intentionally not browser history:
 * - Tauri/WebView history APIs are inconsistent for SPA destinations.
 * - Settings is a shell destination, not a document navigation.
 * - Forward stack is truncated on every explicit push, like a normal app stack.
 */

export type ShellSettingsSection =
  | 'general'
  | 'appearance'
  | 'skills'
  | 'extensions'
  | 'prompts'
  | 'tools'
  | 'web'
  | 'models'
  | 'pets'
  | 'automation'
  | 'session'
  // Legacy deep links preserved for backward compatibility; consumers should
  // normalize through the section registry before rendering.
  | 'agents'
  | 'rules';

export type ShellRoute =
  | { kind: 'workspace' }
  | { kind: 'settings'; section: ShellSettingsSection };

export type ShellNavigationState = {
  entries: ShellRoute[];
  /** Index of the currently applied route. */
  index: number;
};

export function createInitialShellNavigation(): ShellNavigationState {
  return {
    entries: [{ kind: 'workspace' }],
    index: 0,
  };
}

export function currentShellRoute(state: ShellNavigationState): ShellRoute {
  const route = state.entries[state.index];
  return route ?? { kind: 'workspace' };
}

export function canGoShellBack(state: ShellNavigationState): boolean {
  return state.index > 0;
}

export function canGoShellForward(state: ShellNavigationState): boolean {
  return state.index < state.entries.length - 1;
}

function routesEqual(left: ShellRoute, right: ShellRoute): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'settings' && right.kind === 'settings') {
    return left.section === right.section;
  }
  return true;
}

/**
 * Push a destination. If it equals the current route, leave the stack unchanged.
 * Any forward entries after the current index are discarded.
 */
export function pushShellRoute(
  state: ShellNavigationState,
  route: ShellRoute,
): ShellNavigationState {
  const current = currentShellRoute(state);
  if (routesEqual(current, route)) {
    return state;
  }

  // Already on settings: only replace the section, do not spam stack entries.
  if (current.kind === 'settings' && route.kind === 'settings') {
    const nextEntries = state.entries.slice();
    nextEntries[state.index] = route;
    return {
      entries: nextEntries,
      index: state.index,
    };
  }

  const retained = state.entries.slice(0, state.index + 1);
  retained.push(route);
  return {
    entries: retained,
    index: retained.length - 1,
  };
}

export function goShellBack(state: ShellNavigationState): ShellNavigationState {
  if (!canGoShellBack(state)) {
    return state;
  }
  return {
    entries: state.entries,
    index: state.index - 1,
  };
}

export function goShellForward(state: ShellNavigationState): ShellNavigationState {
  if (!canGoShellForward(state)) {
    return state;
  }
  return {
    entries: state.entries,
    index: state.index + 1,
  };
}

/** Esc / explicit close: leave settings for the previous workspace entry when possible. */
export function leaveSettingsRoute(state: ShellNavigationState): ShellNavigationState {
  const current = currentShellRoute(state);
  if (current.kind !== 'settings') {
    return state;
  }
  if (canGoShellBack(state)) {
    return goShellBack(state);
  }
  return pushShellRoute(state, { kind: 'workspace' });
}
