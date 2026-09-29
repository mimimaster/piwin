import { describe, expect, it } from 'vitest';
import { pickWindowsChildSystemEnv } from './child-process-env.js';

describe('pickWindowsChildSystemEnv', () => {
  const source = {
    SystemRoot: 'C:\\Windows',
    TEMP: 'C:\\Temp',
    PATHEXT: '.COM;.EXE',
    OPENAI_API_KEY: 'must-not-leak',
    UNSET: undefined,
  };

  it('keeps only the Windows system keys on win32', () => {
    expect(pickWindowsChildSystemEnv('win32', source)).toEqual({
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      PATHEXT: '.COM;.EXE',
    });
  });

  it('adds nothing on POSIX platforms', () => {
    expect(pickWindowsChildSystemEnv('linux', source)).toEqual({});
    expect(pickWindowsChildSystemEnv('darwin', source)).toEqual({});
  });
});
