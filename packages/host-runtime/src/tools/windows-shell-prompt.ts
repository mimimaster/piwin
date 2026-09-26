import { resolveWindowsShellKind } from './windows-bash-shell.js';

/**
 * The bash tool is named `bash` on every platform, but on Windows it runs
 * PowerShell whenever no verified Git Bash is available. Saying so is the
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
 * handed bash syntax while PowerShell runs it. Reads the same Host discovery
 * as execution. Silent on Unix and when the Windows Host has Git Bash.
 */
export function windowsShellPrompt(piwinRoot?: string): string | undefined {
  if (process.platform !== 'win32') return undefined;
  if (resolveWindowsShellKind(piwinRoot) !== 'powershell') return undefined;
  return WINDOWS_POWERSHELL_SHELL_NOTE;
}
