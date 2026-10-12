import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

export type GitBranchReader = (cwd: string) => Promise<string | undefined>;

/** The checked-out branch (also before the first commit), short commit when detached; undefined outside a repo. */
export const readGitBranch: GitBranchReader = (cwd) =>
  new Promise((resolve) => {
    if (!existsSync(cwd)) {
      resolve(undefined);
      return;
    }
    const options = { cwd, timeout: 2000, windowsHide: true };
    execFile('git', ['symbolic-ref', '--short', '-q', 'HEAD'], options, (error, stdout) => {
      const branch = error ? '' : stdout.trim();
      if (branch.length > 0) {
        resolve(branch);
        return;
      }
      execFile('git', ['rev-parse', '--short', 'HEAD'], options, (shortError, short) => {
        resolve(shortError || short.trim().length === 0 ? undefined : `@${short.trim()}`);
      });
    });
  });

/**
 * The status line's branch for the session's project root. The CLI reads it
 * locally, so a remote Host's path that does not exist here shows nothing.
 */
export class TuiGitBranch {
  private cwd: string | undefined;
  private branch: string | undefined;
  private epoch = 0;

  public constructor(
    private readonly onChanged: () => void,
    private readonly read: GitBranchReader = readGitBranch,
  ) {}

  public current(): string | undefined {
    return this.branch;
  }

  /** Re-reads for `cwd` (a session opened, a turn ended). */
  public async refresh(cwd: string | undefined): Promise<void> {
    const epoch = (this.epoch += 1);
    if (cwd !== this.cwd) {
      this.cwd = cwd;
      if (this.branch !== undefined) {
        this.branch = undefined;
        this.onChanged();
      }
    }
    if (cwd === undefined) return;
    const branch = await this.read(cwd);
    if (epoch !== this.epoch || branch === this.branch) return;
    this.branch = branch;
    this.onChanged();
  }
}
