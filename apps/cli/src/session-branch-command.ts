import type {
  HostCommand,
  HostResponse,
  SessionBranchListData,
  SessionBranchSwitchData,
} from '@piwin/contracts';

export type SessionBranchHostClient = {
  handleCommand: (command: HostCommand) => Promise<HostResponse>;
};

export async function runSessionBranches(
  client: SessionBranchHostClient,
  sessionId: string,
  print: (line: string) => void,
): Promise<SessionBranchListData> {
  const response = await client.handleCommand({
    type: 'session/branch-list',
    sessionId,
  });
  if (!response.success) {
    throw new Error(response.error);
  }
  const data = response.data as SessionBranchListData;
  if (data.branchPoints.length === 0) {
    print(`session ${sessionId}: no forks`);
    return data;
  }
  for (const [pointIndex, point] of data.branchPoints.entries()) {
    const anchor = point.anchorMessageId ?? '(root)';
    print(`fork ${pointIndex + 1} at ${anchor}  (${point.activeIndex + 1}/${point.siblings.length} active)`);
    for (const [siblingIndex, sibling] of point.siblings.entries()) {
      const marker = siblingIndex === point.activeIndex ? '*' : ' ';
      // `write` warns that switching away strands file changes (ADR 0055 §6).
      const writes = sibling.writesWorkspace ? ' (write)' : '';
      print(
        `  ${marker} [${siblingIndex + 1}] ${sibling.headMessageId}${writes}  ${sibling.preview}`,
      );
    }
  }
  return data;
}

export async function runSessionSwitch(
  client: SessionBranchHostClient,
  sessionId: string,
  targetMessageId: string,
  print: (line: string) => void,
  options?: { confirm?: boolean },
): Promise<SessionBranchSwitchData> {
  const response = await client.handleCommand({
    type: 'session/branch-switch',
    sessionId,
    targetMessageId,
    messageProjection: 'none',
    ...(options?.confirm === true ? { confirm: true } : {}),
  });
  if (!response.success) {
    throw new Error(response.error);
  }
  const data = response.data as SessionBranchSwitchData;
  if (data.status === 'run-active') {
    print('run-active: stop the current run before switching branches');
    return data;
  }
  if (data.status === 'needs-confirmation') {
    print('needs-confirmation: the abandoned branch wrote files; disk will not follow the switch');
    if (data.offPathWrites.files.length > 0) {
      print(`files: ${data.offPathWrites.files.join(', ')}`);
    }
    if (data.offPathWrites.hasUnknownWrites) {
      print('unknown writes were also recorded');
    }
    print('re-run with --confirm to switch anyway');
    return data;
  }
  print(`switched ${sessionId} → leaf ${data.activeLeafMessageId}`);
  return data;
}
