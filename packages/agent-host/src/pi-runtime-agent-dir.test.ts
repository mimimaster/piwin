import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PIWIN_PI_AGENT_DIR_ENV,
  resolvePiRuntimeAgentDir,
} from './pi-runtime-agent-dir.js';

const originalPiAgentDir = process.env[PIWIN_PI_AGENT_DIR_ENV];
const originalPiwinRoot = process.env.PIWIN_ROOT;

afterEach(() => {
  if (originalPiAgentDir === undefined) {
    delete process.env[PIWIN_PI_AGENT_DIR_ENV];
  } else {
    process.env[PIWIN_PI_AGENT_DIR_ENV] = originalPiAgentDir;
  }
  if (originalPiwinRoot === undefined) {
    delete process.env.PIWIN_ROOT;
  } else {
    process.env.PIWIN_ROOT = originalPiwinRoot;
  }
});

describe('resolvePiRuntimeAgentDir', () => {
  it('prefers an explicit override', () => {
    process.env[PIWIN_PI_AGENT_DIR_ENV] = '/env/pi-agent';
    process.env.PIWIN_ROOT = '/env/piwin';
    expect(resolvePiRuntimeAgentDir('/tmp/explicit')).toBe('/tmp/explicit');
  });

  it('follows PIWIN_PI_AGENT_DIR then PIWIN_ROOT', () => {
    delete process.env[PIWIN_PI_AGENT_DIR_ENV];
    process.env.PIWIN_ROOT = '/tmp/piwin-test';
    expect(resolvePiRuntimeAgentDir()).toBe('/tmp/piwin-test/pi-agent');
    process.env[PIWIN_PI_AGENT_DIR_ENV] = '/tmp/injected-agent';
    expect(resolvePiRuntimeAgentDir()).toBe('/tmp/injected-agent');
  });

  it('defaults to ~/.piwin/pi-agent', () => {
    delete process.env[PIWIN_PI_AGENT_DIR_ENV];
    delete process.env.PIWIN_ROOT;
    expect(resolvePiRuntimeAgentDir()).toBe(join(homedir(), '.piwin', 'pi-agent'));
  });
});
