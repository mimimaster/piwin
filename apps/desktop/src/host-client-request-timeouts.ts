import type { HostCommand, LocalMobileAccessCommand } from '@piwin/contracts';
import { isLocalMobileAccessCommandType } from '@piwin/contracts';
import type { TransportMode } from './host-client-transport-detect.js';

/**
 * Per-command request timeout policy. Long operations (compaction, model and
 * media work) opt out of the ack budget; remote transports need a wider ack
 * window than the local JSONL sidecar.
 */

const HOST_REQUEST_ACK_TIMEOUT_MS = 5_000;
/**
 * Remote WebSocket acks share the Host event loop with hello replay and
 * first-boot journal recovery. Five seconds is the sidecar JSONL budget;
 * remote needs a wider one or Send paints a timeout while Host is still
 * accepting the run.
 */
const REMOTE_HOST_REQUEST_ACK_TIMEOUT_MS = 30_000;
/**
 * A zero timeout tells the Tauri bridge to wait until the Host responds.
 * Compaction is a model completion, not an acknowledgement: its explicit
 * abort command is the bounded control path.
 */
const HOST_REQUEST_NO_TIMEOUT_MS = 0;
const HOST_REQUEST_STATUS_TIMEOUT_MS = 3_000;
const REMOTE_HOST_REQUEST_STATUS_TIMEOUT_MS = 15_000;
const HOST_REQUEST_QUERY_TIMEOUT_MS = 15_000;
const HOST_REQUEST_OPERATION_TIMEOUT_MS = 120_000;
const HOST_REQUEST_IMAGE_GENERATION_TIMEOUT_MS = 360_000;
const HOST_REQUEST_NETWORK_QUERY_TIMEOUT_MS = 30_000;
const HOST_REQUEST_LIVE_START_TIMEOUT_MS = 30_000;
/** Above the Host's 45 s MCP registry search bound, so the registry's own timeout reports first. */
const HOST_REQUEST_MARKETPLACE_SEARCH_TIMEOUT_MS = 60_000;

export function getHostRequestTimeoutMs(
  command: HostCommand | LocalMobileAccessCommand,
  transport: TransportMode = 'live',
): number {
  if (isLocalMobileAccessCommandType(command.type)) {
    return HOST_REQUEST_QUERY_TIMEOUT_MS;
  }
  const remote = transport === 'remote';
  switch (command.type) {
    case 'session/compact':
    case 'session/compact-export':
    case 'session/handoff':
      return HOST_REQUEST_NO_TIMEOUT_MS;
    case 'session/prompt':
    case 'session/abort':
    case 'session/pause':
    case 'session/resume-run':
    case 'session/compact-abort':
    case 'session/steer':
    case 'session/follow_up':
    case 'run/intervention-submit':
    case 'run/intervention-edit':
    case 'run/intervention-cancel':
    case 'run/idle-loop-dismiss':
    case 'session/queued-turn-submit':
    case 'session/queued-turn-edit':
    case 'session/queued-turn-cancel':
    case 'session/queued-turn-reorder':
    case 'session/replace-run':
    case 'permission/resolve':
    case 'extension/ui_resolve':
    case 'project/authorize-terminal':
      return remote ? REMOTE_HOST_REQUEST_ACK_TIMEOUT_MS : HOST_REQUEST_ACK_TIMEOUT_MS;
    case 'host/ping':
    case 'host/status':
      return remote ? REMOTE_HOST_REQUEST_STATUS_TIMEOUT_MS : HOST_REQUEST_STATUS_TIMEOUT_MS;
    case 'voice/live/status':
    case 'voice/live/end':
      return HOST_REQUEST_ACK_TIMEOUT_MS;
    case 'voice/live/start':
      return HOST_REQUEST_LIVE_START_TIMEOUT_MS;
    case 'models/discover':
    case 'models/test':
    case 'models/test-connection':
    // A knowledge probe is one live round trip to a user-typed endpoint.
    case 'knowledge/test-connection':
    case 'knowledge/embedding-models/discover':
    // Native startup and handoff await adapter initialization and session I/O.
    case 'agents/cli-open':
    case 'agents/cli-sync':
    case 'agents/cli-snapshot':
    case 'speech/transcribe':
    case 'mcp/start':
    case 'mcp/stop':
    case 'mcp/list_tools':
    case 'skills/install':
    case 'skills/uninstall':
    case 'skills/update':
    case 'extensions/install':
    case 'extensions/uninstall':
    case 'extensions/apply':
    case 'marketplace/package-install':
    case 'marketplace/package-remove':
    case 'mcp/registry-install-draft':
    case 'mcp/remove':
    case 'plugins/install':
    case 'plugins/uninstall':
    case 'plugins/registry/list':
    case 'session/cold-storage-execute':
    case 'session/cold-storage-restore':
    case 'session/cold-storage-import':
    case 'theme/install-local':
    case 'pet/scan-local':
    case 'pet/install-local':
    case 'pet/install-local-batch':
    case 'pet/install-registry':
      return HOST_REQUEST_OPERATION_TIMEOUT_MS;
    case 'models/image-test':
      return HOST_REQUEST_IMAGE_GENERATION_TIMEOUT_MS;
    case 'pet/store-query':
    // npm then GitHub, each bounded at 8s on the Host.
    case 'marketplace/package-detail':
      return HOST_REQUEST_NETWORK_QUERY_TIMEOUT_MS;
    case 'marketplace/search':
      return HOST_REQUEST_MARKETPLACE_SEARCH_TIMEOUT_MS;
    default:
      return HOST_REQUEST_QUERY_TIMEOUT_MS;
  }
}
