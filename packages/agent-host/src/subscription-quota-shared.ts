/**
 * Shared parsing helpers for subscription quota.
 * Vendor payloads disagree on number-vs-string, unix-vs-iso, and wrapping.
 */

import type { QuotaColorTone } from '@piwin/contracts';

export type StoredOAuthMaterial = {
  providerId: string;
  accessToken: string;
  refreshToken?: string;
  accountId?: string;
  email?: string;
  expiresAtMs?: number;
};

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function clampPercent(value: number): number {
  const bounded = Math.min(100, Math.max(0, value));
  return Math.round(bounded * 10) / 10;
}

export function titleCasePlan(raw: string | undefined, fallback: string): string {
  const value = raw?.trim();
  if (!value) {
    return fallback;
  }
  if (value === value.toUpperCase() && value.includes('_')) {
    return value
      .toLowerCase()
      .split('_')
      .filter((part) => part.length > 0 && part !== 'level' && part !== 'subscription' && part !== 'tier')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatFriendlyTimeAgoOrUntil(dateInput: string | number | Date, nowMs = Date.now()): string {
  const targetDate =
    typeof dateInput === 'number'
      ? dateInput < 10_000_000_000
        ? new Date(dateInput * 1000)
        : new Date(dateInput)
      : new Date(dateInput);

  if (Number.isNaN(targetDate.getTime())) {
    return String(dateInput);
  }

  const diffMs = targetDate.getTime() - nowMs;
  const absDiff = Math.abs(diffMs);
  const diffMinutes = Math.round(absDiff / 60_000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getDate()).padStart(2, '0');
  const hh = String(targetDate.getHours()).padStart(2, '0');
  const min = String(targetDate.getMinutes()).padStart(2, '0');
  const datePrefix = `${mm}/${dd} ${hh}:${min}`;

  if (diffMs > 0) {
    if (diffMinutes < 60) {
      return `${datePrefix} · ${diffMinutes}分钟后`;
    }
    if (diffHours < 24) {
      const remainingMin = diffMinutes % 60;
      return `${datePrefix} · ${diffHours}小时${remainingMin > 0 ? ` ${remainingMin}分` : ''}后`;
    }
    const remainingHours = diffHours % 24;
    return `${datePrefix} · ${diffDays}天${remainingHours > 0 ? ` ${remainingHours}小时` : ''}后`;
  }
  if (diffMinutes < 60) {
    return `${datePrefix} · ${Math.max(1, diffMinutes)}分钟前`;
  }
  if (diffHours < 24) {
    return `${datePrefix} · ${diffHours}小时前`;
  }
  return `${datePrefix} · ${diffDays}天前`;
}

export function deriveColorTone(type: 'used' | 'remaining', percentage: number | undefined): QuotaColorTone {
  if (percentage === undefined || Number.isNaN(percentage)) {
    return 'neutral';
  }
  const used = type === 'used' ? percentage : 100 - percentage;
  if (used >= 85) return 'coral';
  if (used >= 60) return 'amber';
  return 'mint';
}

export function labelForWindowSeconds(seconds: number | undefined, fallback: string): string {
  if (seconds === undefined || seconds <= 0) {
    return fallback;
  }
  if (seconds >= 2 * 86_400) {
    return '周限额';
  }
  const hours = Math.max(1, Math.round(seconds / 3600));
  return `${hours} 小时限额`;
}

export function extractEmailFromJwt(token: string): string | undefined {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) return undefined;
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(json) as Record<string, unknown>;
    if (typeof payload.email === 'string' && payload.email.includes('@')) {
      return payload.email;
    }
    const openaiAuth = asRecord(payload['https://api.openai.com/auth']);
    if (openaiAuth && typeof openaiAuth.email === 'string') {
      return openaiAuth.email;
    }
  } catch {
    // Ignore malformed JWT
  }
  return undefined;
}

export function parseTokenCandidate(record: Record<string, unknown>): string | undefined {
  const candidates = [record.access, record.accessToken, record.access_token, record.token, record.apiKey, record.key];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return undefined;
}
