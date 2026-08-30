import { spawn } from 'node:child_process';

/** Best-effort system browser open for OAuth. Never shells the URL. */
export function openLocalAuthUrl(url: string): void {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return;
  }
  const [cmd, args] =
    process.platform === 'darwin'
      ? (['open', [trimmed]] as const)
      : process.platform === 'win32'
        ? (['rundll32', ['url.dll,FileProtocolHandler', trimmed]] as const)
        : (['xdg-open', [trimmed]] as const);
  spawn(cmd, args, { stdio: 'ignore', detached: true })
    .on('error', () => undefined)
    .unref();
}
