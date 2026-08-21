import type { HostCommand, PermissionRule, PermissionRulesFile } from '@piwin/contracts';

const MAX_RULES_PER_BUCKET = 256;
const MAX_REASON_CHARS = 512;
const MAX_PATTERN_CHARS = 512;

export function isSafeRemotePermissionRulesCommand(
  command: Extract<HostCommand, { type: 'permissions/get-rules' | 'permissions/set-rules' }>,
): boolean {
  if (command.layer !== 'user') {
    return false;
  }
  if (command.type === 'permissions/get-rules') {
    return true;
  }
  if (
    command.expectedRevision !== undefined &&
    (command.expectedRevision.length === 0 || command.expectedRevision.length > 256)
  ) {
    return false;
  }
  return isSafeRemotePermissionRulesFile(command.rules);
}

export function isSafeRemotePermissionRulesFile(rules: PermissionRulesFile): boolean {
  if (rules.version !== 1) {
    return false;
  }
  return (
    isSafeRemoteRuleBucket(rules.deny, 'deny') &&
    isSafeRemoteRuleBucket(rules.ask, 'ask') &&
    isSafeRemoteRuleBucket(rules.allow, 'allow')
  );
}

function isSafeRemoteRuleBucket(
  rules: PermissionRule[] | undefined,
  decision: PermissionRule['decision'],
): boolean {
  if (rules === undefined) {
    return true;
  }
  if (rules.length > MAX_RULES_PER_BUCKET) {
    return false;
  }
  return rules.every((rule) => isSafeRemotePermissionRule(rule, decision));
}

function isSafeRemotePermissionRule(
  rule: PermissionRule,
  bucket: PermissionRule['decision'],
): boolean {
  if (rule.decision !== bucket || rule.reason.length === 0 || rule.reason.length > MAX_REASON_CHARS) {
    return false;
  }
  const target = rule.target;
  switch (target.kind) {
    case 'bash':
    case 'git':
      return target.pattern.length > 0 && target.pattern.length <= MAX_PATTERN_CHARS;
    case 'file-write':
      return target.pathGlob.length > 0 && target.pathGlob.length <= MAX_PATTERN_CHARS;
    case 'web-fetch':
      return target.hostGlob.length > 0 && target.hostGlob.length <= MAX_PATTERN_CHARS;
    case 'web-search':
    case 'process':
    case 'notes-mutate':
      return true;
    default:
      return false;
  }
}
