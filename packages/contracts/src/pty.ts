/** CE-PTY: interactive terminal sessions (host-owned). */

export type PtySessionSummary = {
  id: string;
  projectPath: string;
  cwd: string;
  createdAt: string;
  status: 'open' | 'closed' | 'error';
  errorMessage?: string;
};

export type PtyOpenInput = {
  projectPath: string;
  /** Absolute cwd; must resolve under trusted project. Default = projectPath. */
  cwd?: string;
  cols?: number;
  rows?: number;
  shell?: string;
};

export type PtyOutputChunk = {
  ptyId: string;
  data: string;
  at: string;
};
