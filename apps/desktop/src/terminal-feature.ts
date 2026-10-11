/** Device rollout policy for Desktop terminal surfaces. */
export type TerminalFeatureEnvironment = {
  development: boolean;
  mode: string;
  e2eFixtures?: string | undefined;
};

export function isTerminalFeatureEnabled(
  preference: boolean | undefined,
  environment: TerminalFeatureEnvironment = {
    development: import.meta.env.DEV,
    mode: import.meta.env.MODE,
    e2eFixtures: import.meta.env.VITE_PIWIN_E2E_FIXTURES,
  },
): boolean {
  return preference ?? (
    environment.development || environment.mode === 'test' || environment.e2eFixtures === 'true'
  );
}

/** Only native Desktop can render the TUI; remote attachment must be explicit. */
export function canOpenEmbeddedTui(input: {
  terminalEnabled: boolean;
  nativePtyAvailable: boolean;
  transport: 'mock' | 'live' | 'remote';
  remoteTargetAvailable?: boolean;
}): boolean {
  return input.terminalEnabled && input.nativePtyAvailable && (
    input.transport === 'live' || (input.transport === 'remote' && input.remoteTargetAvailable === true)
  );
}
