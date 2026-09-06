/**
 * Formerly stripped Host filesystem roots (`/Users/…`, `/home/…`, Windows
 * drive letters) down to `[host-path]`. Product decision: remote clients see
 * the real Host paths in tool cards / commands / errors. Secrets stay on the
 * separate REMOTE_SECRET_KEYS path; media still maps to `remote-asset:` refs.
 */
export function redactRemoteHostPaths(value: string): string {
  return value;
}
