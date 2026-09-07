/**
 * Classify a `browser_navigate` URL for permission gating (ADR 0020 §5).
 *
 * Unlike `evaluateWebPermission` (which hard-denies private/local), navigate
 * allows **loopback** by default and sends everything else — including
 * link-local / cloud metadata and private ranges — through the rule engine
 * with default `ask`. Public hosts also default to `ask`. Only http/https
 * schemes are accepted.
 *
 * Pure function — no IO.
 */
import type { PermissionMode, PermissionRuleSet } from '@piwin/contracts';
import { isPrivateOrLocalHostname, mappedIpv4FromIpv6 } from '@piwin/tools-web';
import { findMatchingRule } from './permission-rule-engine.js';
import { applyModeToMatchedRule, type PermissionEvaluation } from './permission-policy.js';

/**
 * Loopback hosts allowed by default for `browser_navigate` (dev-preview).
 * Everything else that `isPrivateOrLocalHostname` flags is "private → ask".
 */
function isLoopbackHost(host: string): boolean {
  const value = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!value) return true;
  if (value === 'localhost' || value.endsWith('.localhost')) return true;
  // IPv4 loopback 127.0.0.0/8
  if (/^127\.\d{1,3}(\.\d{1,3}){2}$/.test(value)) return true;
  // IPv6 loopback
  if (value === '::1' || value === '0:0:0:0:0:0:0:1') return true;
  // IPv4-mapped IPv6 loopback (dotted or hex, e.g. ::ffff:127.0.0.1 / ::ffff:7f00:1)
  const mappedV4 = mappedIpv4FromIpv6(value);
  if (mappedV4) {
    return /^127\./.test(mappedV4);
  }
  return false;
}

export function evaluateBrowserNavigatePermission(
  url: string,
  rules?: PermissionRuleSet,
  mode: PermissionMode = 'auto',
): PermissionEvaluation {
  const normalized = url.trim();
  if (!normalized) {
    return { decision: 'deny', reason: 'empty-url' };
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return { decision: 'deny', reason: 'invalid-url' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { decision: 'deny', reason: 'blocked-scheme' };
  }

  const host = parsed.hostname.toLowerCase();

  // Consult the rule engine first (deny → ask → allow) using the web-fetch
  // subject kind so existing host-allow rules for dev servers carry over.
  if (rules) {
    const matched = findMatchingRule({ kind: 'web-fetch', host }, rules);
    if (matched) {
      return applyModeToMatchedRule(matched, mode);
    }
  }

  // Loopback is allowed by default (dev-preview convenience).
  if (isLoopbackHost(host)) {
    return { decision: 'allow', reason: 'loopback-allowed' };
  }

  // Private / link-local / metadata → ask (never blanket-allow).
  if (isPrivateOrLocalHostname(host)) {
    return { decision: 'ask', reason: `private-or-local:${host}` };
  }

  // Public hosts ask by default, unless the current invocation mode bypasses
  // prompts. Explicit rules and private-host safeguards still win above.
  return {
    decision: mode === 'bypass' ? 'allow' : 'ask',
    reason: mode === 'bypass' ? `bypass-navigate:${host}` : `navigate:${host}`,
  };
}
