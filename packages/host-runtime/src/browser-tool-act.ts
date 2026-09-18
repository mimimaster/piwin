/**
 * `browser_act`: intent → snapshot ref → action in one tool call. A local fast
 * decider picks the element; the main model only sees the outcome. When the
 * decider is unsure or unreachable the tool acts on nothing and hands the
 * ranked candidates back, so a wrong guess never becomes a wrong click.
 */
import type { HostToolRegistration } from '@piwin/contracts';
import type { BrowserSession } from '@piwin/browser';
import {
  collectActCandidates,
  FAST_DECIDER_MAX_CANDIDATES,
  type ActCandidate,
  type FastDecider,
} from './browser-fast-decider.js';
import { mapBrowserExecuteError, userControlResult } from './browser-tool-errors.js';
import { readBrowserPageState } from './browser-tool-page-state.js';
import {
  abortedPreparation,
  agentWriteOptions,
  createBrowserRegistration,
  invalidPreparation,
  permissionSpec,
  success,
  successWithPage,
} from './browser-tool-helpers.js';

type ActAction = 'click' | 'type' | 'fill';

const TEXT_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);
const FALLBACK_CANDIDATE_LIMIT = 8;

export function createBrowserActDefinition(
  session: BrowserSession,
  decider: FastDecider,
): HostToolRegistration {
  return createBrowserRegistration(
    {
      name: 'browser_act',
      description:
        'Act on the element that matches a plain-language intent (e.g. "the Sign in button", "the email field") without taking a snapshot first. A local model resolves the target; if it is not confident, nothing is clicked and ranked candidate refs are returned for browser_click/browser_type.',
      parameters: {
        type: 'object',
        properties: {
          intent: {
            type: 'string',
            description: 'Which element to act on, described by its visible label or purpose',
          },
          action: {
            type: 'string',
            enum: ['click', 'type', 'fill'],
            description: 'click (default); type appends text; fill replaces the field value',
          },
          text: { type: 'string', description: 'Text for type/fill' },
        },
        required: ['intent'],
      },
    },
    permissionSpec('browser:click'),
    async (args, signal, context) => {
      const intent = String(args.intent ?? '').trim();
      const action = readAction(args.action);
      const text = typeof args.text === 'string' ? args.text : '';

      const tree = await session.snapshot({ signal });
      const all = collectActCandidates(tree);
      const scoped = action === 'click' ? all : all.filter((c) => TEXT_ROLES.has(c.role));
      const candidates = scoped.slice(0, FAST_DECIDER_MAX_CANDIDATES);
      if (candidates.length === 0) {
        return handBack('no-candidates', intent, []);
      }
      if (candidates.length === 1) {
        return handBack('single-candidate', intent, candidates.map((c) => ranked(c, 1)));
      }

      let decision;
      try {
        decision = await decider.choose({
          context: buildDecisionContext(session, intent, action, candidates),
          question: `Which element should receive the ${action} for: ${intent}?`,
          choices: candidates.map((c) => c.label),
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw error;
        return handBack(
          'decider-unavailable',
          intent,
          candidates.slice(0, FALLBACK_CANDIDATE_LIMIT).map((c) => ranked(c)),
        );
      }

      const byLabel = new Map(candidates.map((c) => [c.label, c]));
      const topCandidates = decision.ranked.slice(0, FALLBACK_CANDIDATE_LIMIT).flatMap((r) => {
        const candidate = byLabel.get(r.choice);
        return candidate ? [ranked(candidate, r.probability)] : [];
      });
      const chosen = byLabel.get(decision.value);
      if (!chosen || decision.probability < decider.minConfidence) {
        return handBack('low-confidence', intent, topCandidates, decision.elapsedMs);
      }

      const options = agentWriteOptions(signal, context);
      try {
        if (action === 'click') await session.click(chosen.ref, options);
        else if (action === 'type') await session.type(chosen.ref, text, options);
        else await session.fillForm({ [chosen.ref]: text }, options);
      } catch (error) {
        return action === 'click' ? mapBrowserExecuteError(error, 'click') : userControlResult(error);
      }
      const details = {
        action,
        ref: chosen.ref,
        confidence: decision.probability,
        decisionMs: Math.round(decision.elapsedMs),
      };
      return successWithPage(
        session,
        { ok: true, status: 'acted', ...details, element: chosen.label, decidedBy: 'fast-decider' },
        details,
      );
    },
    (rawArguments, _context, signal) => {
      if (signal.aborted) return abortedPreparation();
      if (typeof rawArguments.intent !== 'string' || rawArguments.intent.trim() === '') {
        return invalidPreparation('browser_act requires an intent');
      }
      const action = rawArguments.action;
      if (action !== undefined && action !== 'click' && action !== 'type' && action !== 'fill') {
        return invalidPreparation('browser_act action must be click, type or fill');
      }
      if ((action === 'type' || action === 'fill') && typeof rawArguments.text !== 'string') {
        return invalidPreparation(`browser_act ${action} requires text`);
      }
      return { ok: true, arguments: rawArguments };
    },
  );
}

function readAction(value: unknown): ActAction {
  return value === 'type' || value === 'fill' ? value : 'click';
}

function buildDecisionContext(
  session: BrowserSession,
  intent: string,
  action: ActAction,
  candidates: readonly ActCandidate[],
): string {
  const page = readBrowserPageState(session);
  const header = page ? `Page: ${page.title ?? ''} (${page.url})\n` : '';
  return `${header}Goal: ${action} ${intent}\nInteractive elements:\n${candidates
    .map((c) => c.label)
    .join('\n')}`;
}

function ranked(candidate: ActCandidate, probability?: number) {
  return {
    ref: candidate.ref,
    element: candidate.label,
    ...(probability !== undefined ? { probability: Math.round(probability * 1000) / 1000 } : {}),
  };
}

function handBack(
  reason: 'no-candidates' | 'single-candidate' | 'decider-unavailable' | 'low-confidence',
  intent: string,
  candidates: ReadonlyArray<ReturnType<typeof ranked>>,
  decisionMs?: number,
) {
  return success(
    {
      ok: true,
      status: 'needs-decision',
      reason,
      intent,
      acted: false,
      candidates,
      notice:
        candidates.length > 0
          ? 'Nothing was clicked or typed. Pick a ref above and call browser_click/browser_type, or browser_snapshot for the full tree.'
          : 'No matching interactive element with a ref. Use browser_snapshot or browser_screenshot to inspect the page.',
    },
    { reason, candidateCount: candidates.length, ...(decisionMs !== undefined ? { decisionMs: Math.round(decisionMs) } : {}) },
  );
}
