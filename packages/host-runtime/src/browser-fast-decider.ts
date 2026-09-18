/**
 * Client for a local "System One" decision engine (RLCD `/api/run-parallel`):
 * one parallel forward pass that picks an enum value with a calibrated
 * probability. Used by `browser_act` to map an intent to a snapshot ref
 * without spending a main-model turn on `browser_snapshot`.
 */
import type { BrowserFastDeciderConfig, BrowserSnapshotNode } from '@piwin/contracts';

export const FAST_DECIDER_DEFAULT_MIN_CONFIDENCE = 0.7;
export const FAST_DECIDER_DEFAULT_TIMEOUT_MS = 3000;
/** RLCD enum fields cap out at 255 values. */
export const FAST_DECIDER_MAX_CANDIDATES = 255;

export type FastDeciderRanked = { choice: string; probability: number };

export type FastDeciderChoice = {
  value: string;
  probability: number;
  ranked: FastDeciderRanked[];
  elapsedMs: number;
};

export type FastDecider = {
  minConfidence: number;
  choose(input: {
    context: string;
    question: string;
    choices: readonly string[];
    signal: AbortSignal;
  }): Promise<FastDeciderChoice>;
};

export type ActCandidate = { ref: string; role: string; name: string; label: string };

const ACTIONABLE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'slider',
  'spinbutton',
  'treeitem',
]);

/** Named, ref-bearing interactive nodes, in document order. */
export function collectActCandidates(nodes: readonly BrowserSnapshotNode[]): ActCandidate[] {
  const out: ActCandidate[] = [];
  const visit = (node: BrowserSnapshotNode): void => {
    const name = typeof node.name === 'string' ? node.name.trim().replace(/\s+/g, ' ') : '';
    if (
      typeof node.ref === 'string' &&
      node.ref.length > 0 &&
      name.length > 0 &&
      ACTIONABLE_ROLES.has(node.role)
    ) {
      const state = node.checked === true ? ' (checked)' : '';
      out.push({
        ref: node.ref,
        role: node.role,
        name,
        label: `${node.ref}: ${node.role} "${name.slice(0, 80)}"${state}`,
      });
    }
    for (const child of node.children) visit(child);
  };
  for (const node of nodes) visit(node);
  return out;
}

export function createFastDecider(config: BrowserFastDeciderConfig): FastDecider {
  const endpoint = `${config.url}/api/run-parallel`;
  const timeoutMs = config.timeoutMs ?? FAST_DECIDER_DEFAULT_TIMEOUT_MS;
  return {
    minConfidence: config.minConfidence ?? FAST_DECIDER_DEFAULT_MIN_CONFIDENCE,
    async choose({ context, question, choices, signal }) {
      const started = Date.now();
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          context,
          schema: { choice: { type: 'enum', choices, description: question } },
          temperature: 1.0,
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      });
      if (!response.ok) {
        throw new Error(`fast decider HTTP ${response.status}`);
      }
      return parseRunParallel(await response.json(), Date.now() - started);
    },
  };
}

export function parseRunParallel(body: unknown, fallbackElapsedMs: number): FastDeciderChoice {
  const record = asRecord(body);
  const field = asRecord(asRecord(record.parsed_json).choice);
  const value = field.value;
  const probability = field.prob;
  if (typeof value !== 'string' || typeof probability !== 'number') {
    throw new Error('fast decider returned no enum choice');
  }
  const top = asRecord(asRecord(record.field_telemetry).choice).top_choices;
  const ranked = Array.isArray(top)
    ? top.flatMap((entry): FastDeciderRanked[] => {
        const item = asRecord(entry);
        return typeof item.choice === 'string' && typeof item.probability === 'number'
          ? [{ choice: item.choice, probability: item.probability }]
          : [];
      })
    : [{ choice: value, probability }];
  const elapsedMs = typeof record.elapsed_ms === 'number' ? record.elapsed_ms : fallbackElapsedMs;
  return { value, probability, ranked, elapsedMs };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
