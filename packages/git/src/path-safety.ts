/**
 * Ensure mutation paths stay relative and do not escape the repo root.
 */
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';

export function assertSafeRepoRelativePaths(repoRoot: string, paths: string[]): string[] {
  const root = resolve(repoRoot);
  const safe: string[] = [];
  for (const raw of paths) {
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.includes('\0')) {
      throw new Error('path contains null byte');
    }
    if (isAbsolute(trimmed)) {
      throw new Error(`absolute paths not allowed: ${trimmed}`);
    }
    const normalized = normalize(trimmed);
    if (normalized.startsWith('..' + sep) || normalized === '..') {
      throw new Error(`path escapes repository: ${trimmed}`);
    }
    const absolute = resolve(root, normalized);
    const rel = relative(root, absolute);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`path escapes repository: ${trimmed}`);
    }
    if (normalized !== '.') {
      safe.push(normalized.replace(/\\/g, '/'));
    }
  }
  return [...new Set(safe)];
}

export function assertSafeBranchName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('branch name is empty');
  }
  if (trimmed.length > 120) {
    throw new Error('branch name too long');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(trimmed)) {
    throw new Error('branch name has invalid characters');
  }
  if (trimmed.includes('..') || trimmed.endsWith('.lock') || trimmed.startsWith('-')) {
    throw new Error('branch name is not allowed');
  }
  return trimmed;
}

export function assertSafeRef(ref: string): string {
  const trimmed = ref.trim();
  if (!trimmed) {
    throw new Error('ref is empty');
  }
  if (trimmed.length > 200) {
    throw new Error('ref too long');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(trimmed)) {
    throw new Error('ref has invalid characters');
  }
  if (trimmed.includes('..')) {
    throw new Error('ref is not allowed');
  }
  return trimmed;
}

export function assertSafeCommitMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error('commit message is empty');
  }
  if (trimmed.length > 4000) {
    throw new Error('commit message too long');
  }
  return trimmed;
}
