/**
 * Block write/edit targeting secret-like paths (.env, keys, credentials).
 * @piwin-bundled-extension
 *
 * Loaded by Pi jiti as a product extension under ~/.piwin/extensions.
 * Disable via config.extensions.disabledIds: ["path-guard"].
 */

type ExtensionApi = {
  on: (
    event: 'tool_call',
    handler: (
      event: { toolName: string; input: Record<string, unknown> },
      ctx: unknown,
    ) =>
      | Promise<{ block?: boolean; reason?: string } | void>
      | { block?: boolean; reason?: string }
      | void,
  ) => void;
};

const SECRET_BASENAME_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i,
  /^\.envrc$/i,
  /credentials\.json$/i,
  /service[-_]?account.*\.json$/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa$/i,
  /id_ed25519$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /secrets?\.(ya?ml|json|toml)$/i,
];

export default function pathGuardExtension(pi: ExtensionApi): void {
  pi.on('tool_call', (event) => {
    if (event.toolName !== 'write' && event.toolName !== 'edit') {
      return;
    }
    const pathValue = readPathFromToolInput(event.input);
    if (!pathValue) {
      return;
    }
    const baseName = pathValue.split(/[/\\]/).pop() ?? pathValue;
    for (const pattern of SECRET_BASENAME_PATTERNS) {
      if (pattern.test(baseName)) {
        return {
          block: true,
          reason: `piwin path-guard blocked write/edit to secret-like path: ${baseName}`,
        };
      }
    }
    return;
  });
}

function readPathFromToolInput(input: Record<string, unknown>): string | undefined {
  const candidates = [input.path, input.file_path, input.filePath];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return undefined;
}
