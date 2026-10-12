/** Pi command dispatch precedes model input; assembled context must not become command arguments. */
export type PiExtensionCommandSession = {
  extensionRunner?: { getCommand(name: string): unknown };
};

export function selectPiPromptText(
  session: PiExtensionCommandSession,
  assembledText: string,
  extensionCommandText: string | undefined,
  hasImages = false,
): string {
  if (hasImages || !extensionCommandText?.startsWith('/')) return assembledText;
  const name = /^\/([^\s]+)(?:\s|$)/.exec(extensionCommandText)?.[1];
  // The backend's actual loaded generation is authoritative, not a stale UI catalog.
  return name && session.extensionRunner?.getCommand(name) ? extensionCommandText : assembledText;
}
