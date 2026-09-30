import type { ResolvedOrchestrationScheme } from './orchestration-scheme-resolved.js';

/** Format roster block for model-facing injection. */
export function formatOrchestrationSchemeRoster(resolved: ResolvedOrchestrationScheme): string {
  const lines = resolved.members.map((member) => {
    const bits: string[] = [];
    if (resolved.exposeSpawnMetadata && member.model) {
      bits.push(`model: ${member.model.providerId}/${member.model.modelId}`);
    } else if (member.model) {
      bits.push('model: profile-resolved');
    } else {
      bits.push('model: inherit');
    }
    if (member.isolation) bits.push(member.isolation);
    if (member.thinkingLevel) bits.push(`thinking≤${member.thinkingLevel}`);
    else if (resolved.maxSubagentThinkingLevel) {
      bits.push(`thinking≤${resolved.maxSubagentThinkingLevel}`);
    }
    if (!member.available) {
      bits.push(`UNAVAILABLE: ${member.unavailableReason ?? 'unknown'}`);
    }
    return `- ${member.role}: ${member.description} (${bits.join('; ')})`;
  });
  return [
    '[piwin-scheme-roster]',
    ...lines,
    'When delegating, call piwin_subagent_run, piwin_subagent_start, piwin_subagent_wait, or piwin_subagent_cancel with role set to one of the roster roles.',
  ].join('\n');
}

/** Format model-facing scheme preamble block (preparePrompt injects this). */
export function formatOrchestrationSchemePreamble(resolved: ResolvedOrchestrationScheme): string {
  return `[piwin-scheme:${resolved.schemeId}]\n${resolved.systemPreamble}\n\n${formatOrchestrationSchemeRoster(resolved)}`;
}

/**
 * One-line marker used once the full preamble already sits in model history.
 * The full block stays authoritative; this only tells the model it is still on.
 */
export function formatOrchestrationSchemeReminder(resolved: ResolvedOrchestrationScheme): string {
  return `[piwin-scheme:${resolved.schemeId} active] The orchestration discipline and roster given earlier in this conversation still apply.`;
}

/**
 * Identity of what a full injection delivered. Equal keys mean the model
 * already saw this exact preamble + roster, so the next send may use the
 * reminder instead. Any change to discipline, members, or models differs.
 */
export function orchestrationSchemeInjectionKey(resolved: ResolvedOrchestrationScheme): string {
  return formatOrchestrationSchemePreamble(resolved);
}

export type OrchestrationSchemeInjectionForm = 'full' | 'reminder';

/**
 * Full block the first time a session sees this exact scheme content (or
 * after compaction dropped it); reminder when the delivered key still matches.
 */
export function chooseOrchestrationSchemeInjectionForm(
  resolved: ResolvedOrchestrationScheme,
  deliveredKey: string | undefined,
): OrchestrationSchemeInjectionForm {
  return deliveredKey === orchestrationSchemeInjectionKey(resolved) ? 'reminder' : 'full';
}

/** Inject scheme preamble + roster (or the reminder) ahead of model-facing user text. */
export function mergeOrchestrationSchemeIntoPrompt(
  resolved: ResolvedOrchestrationScheme,
  userFacingText: string,
  form: OrchestrationSchemeInjectionForm = 'full',
): string {
  const block =
    form === 'reminder'
      ? formatOrchestrationSchemeReminder(resolved)
      : formatOrchestrationSchemePreamble(resolved);
  const body = userFacingText.trim();
  if (!body) return `${block}\n\n---\n`;
  return `${block}\n\n---\n${body}`;
}
