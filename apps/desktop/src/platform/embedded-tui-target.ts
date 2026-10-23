import type { EmbeddedTuiLaunch, HostAttachTarget } from '@piwin/contracts';
import { peekDeviceCredential, selectAdmissionKey } from '../devices/device-admission.js';
import { isOpaqueRemoteProjectId } from '../host/remote-session-hydrate.js';

/** Resolve at launch, after Desktop has exchanged any one-time pairing token. */
export function resolveEmbeddedTuiLaunch(input: {
  sessionId: string | null;
  projectPath: string | null;
  remoteTarget?: HostAttachTarget;
}): EmbeddedTuiLaunch {
  const remote = input.remoteTarget;
  const admission = remote === undefined ? undefined : selectAdmissionKey({
    deviceCredential: remote.deviceCredential ?? peekDeviceCredential(remote.endpoint),
    authToken: remote.authToken,
  });
  const remoteTarget = remote === undefined ? undefined : {
    endpoint: remote.endpoint,
    ...(admission?.kind === 'device-credential' ? { deviceCredential: admission.deviceCredential } : {}),
    ...(admission?.kind === 'auth-token' ? { authToken: admission.authToken } : {}),
  };
  const connection = remoteTarget === undefined ? {} : { remoteTarget };
  if (input.sessionId !== null) return { ...connection, sessionId: input.sessionId };
  if (input.projectPath === null) return connection;
  if (remoteTarget === undefined) return { projectPath: input.projectPath };
  if (!isOpaqueRemoteProjectId(input.projectPath)) {
    throw new Error('A remote TUI conversation requires a Host project id');
  }
  return { ...connection, projectId: input.projectPath };
}
