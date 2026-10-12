/** Only native Desktop can render the TUI; remote attachment must be explicit. */
export function canOpenEmbeddedTui(input: {
  nativePtyAvailable: boolean;
  transport: 'mock' | 'live' | 'remote';
  remoteTargetAvailable?: boolean;
}): boolean {
  return input.nativePtyAvailable && (
    input.transport === 'live' || (input.transport === 'remote' && input.remoteTargetAvailable === true)
  );
}
