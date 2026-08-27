export function createCancelledExtensionUiResponse(
  kind: import('@piwin/agent-host').ExtensionUiKind,
): import('@piwin/agent-host').ExtensionUiResponse {
  if (kind === 'confirm') {
    return { kind, confirmed: false };
  }
  return { kind, cancelled: true };
}
