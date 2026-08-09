export type SteerQueueMessage = {
  id: string;
  text: string;
  createdAt: string;
};

export type SteerQueuesBySession = Readonly<Record<string, readonly SteerQueueMessage[]>>;

export function appendSteerQueueMessage(
  queues: SteerQueuesBySession,
  sessionId: string,
  message: SteerQueueMessage,
): SteerQueuesBySession {
  return {
    ...queues,
    [sessionId]: [...(queues[sessionId] ?? []), message],
  };
}

export function editSteerQueueMessage(
  queues: SteerQueuesBySession,
  sessionId: string,
  messageId: string,
  text: string,
): SteerQueuesBySession {
  const nextText = text.trim();
  if (!nextText) return queues;
  const messages = queues[sessionId] ?? [];
  if (!messages.some((message) => message.id === messageId)) return queues;
  return {
    ...queues,
    [sessionId]: messages.map((message) =>
      message.id === messageId ? { ...message, text: nextText } : message,
    ),
  };
}

export function removeSteerQueueMessage(
  queues: SteerQueuesBySession,
  sessionId: string,
  messageId: string,
): SteerQueuesBySession {
  const messages = queues[sessionId] ?? [];
  const nextMessages = messages.filter((message) => message.id !== messageId);
  if (nextMessages.length === messages.length) return queues;
  const nextQueues = { ...queues };
  if (nextMessages.length === 0) {
    delete nextQueues[sessionId];
  } else {
    nextQueues[sessionId] = nextMessages;
  }
  return nextQueues;
}
