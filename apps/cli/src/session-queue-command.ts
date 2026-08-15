import type { HostCommand, HostResponse, PromptInput, QueuedTurnRecord } from '@piwin/contracts';

export type SessionQueueHostClient = {
  handleCommand: (command: HostCommand) => Promise<HostResponse>;
};

type QueueListData = {
  queueRevision: number;
  queuedTurns: QueuedTurnRecord[];
};

export async function runSessionQueueList(
  client: SessionQueueHostClient,
  sessionId: string,
  print: (line: string) => void,
): Promise<QueueListData> {
  const data = await loadQueue(client, sessionId);
  print(JSON.stringify(data, null, 2));
  return data;
}

export async function runSessionQueueEdit(
  client: SessionQueueHostClient,
  sessionId: string,
  queuedTurnId: string,
  text: string,
  expectedRevision?: number,
): Promise<QueuedTurnRecord> {
  const current = await findQueuedTurn(client, sessionId, queuedTurnId);
  const revision = expectedRevision ?? current.revision;
  const input: PromptInput = {
    ...current.input,
    text,
    clientMessageId: current.userMessageId,
  };
  const response = await client.handleCommand({
    type: 'session/queued-turn-edit',
    sessionId,
    queuedTurnId,
    expectedRevision: revision,
    input,
  });
  return requireQueuedTurn(response, 'session/queued-turn-edit');
}

export async function runSessionQueueCancel(
  client: SessionQueueHostClient,
  sessionId: string,
  queuedTurnId: string,
  expectedRevision?: number,
): Promise<QueuedTurnRecord> {
  const current = await findQueuedTurn(client, sessionId, queuedTurnId);
  const response = await client.handleCommand({
    type: 'session/queued-turn-cancel',
    sessionId,
    queuedTurnId,
    expectedRevision: expectedRevision ?? current.revision,
  });
  return requireQueuedTurn(response, 'session/queued-turn-cancel');
}

export async function runSessionQueueReorder(
  client: SessionQueueHostClient,
  sessionId: string,
  orderedQueuedTurnIds: string[],
  expectedQueueRevision?: number,
): Promise<QueueListData> {
  if (orderedQueuedTurnIds.length === 0) {
    throw new Error('At least one queued turn id is required for reorder');
  }
  const current = await loadQueue(client, sessionId);
  const response = await client.handleCommand({
    type: 'session/queued-turn-reorder',
    sessionId,
    expectedQueueRevision: expectedQueueRevision ?? current.queueRevision,
    orderedQueuedTurnIds,
  });
  if (!response.success) throw new Error(response.error);
  return requireQueueList(response, 'session/queued-turn-reorder');
}

export async function runSessionReplaceRun(
  client: SessionQueueHostClient,
  sessionId: string,
  runId: string,
  text: string,
  ids: { queuedTurnId: string; userMessageId: string },
): Promise<QueuedTurnRecord> {
  const response = await client.handleCommand({
    type: 'session/replace-run',
    sessionId,
    runId,
    queuedTurnId: ids.queuedTurnId,
    userMessageId: ids.userMessageId,
    input: {
      text,
      clientMessageId: ids.userMessageId,
    },
  });
  return requireQueuedTurn(response, 'session/replace-run');
}

async function loadQueue(
  client: SessionQueueHostClient,
  sessionId: string,
): Promise<QueueListData> {
  const response = await client.handleCommand({ type: 'session/queued-turn-list', sessionId });
  return requireQueueList(response, 'session/queued-turn-list');
}

async function findQueuedTurn(
  client: SessionQueueHostClient,
  sessionId: string,
  queuedTurnId: string,
): Promise<QueuedTurnRecord> {
  const data = await loadQueue(client, sessionId);
  const queuedTurn = data.queuedTurns.find((item) => item.queuedTurnId === queuedTurnId);
  if (!queuedTurn) throw new Error(`queued-turn-not-found: ${queuedTurnId}`);
  return queuedTurn;
}

function requireQueueList(response: HostResponse, command: string): QueueListData {
  if (!response.success) throw new Error(response.error);
  const data = response.data as Partial<QueueListData> | undefined;
  if (
    data === undefined ||
    !Number.isSafeInteger(data.queueRevision) ||
    !Array.isArray(data.queuedTurns)
  ) {
    throw new Error(`${command} returned an invalid queue projection`);
  }
  return {
    queueRevision: data.queueRevision as number,
    queuedTurns: data.queuedTurns as QueuedTurnRecord[],
  };
}

function requireQueuedTurn(response: HostResponse, command: string): QueuedTurnRecord {
  if (!response.success) throw new Error(response.error);
  const queuedTurn = (response.data as { queuedTurn?: unknown } | undefined)?.queuedTurn;
  if (!queuedTurn || typeof queuedTurn !== 'object') {
    throw new Error(`${command} returned no queued turn`);
  }
  return queuedTurn as QueuedTurnRecord;
}
