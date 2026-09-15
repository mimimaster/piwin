export type WorkspaceIdKind = 'view' | 'group' | 'split';
export type WorkspaceIdFactory = (kind: WorkspaceIdKind) => string;

export function createWorkspaceIdFactory(
  random: () => string = () => crypto.randomUUID(),
): WorkspaceIdFactory {
  return (kind) => `${kind}-${random()}`;
}

export function createSequentialIdFactory(): WorkspaceIdFactory {
  const counts: Record<WorkspaceIdKind, number> = { view: 0, group: 0, split: 0 };
  return (kind) => `${kind}-${String(++counts[kind])}`;
}
