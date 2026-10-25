/**
 * The socket closed before the Host answered the hello, with a code a retry
 * may fix (Host offline behind the relay, network drop). Carries the code so
 * shells can say which.
 */
export class HostSocketClosedError extends Error {
  public readonly name = 'HostSocketClosedError';
  public readonly closeCode: number;

  public constructor(message: string, closeCode: number) {
    super(message);
    this.closeCode = closeCode;
  }
}
