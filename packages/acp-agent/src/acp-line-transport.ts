export type AcpTransportCloseInfo = {
  code: number | null;
  signal: string | null;
  reason?: string;
};

export interface AcpLineTransport {
  /** One JSON message, no trailing newline; the transport adds it. */
  send(line: string): void;
  onLine(listener: (line: string) => void): () => void;
  onClose(listener: (info: AcpTransportCloseInfo) => void): () => void;
  close(): Promise<void>;
}
