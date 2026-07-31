import { homedir } from 'node:os';
import { join } from 'node:path';

export function getPiwinRoot(override?: string): string {
  if (override && override.trim().length > 0) {
    return override;
  }
  const fromEnv = process.env.PIWIN_ROOT;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  return join(homedir(), '.piwin');
}

export function getPiwinConfigPath(rootDir: string): string {
  return join(rootDir, 'config.json');
}

export function getPiwinMediaDir(rootDir: string): string {
  return join(rootDir, 'media');
}

/** Product-owned General session workspace (not a user project root). */
export function getPiwinGeneralWorkspacePath(rootDir: string): string {
  return join(rootDir, 'workspace');
}

export function getPiwinLogsDir(rootDir: string): string {
  return join(rootDir, 'logs');
}

export function getPiwinSessionsIndexDir(rootDir: string): string {
  return join(rootDir, 'sessions-index');
}

export function getPiwinProjectsPath(rootDir: string): string {
  return join(rootDir, 'projects.json');
}

export function getPiwinSessionIndexPath(rootDir: string): string {
  return join(rootDir, 'sessions-index', 'index.json');
}

export function getPiwinMcpConfigPath(rootDir: string): string {
  return join(rootDir, 'mcp.json');
}

export function getPiwinSkillsDir(rootDir: string): string {
  return join(rootDir, 'skills');
}

export function getPiwinExtensionsDir(rootDir: string): string {
  return join(rootDir, 'extensions');
}

export function getPiwinPromptsDir(rootDir: string): string {
  return join(rootDir, 'prompts');
}

export function getPiwinSessionsDir(rootDir: string): string {
  return join(rootDir, 'sessions');
}

export function getPiwinSessionDir(rootDir: string, sessionId: string): string {
  return join(getPiwinSessionsDir(rootDir), sessionId);
}

export function getPiwinSessionTranscriptPath(rootDir: string, sessionId: string): string {
  return join(getPiwinSessionDir(rootDir, sessionId), 'transcript.json');
}

export function getPiwinSessionPlanPath(rootDir: string, sessionId: string): string {
  return join(getPiwinSessionDir(rootDir, sessionId), 'plan.json');
}

/** CE-OBS: append-only usage ledger (JSONL) under the product root. */
export function getPiwinUsageLedgerPath(rootDir: string): string {
  return join(rootDir, 'usage', 'ledger.jsonl');
}
