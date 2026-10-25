export type RelayLogEvent =
  | { kind: 'listening'; url: string }
  | { kind: 'host-ready'; userId: string; hostId: string; replaced: boolean }
  | { kind: 'host-rejected'; userId: string; hostId: string; code: number; detail: string }
  | { kind: 'host-closed'; userId: string; hostId: string; code: number }
  | { kind: 'user-enrolled'; userId: string }
  | { kind: 'peer-joined'; userId: string; hostId: string; peer: number; peers: number }
  | { kind: 'peer-left'; userId: string; hostId: string; peer: number; code: number }
  | { kind: 'peer-rejected'; code: number }
  | { kind: 'rate-limited'; ip: string }
  | { kind: 'registry-reloaded'; users: number }
  | { kind: 'registry-error'; detail: string };

export type RelayLogger = (event: RelayLogEvent) => void;

const ID_PREFIX_LENGTH = 6;

/**
 * Line logger for operators: ids are cut to a short prefix, IPs only when the
 * operator opted in. No frame contents exist here to log.
 */
export function createConsoleRelayLogger(options: {
  logIps: boolean;
  write?: (line: string) => void;
}): RelayLogger {
  const write = options.write ?? ((line: string) => console.log(line));
  return (event) => {
    const fields: string[] = [];
    for (const [key, value] of Object.entries(event)) {
      if (key === 'kind') continue;
      if (key === 'ip' && !options.logIps) {
        fields.push('ip=redacted');
        continue;
      }
      const shown = key === 'userId' || key === 'hostId' ? shortId(String(value)) : String(value);
      fields.push(`${key}=${shown}`);
    }
    write([new Date().toISOString(), event.kind, ...fields].join(' '));
  };
}

export function shortId(id: string): string {
  return id.slice(0, ID_PREFIX_LENGTH);
}
