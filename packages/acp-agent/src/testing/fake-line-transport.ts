import type { AcpLineTransport, AcpTransportCloseInfo } from '../acp-line-transport.js';

export type FakeLineTransport = AcpLineTransport & {
  readonly sent: string[];
  deliver(line: string): void;
  closeFromRemote(info?: AcpTransportCloseInfo): void;
};

export function createFakeLineTransport(): FakeLineTransport {
  const sent: string[] = [];
  const lineListeners = new Set<(line: string) => void>();
  const closeListeners = new Set<(info: AcpTransportCloseInfo) => void>();
  let closed = false;

  function emitClose(info: AcpTransportCloseInfo): void {
    if (closed) {
      return;
    }
    closed = true;
    for (const listener of [...closeListeners]) {
      listener(info);
    }
  }

  return {
    sent,
    send(line: string): void {
      sent.push(line);
    },
    onLine(listener: (line: string) => void): () => void {
      lineListeners.add(listener);
      return () => {
        lineListeners.delete(listener);
      };
    },
    onClose(listener: (info: AcpTransportCloseInfo) => void): () => void {
      closeListeners.add(listener);
      return () => {
        closeListeners.delete(listener);
      };
    },
    async close(): Promise<void> {
      emitClose({ code: null, signal: null, reason: 'closed' });
    },
    deliver(line: string): void {
      for (const listener of [...lineListeners]) {
        listener(line);
      }
    },
    closeFromRemote(info?: AcpTransportCloseInfo): void {
      const closeInfo: AcpTransportCloseInfo =
        info === undefined ? { code: null, signal: null, reason: 'remote' } : info;
      emitClose(closeInfo);
    },
  };
}
