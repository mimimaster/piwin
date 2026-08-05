/** Pi-native tool constructors with product-neutral operation seams. */

export type PiShellExecOptions = {
  onData: (data: Buffer) => void;
  signal?: AbortSignal;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
};

export type PiLocalBashOperations = {
  exec: (
    command: string,
    commandCwd: string,
    options: PiShellExecOptions,
  ) => Promise<{ exitCode: number | null }>;
};

export type PiFileWriteOperations = {
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  mkdir: (directoryPath: string) => Promise<void>;
};

export type PiFileEditOperations = PiFileWriteOperations & {
  readFile: (absolutePath: string) => Promise<Buffer>;
  access: (absolutePath: string) => Promise<void>;
};

export async function createPiBashToolDefinition(
  cwd: string,
  execute: (
    command: string,
    commandCwd: string,
    options: PiShellExecOptions,
  ) => Promise<{ exitCode: number | null }>,
): Promise<unknown> {
  const piModule = await import('@earendil-works/pi-coding-agent');
  const createBashToolDefinition = (piModule as { createBashToolDefinition?: unknown })
    .createBashToolDefinition;
  if (typeof createBashToolDefinition !== 'function') {
    throw new Error('createBashToolDefinition missing from pi-coding-agent');
  }
  const createBash = createBashToolDefinition as (
    workingDirectory: string,
    options: { operations: { exec: typeof execute } },
  ) => unknown;
  return createBash(cwd, { operations: { exec: execute } });
}

export async function createPiLocalBashOperations(): Promise<PiLocalBashOperations> {
  const piModule = await import('@earendil-works/pi-coding-agent');
  const createLocalBashOperations = (piModule as { createLocalBashOperations?: unknown })
    .createLocalBashOperations;
  if (typeof createLocalBashOperations !== 'function') {
    throw new Error('createLocalBashOperations missing from pi-coding-agent');
  }
  return (createLocalBashOperations as () => PiLocalBashOperations)();
}

export async function createPiFileToolDefinitions(
  cwd: string,
  writeOperations: PiFileWriteOperations,
  editOperations: PiFileEditOperations,
): Promise<unknown[]> {
  const piModule = await import('@earendil-works/pi-coding-agent');
  const createWriteToolDefinition = (piModule as { createWriteToolDefinition?: unknown })
    .createWriteToolDefinition;
  const createEditToolDefinition = (piModule as { createEditToolDefinition?: unknown })
    .createEditToolDefinition;
  if (typeof createWriteToolDefinition !== 'function') {
    throw new Error('createWriteToolDefinition missing from pi-coding-agent');
  }
  if (typeof createEditToolDefinition !== 'function') {
    throw new Error('createEditToolDefinition missing from pi-coding-agent');
  }
  const createWrite = createWriteToolDefinition as (
    workingDirectory: string,
    options: { operations: PiFileWriteOperations },
  ) => unknown;
  const createEdit = createEditToolDefinition as (
    workingDirectory: string,
    options: { operations: PiFileEditOperations },
  ) => unknown;
  return [
    createWrite(cwd, { operations: writeOperations }),
    createEdit(cwd, { operations: editOperations }),
  ];
}
