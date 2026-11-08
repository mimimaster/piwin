import { asArray, asLoose, asString } from './values.js';

/** Paths Devin reports back in the replacement message ("you edited ..."). */
export type CompactState = {
  cwd: string;
  compactionCount: number;
  editedFiles: string[];
  lastHistoryFile?: string;
  pendingFocus?: string;
};

export const EDITED_FILES_LIMIT = 50;

export function createCompactState(cwd: string): CompactState {
  return { cwd, compactionCount: 0, editedFiles: [] };
}

export function recordEditedFiles(state: CompactState, paths: readonly string[]): number {
  for (const path of paths) {
    const trimmed = path.trim();
    if (trimmed.length === 0 || state.editedFiles.includes(trimmed)) continue;
    state.editedFiles.push(trimmed);
  }
  if (state.editedFiles.length > EDITED_FILES_LIMIT) {
    state.editedFiles.splice(0, state.editedFiles.length - EDITED_FILES_LIMIT);
  }
  return state.editedFiles.length;
}

export function extractEditedPathFromToolEnd(event: unknown): string | undefined {
  const loose = asLoose(event);
  const toolName = asString(loose?.toolName);
  if (toolName !== 'edit' && toolName !== 'write') return undefined;
  const input = asLoose(loose?.input) ?? asLoose(loose?.args);
  return asString(input?.path) ?? asString(input?.file_path);
}

function toPathList(value: unknown): string[] {
  const source: unknown[] = value instanceof Set ? [...value] : asArray(value);
  const paths: string[] = [];
  for (const entry of source) {
    const path = asString(entry);
    if (path) paths.push(path);
  }
  return paths;
}

export function mergePreparationFileOps(state: CompactState, preparation: unknown): void {
  const fileOps = asLoose(asLoose(preparation)?.fileOps);
  if (!fileOps) return;
  recordEditedFiles(state, [...toPathList(fileOps.edited), ...toPathList(fileOps.written)]);
}
