/** Redact Host filesystem roots in strings that still need to cross the wire. */
export function redactRemoteHostPaths(value: string): string {
  return value.replace(
    /(?:\/Users\/|\/home\/|\b[A-Za-z]:[\\/])[^\s'"`]+/g,
    '[host-path]',
  );
}
