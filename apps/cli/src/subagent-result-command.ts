/**
 * CLI result query. Same HostCommand as Desktop/remote.
 */
import type { HostCommand, HostResponse, SubagentResultSummary } from '@piwin/contracts';

export type SubagentResultHostClient = {
  handleCommand: (command: HostCommand) => Promise<HostResponse>;
};

export async function runSubagentResults(
  client: SubagentResultHostClient,
  parentSessionId: string,
  write: (line: string) => void,
): Promise<void> {
  const response = await client.handleCommand({
    type: 'subagent/results',
    parentSessionId,
  });
  if (!response.success) {
    throw new Error(response.error);
  }
  const data = response.data as { results?: SubagentResultSummary[] };
  const results = data.results ?? [];
  if (results.length === 0) {
    write(`session ${parentSessionId}: no subagent results`);
    return;
  }
  for (const result of results) {
    write(
      `${result.resultId}\trev ${String(result.revision)}\t${result.deliveryIntent}\t${result.integrationStatus}`,
    );
  }
}

export async function runSubagentResult(
  client: SubagentResultHostClient,
  resultId: string,
  write: (line: string) => void,
): Promise<void> {
  const response = await client.handleCommand({
    type: 'subagent/result',
    resultId,
  });
  if (!response.success) {
    throw new Error(response.error);
  }
  const result = response.data as SubagentResultSummary;
  write(
    `${result.resultId}\trev ${String(result.revision)}\t${result.deliveryIntent}\t${result.integrationStatus}`,
  );
}
