import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type ExternalEditResult =
  | { kind: 'edited'; text: string }
  | { kind: 'unchanged' }
  /** The editor did not finish normally; the composer keeps what it had. */
  | { kind: 'failed'; reason: string };

export type ExternalEditorRun = (command: string, args: string[]) => { status: number | null; error?: Error };

const runInTerminal: ExternalEditorRun = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  return { status: result.status, ...(result.error === undefined ? {} : { error: result.error }) };
};

/**
 * Edit a long prompt in `$VISUAL` / `$EDITOR` (`vi` when neither is set). The
 * caller has already handed the terminal over; this blocks until the editor
 * exits. A non-zero exit means the person abandoned the edit, so nothing is
 * taken from the file.
 */
export function editTextExternally(
  text: string,
  options: { env?: NodeJS.ProcessEnv; run?: ExternalEditorRun } = {},
): ExternalEditResult {
  const env = options.env ?? process.env;
  const run = options.run ?? runInTerminal;
  const [command, ...editorArgs] = (env.VISUAL ?? env.EDITOR ?? 'vi').trim().split(/\s+/).filter(Boolean);
  if (command === undefined) return { kind: 'failed', reason: '没有设置编辑器（$VISUAL / $EDITOR）' };
  const directory = mkdtempSync(path.join(tmpdir(), 'piwin-prompt-'));
  const file = path.join(directory, 'prompt.md');
  try {
    writeFileSync(file, text, { mode: 0o600 });
    const outcome = run(command, [...editorArgs, file]);
    if (outcome.error !== undefined) return { kind: 'failed', reason: `打不开编辑器 ${command}：${outcome.error.message}` };
    if (outcome.status !== 0) return { kind: 'failed', reason: `编辑器 ${command} 以状态 ${outcome.status ?? '未知'} 退出，输入框保持原样` };
    // Editors end the file with a newline the person did not type.
    const edited = readFileSync(file, 'utf8').replace(/\r?\n$/, '');
    return edited === text ? { kind: 'unchanged' } : { kind: 'edited', text: edited };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
