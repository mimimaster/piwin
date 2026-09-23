import { resolveWindowsShellKind } from './windows-bash-shell.js';

/**
 * The bash tool is named `bash` on every platform, but on Windows it runs
 * PowerShell whenever Git Bash is absent or was declined. Saying so is the
 * difference between a working command and a `&&` syntax error.
 */
const WINDOWS_POWERSHELL_SHELL_NOTE = [
  '<shell>',
  'The bash tool on this Windows machine runs Windows PowerShell 5.1, not bash.',
  'Do not use &&, ||, export, or POSIX flags. Use ; between commands and $env:NAME = "value" for environment variables.',
  'curl, wget, ls, and cat are not their POSIX programs.',
  '</shell>',
].join('\n');

/**
 * Note for the shell the bash tool actually resolves to, so the model is never
 * handed bash syntax while PowerShell runs it. Reads the same detection as the
 * invocation, so the note cannot describe a different shell than the one that
 * runs. Silent on Unix and on a Windows host whose bash tool is Git Bash.
 */
export function windowsShellPrompt(): string | undefined {
  if (process.platform !== 'win32') return undefined;
  if (resolveWindowsShellKind() !== 'powershell') return undefined;
  return WINDOWS_POWERSHELL_SHELL_NOTE;
}
