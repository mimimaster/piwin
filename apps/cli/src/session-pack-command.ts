/**
 * CLI helpers for non-destructive session pack backup (Cold Storage R1 PR1).
 */
import type {
  HostCommand,
  HostResponse,
  SessionPackCreateResultData,
  SessionPackListData,
  SessionPackVerifyResultData,
} from '@piwin/contracts';

export type SessionPackHostClient = {
  handleCommand: (command: HostCommand) => Promise<HostResponse>;
};

export async function runSessionPackCreate(
  client: SessionPackHostClient,
  input: { sessionId: string; outputDir: string; packId?: string },
  print: (line: string) => void,
): Promise<SessionPackCreateResultData> {
  const response = await client.handleCommand({
    type: 'session/pack-create',
    sessionId: input.sessionId,
    outputDir: input.outputDir,
    ...(input.packId ? { packId: input.packId } : {}),
  });
  if (!response.success) {
    throw new Error(response.error);
  }
  const data = response.data as SessionPackCreateResultData;
  print(formatSessionPackCreateResult(data));
  return data;
}

export async function runSessionPackVerify(
  client: SessionPackHostClient,
  packPath: string,
  print: (line: string) => void,
): Promise<SessionPackVerifyResultData> {
  const response = await client.handleCommand({
    type: 'session/pack-verify',
    packPath,
  });
  if (!response.success) {
    throw new Error(response.error);
  }
  const data = response.data as SessionPackVerifyResultData;
  print(formatSessionPackVerifyResult(data));
  return data;
}

export async function runSessionPackList(
  client: SessionPackHostClient,
  directory: string,
  print: (line: string) => void,
): Promise<SessionPackListData> {
  const response = await client.handleCommand({
    type: 'session/pack-list',
    directory,
  });
  if (!response.success) {
    throw new Error(response.error);
  }
  const data = response.data as SessionPackListData;
  print(formatSessionPackList(data));
  return data;
}

export function formatSessionPackCreateResult(data: SessionPackCreateResultData): string {
  const lines = [
    `packId: ${data.packId}`,
    `sessionId: ${data.sessionId}`,
    `packPath: ${data.packPath}`,
    `sidecarPath: ${data.sidecarPath}`,
    `archiveSha256: ${data.archiveSha256}`,
    `transcriptSha256: ${data.transcriptSha256}`,
    `payloadBytes: ${data.payloadBytes}`,
    `mediaIncluded: ${data.mediaIncluded}`,
  ];
  if (data.mediaTreeSha256) {
    lines.push(`mediaTreeSha256: ${data.mediaTreeSha256}`);
  }
  return lines.join('\n');
}

export function formatSessionPackVerifyResult(data: SessionPackVerifyResultData): string {
  const lines = [
    `valid: ${data.valid}`,
    `packId: ${data.packId}`,
    `sessionId: ${data.sessionId}`,
    `packPath: ${data.packPath}`,
    `archiveSha256: ${data.archiveSha256}`,
    `transcriptSha256: ${data.transcriptSha256}`,
    `messageCount: ${data.messageCount}`,
    `payloadBytes: ${data.payloadBytes}`,
    `mediaIncluded: ${data.mediaIncluded}`,
  ];
  if (data.mediaTreeSha256) {
    lines.push(`mediaTreeSha256: ${data.mediaTreeSha256}`);
  }
  return lines.join('\n');
}

export function formatSessionPackList(data: SessionPackListData): string {
  if (data.packs.length === 0) {
    return `(no packs in ${data.directory})`;
  }
  const lines = [`directory: ${data.directory}`, 'packId\tsessionId\tvalid\tbytes\tpackPath'];
  for (const pack of data.packs) {
    lines.push(
      `${pack.packId}\t${pack.sessionId || '-'}\t${pack.valid}\t${pack.payloadBytes}\t${pack.packPath}${
        pack.error ? `\t${pack.error}` : ''
      }`,
    );
  }
  return lines.join('\n');
}
