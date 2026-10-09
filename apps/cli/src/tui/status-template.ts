export const STATUS_FIELDS = [
  'session',
  'project',
  'model',
  'thinking',
  'permission',
  'skill',
  'activity',
  'context',
  'mock',
] as const;
export type StatusField = (typeof STATUS_FIELDS)[number];

export const DEFAULT_STATUS_TEMPLATE = '{session} · {project} · {model} · {thinking} · {permission} · {skill} · {activity} · {context} · {mock}';

const SEPARATOR = ' · ';
const PLACEHOLDER = /\{([a-zA-Z]+)\}/g;

/** Unknown `{names}` in a template, so a typo is reported instead of printed. */
export function unknownStatusFields(template: string): string[] {
  const known: readonly string[] = STATUS_FIELDS;
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '').filter((name) => !known.includes(name));
}

/**
 * Fills a template such as `{model} · {context}`. A ` · `-separated piece
 * whose fields are all empty disappears with its separator, so an unset
 * thinking level leaves no gap.
 */
export function renderStatusTemplate(template: string, values: Partial<Record<StatusField, string | undefined>>): string {
  const known: readonly string[] = STATUS_FIELDS;
  return template
    .split(SEPARATOR)
    .map((piece) => {
      const names = [...piece.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '');
      if (names.length > 0 && names.every((name) => known.includes(name) && !values[name as StatusField])) return undefined;
      return piece.replace(PLACEHOLDER, (whole, name: string) => (known.includes(name) ? (values[name as StatusField] ?? '') : whole));
    })
    .filter((piece): piece is string => piece !== undefined && piece.trim().length > 0)
    .join(SEPARATOR);
}
