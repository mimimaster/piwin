import { describe, expect, it } from 'vitest';
import { classifyShellCommand } from './shell-command-intent.js';

const intent = (command: string) => classifyShellCommand(command).intent;
const facet = (command: string) => classifyShellCommand(command).facet;

describe('classifyShellCommand — read-only exploration', () => {
  it('names the search tools behind the generic bash verb', () => {
    for (const command of [
      'grep -n "add-btn" src/',
      'rg -n "handleStartNewSession" --type ts',
      'fd -e ts session',
      'ag onNewSession',
    ]) {
      expect(intent(command), command).toBe('read-only');
      expect(facet(command), command).toBe('search');
    }
  });

  it('names the readers', () => {
    for (const command of ['cat package.json', 'ls -la src', 'head -30 README.md', 'wc -l *.ts']) {
      expect(intent(command), command).toBe('read-only');
      expect(facet(command), command).toBe('read');
    }
  });

  it('reads through a path-qualified binary', () => {
    expect(intent('/usr/bin/grep -rn foo .')).toBe('read-only');
    expect(facet('/usr/bin/grep -rn foo .')).toBe('search');
  });

  it('skips leading environment assignments', () => {
    expect(intent('LC_ALL=C grep -n foo bar.ts')).toBe('read-only');
  });

  it('unwraps pass-through wrappers', () => {
    expect(intent('time ls -la')).toBe('read-only');
    expect(intent('xargs grep -n foo')).toBe('read-only');
  });

  it('lets a pause stay inside a read-only chain', () => {
    expect(intent('sleep 2')).toBe('read-only');
    expect(intent('sleep 2 && grep -n foo src/a.ts')).toBe('read-only');
    expect(facet('sleep 2 && grep -n foo src/a.ts')).toBe('search');
    // A pause does not launder a mutation that follows it.
    expect(intent('sleep 2 && rm -rf dist')).toBe('mutate');
  });

  it('keeps a chain of readers foldable, and calls it a search if any segment searches', () => {
    expect(intent('cd apps/desktop && ls src | head -30')).toBe('read-only');
    expect(facet('cat a.ts && grep -n foo b.ts')).toBe('search');
    expect(facet('cat a.ts && head b.ts')).toBe('read');
  });
});

describe('classifyShellCommand — mutations', () => {
  it('flags the obvious side effects', () => {
    for (const command of ['rm -rf dist', 'mv a b', 'mkdir -p out', 'chmod +x run.sh']) {
      expect(intent(command), command).toBe('mutate');
    }
  });

  it('treats a write redirection anywhere on the line as a mutation', () => {
    expect(intent('cat a.ts > b.ts')).toBe('mutate');
    expect(intent('echo hi >> log.txt')).toBe('mutate');
    expect(intent('ls | tee out.txt')).toBe('mutate');
  });

  it('does not mistake a descriptor duplication for a file write', () => {
    expect(intent('pnpm vitest run 2>&1 | head -50')).toBe('verify');
    expect(intent('ls -la 2>&1')).toBe('read-only');
  });

  it('takes the least foldable segment of a chain', () => {
    expect(intent('cat a.ts && rm b.ts')).toBe('mutate');
    expect(intent('grep -n foo . ; git commit -m x')).toBe('mutate');
  });

  it('judges the inside of a command substitution', () => {
    expect(intent('echo $(rm -rf dist)')).toBe('mutate');
    expect(intent('echo $(git rev-parse HEAD)')).toBe('read-only');
  });

  it('does not split on an operator inside quotes', () => {
    expect(intent('grep -n "a || rm b" file.ts')).toBe('read-only');
    expect(intent("grep -n 'x > y' file.ts")).toBe('read-only');
  });

  it('catches the in-place editors', () => {
    expect(intent("sed -i '' s/a/b/ file.ts")).toBe('mutate');
    expect(intent("sed -n '1,20p' file.ts")).toBe('read-only');
  });

  it('catches find running arbitrary commands', () => {
    expect(intent('find . -name "*.tmp" -delete')).toBe('mutate');
    expect(intent('find . -name "*.tmp" -exec rm {} ;')).toBe('mutate');
    expect(intent('find src -name "*.ts"')).toBe('read-only');
  });

  it('treats elevation and the network as side effects', () => {
    expect(intent('sudo cat /etc/hosts')).toBe('mutate');
    expect(intent('curl https://example.com')).toBe('mutate');
  });
});

describe('classifyShellCommand — git and package managers', () => {
  it('splits git by subcommand', () => {
    expect(intent('git status --short')).toBe('read-only');
    expect(intent('git diff HEAD')).toBe('read-only');
    expect(facet('git grep -n foo')).toBe('search');
    expect(intent('git checkout main')).toBe('mutate');
    expect(intent('git push origin main')).toBe('mutate');
  });

  it('splits package managers by subcommand', () => {
    expect(intent('pnpm test')).toBe('verify');
    expect(intent('pnpm typecheck')).toBe('verify');
    expect(intent('npm run lint')).toBe('verify');
    expect(intent('pnpm install')).toBe('mutate');
    expect(intent('pnpm add -D vitest')).toBe('mutate');
  });

  it('will not vouch for an arbitrary run script', () => {
    expect(intent('pnpm run seed')).toBe('unknown');
  });

  it('classifies the standalone checkers', () => {
    expect(intent('tsc --noEmit')).toBe('verify');
    expect(intent('eslint src --max-warnings 0')).toBe('verify');
    expect(intent('cargo clippy')).toBe('verify');
    expect(intent('go test ./...')).toBe('verify');
  });
});

describe('classifyShellCommand — unknown stays unknown', () => {
  it('refuses to fold a command it cannot name', () => {
    expect(intent('./scripts/seed-fixtures.sh')).toBe('unknown');
    expect(intent('python3 tool.py')).toBe('unknown');
    expect(intent('make deploy')).toBe('unknown');
  });

  it('never lets an unknown segment hide inside a read-only chain', () => {
    expect(intent('cat a.ts && ./scripts/seed.sh')).toBe('unknown');
  });

  it('handles empty and whitespace input', () => {
    expect(intent('')).toBe('unknown');
    expect(intent('   ')).toBe('unknown');
    expect(classifyShellCommand(undefined).intent).toBe('unknown');
  });

  it('leaves no facet on anything that is not read-only', () => {
    expect(facet('rm -rf dist')).toBeUndefined();
    expect(facet('pnpm test')).toBeUndefined();
    expect(facet('./scripts/seed.sh')).toBeUndefined();
  });
});
