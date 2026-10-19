import { pickStatusTier, type StatusTier } from '@piwin/contracts';

export const STATUS_FIELDS = [
  'agent',
  'session',
  'project',
  'branch',
  'model',
  'thinking',
  'permission',
  'scheme',
  'skill',
  'activity',
  'elapsed',
  'ttft',
  'tps',
  'context',
  'ctx',
  'ctxbar',
  'turns',
  'tokens',
  'cache',
  'cost',
  'mock',
] as const;
export type StatusField = (typeof STATUS_FIELDS)[number];
export type StatusValues = Partial<Record<StatusField, string | undefined>>;
export type StatusTemplates = Record<StatusTier, string>;

/** Who/where │ this turn │ resources. Wider terminals get more of each. */
export const DEFAULT_STATUS_TEMPLATES: StatusTemplates = {
  wide: '{agent} · {session} · {project} · {branch} · {model} · {thinking} · {permission} · {scheme} · {skill} │ {elapsed} · {ttft} · {tps} · {activity} │ {ctxbar} · {turns} · {tokens} · {cache} · {cost} · {mock}',
  medium: '{agent} · {session} · {project} · {model} · {thinking} · {permission} · {scheme} │ {activity} · {ttft} · {tps} │ {ctx} · {cost} · {mock}',
  narrow: '{agent} · {model} · {permission} · {context} · {mock}',
};
export const DEFAULT_STATUS_TEMPLATE = DEFAULT_STATUS_TEMPLATES.wide;

/**
 * When a tier's line is still too wide, fields go in this order. Context and
 * permission are never dropped.
 */
export const STATUS_DROP_ORDER: readonly StatusField[] = [
  'turns', 'cost', 'cache', 'tokens', 'tps', 'ttft', 'skill', 'branch', 'thinking', 'project', 'session', 'scheme', 'elapsed', 'activity', 'agent', 'mock',
];

export const STATUS_PIECE_SEPARATOR = ' · ';
export const STATUS_GROUP_SEPARATOR = ' │ ';
const PLACEHOLDER = /\{([a-zA-Z]+)\}/g;

export type StatusSeparators = { piece: string; group: string };

/** Unknown `{names}` in a template, so a typo is reported instead of printed. */
export function unknownStatusFields(template: string): string[] {
  const known: readonly string[] = STATUS_FIELDS;
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '').filter((name) => !known.includes(name));
}

/**
 * Fills a template such as `{model} · {context} │ {ttft}`. A ` · `-separated
 * piece whose fields are all empty disappears with its separator, and a
 * ` │ ` group left empty disappears with its divider.
 */
export function renderStatusTemplate(
  template: string,
  values: StatusValues,
  separators: StatusSeparators = { piece: STATUS_PIECE_SEPARATOR, group: STATUS_GROUP_SEPARATOR },
): string {
  const known: readonly string[] = STATUS_FIELDS;
  return template
    .split(STATUS_GROUP_SEPARATOR)
    .map((group) =>
      group
        .split(STATUS_PIECE_SEPARATOR)
        .map((piece) => {
          const names = [...piece.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '');
          if (names.length > 0 && names.every((name) => known.includes(name) && !values[name as StatusField])) return undefined;
          return piece.replace(PLACEHOLDER, (whole, name: string) => (known.includes(name) ? (values[name as StatusField] ?? '') : whole));
        })
        .filter((piece): piece is string => piece !== undefined && piece.trim().length > 0)
        .join(separators.piece),
    )
    .filter((group) => group.trim().length > 0)
    .join(separators.group);
}

/**
 * The tier's template for this width, then drops fields in
 * {@link STATUS_DROP_ORDER} until the line fits.
 */
export function renderStatusLine(input: {
  templates: StatusTemplates;
  values: StatusValues;
  width: number;
  measure: (text: string) => number;
  separators?: StatusSeparators;
}): string {
  const template = input.templates[pickStatusTier(input.width)];
  const values: StatusValues = { ...input.values };
  let line = renderStatusTemplate(template, values, input.separators);
  for (const field of STATUS_DROP_ORDER) {
    if (input.measure(line) <= input.width) break;
    if (!values[field]) continue;
    values[field] = undefined;
    line = renderStatusTemplate(template, values, input.separators);
  }
  return line;
}
