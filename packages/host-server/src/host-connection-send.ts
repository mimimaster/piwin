import type { HostWireMessage } from '@piwin/contracts';
import { encodeHostWireMessage, HostProtocolError } from '@piwin/host-transport';
import { OPEN_READY_STATE, type HostClientConnection } from './host-client-connection.js';
import { waitForSocketSendBudget, type HostConnectionEvent } from './host-connection-lifecycle.js';
import { toError } from './host-server-support.js';

type HostErrorCode = Extract<HostWireMessage, { type: 'error' }>['code'];

export type HostConnectionSender = {
  send: (connection: HostClientConnection, message: HostWireMessage) => void;
  sendError: (
    connection: HostClientConnection,
    code: HostErrorCode,
    message: string,
    requestId?: string,
  ) => void;
  /** Waits for socket budget first; a consumer that never drains is closed. */
  sendResponse: (
    connection: HostClientConnection,
    message: Extract<HostWireMessage, { type: 'response' }>,
  ) => Promise<void>;
};

/**
 * Outbound frame writes for one Host server. An oversized response degrades to
 * an error frame for that request instead of tearing down the session; any
 * other send failure closes the connection.
 */
export function createHostConnectionSender(input: {
  onError: (error: Error) => void;
  onConnectionEvent: (event: HostConnectionEvent) => void;
}): HostConnectionSender {
  const send = (connection: HostClientConnection, message: HostWireMessage): void => {
    if (connection.socket.readyState !== OPEN_READY_STATE) {
      return;
    }
    try {
      connection.socket.send(encodeHostWireMessage(message));
    } catch (error) {
      input.onError(toError(error, 'Unable to send Host message'));
      if (error instanceof HostProtocolError && message.type === 'response') {
        try {
          connection.socket.send(
            encodeHostWireMessage({
              type: 'error',
              code: 'request-failed',
              message: error.message,
              requestId: message.requestId,
            }),
          );
          return;
        } catch {
          // Fall through to close.
        }
      }
      connection.socket.close(1011, 'Host send failed');
    }
  };

  const sendError: HostConnectionSender['sendError'] = (connection, code, message, requestId) => {
    send(
      connection,
      requestId === undefined
        ? { type: 'error', code, message }
        : { type: 'error', requestId, code, message },
    );
  };

  const sendResponse: HostConnectionSender['sendResponse'] = async (connection, message) => {
    const writable = await waitForSocketSendBudget(() => connection.socket.bufferedAmount);
    if (!writable) {
      input.onConnectionEvent({
        phase: 'slow-consumer',
        connectionId: connection.connectionId,
        ...(connection.clientId === undefined ? {} : { clientId: connection.clientId }),
        reason: 'response-backpressure-timeout',
      });
      connection.socket.close(4008, 'slow-consumer on response');
      return;
    }
    send(connection, message);
  };

  return { send, sendError, sendResponse };
}
