/**
 * Options shared by every git CLI call.
 * `windowsHide` keeps a console git from flashing a window.
 * CREATE_NO_WINDOW needs `windowsVerbatimArguments`, which splits argv on
 * spaces, so direct git calls do not set it.
 */
export function gitExecOptions(options: {
  cwd: string;
  timeout: number;
  maxBuffer: number;
  env?: Readonly<Record<string, string | undefined>>;
}): {
  cwd: string;
  timeout: number;
  maxBuffer: number;
  env: NodeJS.ProcessEnv;
  windowsHide: true;
} {
  return {
    cwd: options.cwd,
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
    windowsHide: true,
    env: {
      ...process.env,
      ...options.env,
      GIT_TERMINAL_PROMPT: '0',
      // Fail instead of waiting on an SSH fingerprint or password prompt.
      GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new',
      GCM_INTERACTIVE: 'never',
      // Stable machine-readable output: git error text is classified by
      // matching English prefixes, so a localized git would silently stop
      // classifying. Set after `options.env` so a caller cannot drop it.
      LANG: 'C',
    },
  };
}
