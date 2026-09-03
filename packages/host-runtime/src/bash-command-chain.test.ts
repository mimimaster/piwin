import { describe, expect, it } from 'vitest';
import { splitBashCommandChain } from './bash-command-chain.js';

describe('splitBashCommandChain', () => {
  it('splits && and ; outside quotes', () => {
    expect(splitBashCommandChain('cd /tmp && ls foo/')).toEqual(['cd /tmp', 'ls foo/']);
    expect(splitBashCommandChain('pwd; ls')).toEqual(['pwd', 'ls']);
  });

  it('does not split quoted && or pipelines', () => {
    expect(splitBashCommandChain('echo "a && b"')).toEqual(['echo "a && b"']);
    expect(splitBashCommandChain('ls | grep foo')).toEqual(['ls | grep foo']);
  });
});
