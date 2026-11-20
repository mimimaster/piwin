const SAFE_TOOL_ID = /^[A-Za-z0-9_-]+$/;
const DV_PREFIX = 'dv_';
const MAX_FOLD_DEPTH = 8;
const MAX_GEMINI_DEPTH = 32;

/**
 * Devin returns tool call IDs containing `:` and `#` (e.g. `Bash:0#a65b...`),
 * which downstream Anthropic/Claude validators reject. Encode unsafe IDs to
 * `dv_<base64url>` going out to Pi, and decode back to Devin's raw ID on return.
 */
export function encodeDevinToolId(id: string): string {
  if (SAFE_TOOL_ID.test(id) && !id.startsWith(DV_PREFIX)) {
    return id;
  }
  return `${DV_PREFIX}${Buffer.from(id, 'utf8').toString('base64url')}`;
}

export function decodeDevinToolId(id: string): string {
  if (!id.startsWith(DV_PREFIX) || !SAFE_TOOL_ID.test(id)) {
    return id;
  }
  const raw = Buffer.from(id.slice(DV_PREFIX.length), 'base64url').toString('utf8');
  return raw && encodeDevinToolId(raw) === id ? raw : id;
}

/**
 * Sniff image bytes so Devin does not reject a PNG declared as JPEG (or vice versa).
 */
export function sniffImageMimeType(base64Data: string, declaredMimeType?: string): string {
  const bytes = Buffer.from(base64Data.slice(0, 24), 'base64');
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6 && bytes.toString('latin1', 0, 4) === 'GIF8') {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  const trimmed = declaredMimeType?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'image/png';
}

export function formatDevinToolDescriptions(
  tools: readonly { name: string; description: string }[],
): string {
  const nonEmpty = tools
    .map((tool) => ({ name: tool.name, description: tool.description.trim() }))
    .filter((tool) => tool.description.length > 0);
  if (nonEmpty.length === 0) {
    return '';
  }
  const body = nonEmpty
    .map((tool) => `<tool name="${tool.name}">\n${tool.description}\n</tool>\n`)
    .join('');
  return `<tool_descriptions>\n${body}</tool_descriptions>`;
}

export function normalizeDevinToolSchema(schema: unknown, modelId: string): Record<string, unknown> {
  if (!isJsonObject(schema)) {
    return { type: 'object', properties: {} };
  }
  const folded = foldObjectRoot(schema, schema, 0);
  return /gemini/i.test(modelId) ? normalizeGeminiSchema(folded, 0) : folded;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveLocalRef(
  root: Record<string, unknown>,
  branch: unknown,
): Record<string, unknown> | null {
  if (!isJsonObject(branch)) {
    return null;
  }
  if (typeof branch.$ref !== 'string' || branch.$ref.length === 0) {
    return branch;
  }
  for (const key of ['$defs', 'definitions'] as const) {
    const prefix = `#/${key}/`;
    if (branch.$ref.startsWith(prefix)) {
      const container = root[key];
      if (!isJsonObject(container)) return null;
      const target = container[branch.$ref.slice(prefix.length)];
      return isJsonObject(target) ? target : null;
    }
  }
  return null;
}

function foldObjectRoot(
  root: Record<string, unknown>,
  schema: Record<string, unknown>,
  depth: number,
): Record<string, unknown> {
  if (
    schema.type === 'object' &&
    !Object.hasOwn(schema, 'anyOf') &&
    !Object.hasOwn(schema, 'oneOf') &&
    !Object.hasOwn(schema, 'allOf')
  ) {
    return schema;
  }
  const out: Record<string, unknown> = { ...schema };
  const props: Record<string, unknown> = isJsonObject(schema.properties)
    ? { ...schema.properties }
    : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((entry): entry is string => typeof entry === 'string')
    : [];

  if (Array.isArray(schema.allOf)) {
    for (const rawBranch of schema.allOf) {
      const branch = resolveLocalRef(root, rawBranch);
      if (!branch) continue;
      if (isJsonObject(branch.properties)) {
        for (const [key, value] of Object.entries(branch.properties)) {
          if (!Object.hasOwn(props, key)) props[key] = value;
        }
      }
      if (Array.isArray(branch.required)) {
        for (const req of branch.required) {
          if (typeof req === 'string') required.push(req);
        }
      }
    }
  }
  delete out.allOf;

  const unionBranches: Record<string, unknown>[] = [];
  for (const unionKey of ['anyOf', 'oneOf'] as const) {
    const rawList = schema[unionKey];
    if (Array.isArray(rawList)) {
      for (const rawBranch of rawList) {
        let branch = resolveLocalRef(root, rawBranch);
        if (!branch) continue;
        if (
          depth < MAX_FOLD_DEPTH &&
          (['anyOf', 'oneOf', 'allOf'] as const).some((key) => Object.hasOwn(branch as object, key))
        ) {
          branch = foldObjectRoot(root, branch, depth + 1);
        }
        if (branch.type !== 'object' && !Object.hasOwn(branch, 'properties')) {
          continue;
        }
        unionBranches.push(branch);
      }
    }
    delete out[unionKey];
  }

  let commonRequired: string[] | null = null;
  const branchProps = new Map<string, unknown[]>();
  for (const branch of unionBranches) {
    if (isJsonObject(branch.properties)) {
      for (const [key, value] of Object.entries(branch.properties)) {
        if (Object.hasOwn(props, key)) continue;
        const variants = branchProps.get(key) ?? [];
        const serialized = JSON.stringify(value);
        if (!variants.some((existing) => JSON.stringify(existing) === serialized)) {
          variants.push(value);
        }
        branchProps.set(key, variants);
      }
    }
    const branchReq = Array.isArray(branch.required)
      ? branch.required.filter((entry): entry is string => typeof entry === 'string')
      : [];
    commonRequired =
      commonRequired === null
        ? [...branchReq]
        : commonRequired.filter((item) => branchReq.includes(item));
  }

  for (const [key, variants] of branchProps) {
    props[key] = variants.length === 1 ? variants[0] : { anyOf: variants };
  }
  for (const req of commonRequired ?? []) {
    if (!required.includes(req)) required.push(req);
  }
  const uniqueRequired = [...new Set(required)];
  out.type = 'object';
  out.properties = props;
  if (uniqueRequired.length > 0) {
    out.required = uniqueRequired;
  } else {
    delete out.required;
  }
  return out;
}

function normalizeGeminiSchema(
  schema: Record<string, unknown>,
  depth: number,
): Record<string, unknown> {
  if (depth > MAX_GEMINI_DEPTH) {
    return schema;
  }
  let out: Record<string, unknown> = { ...schema };
  const sub = (value: Record<string, unknown>): Record<string, unknown> =>
    normalizeGeminiSchema(value, depth + 1);

  for (const mapKey of [
    'properties',
    'patternProperties',
    '$defs',
    'definitions',
    'dependentSchemas',
  ] as const) {
    const nested = out[mapKey];
    if (isJsonObject(nested)) {
      out[mapKey] = Object.fromEntries(
        Object.entries(nested).map(([name, value]) => [name, isJsonObject(value) ? sub(value) : value]),
      );
    }
  }
  for (const arrKey of ['anyOf', 'oneOf', 'allOf', 'prefixItems'] as const) {
    const nested = out[arrKey];
    if (Array.isArray(nested)) {
      out[arrKey] = nested.map((item) => (isJsonObject(item) ? sub(item) : item));
    }
  }
  for (const objKey of ['additionalProperties', 'not', 'if', 'then', 'else', 'contains'] as const) {
    const nested = out[objKey];
    if (isJsonObject(nested)) {
      out[objKey] = sub(nested);
    }
  }

  if (Array.isArray(out.type)) {
    const types = [...new Set(out.type.filter((item): item is string => typeof item === 'string'))];
    const nonNull = types.filter((item) => item !== 'null');
    if (nonNull.length < types.length && nonNull.length > 0) {
      out.nullable = true;
    }
    if (nonNull.length === 1) {
      out.type = nonNull[0];
    } else if (nonNull.length === 0) {
      if (types.length > 0) {
        out.type = 'null';
      } else {
        delete out.type;
      }
    } else {
      delete out.type;
      const branches = nonNull.map((item) => ({
        type: item,
        ...(item === 'array' ? { items: {} } : {}),
      }));
      out.anyOf = Array.isArray(out.anyOf) ? [...out.anyOf, ...branches] : branches;
    }
  }

  if (depth > 0 && out.type !== undefined && Array.isArray(out.anyOf)) {
    const isNullBranch = (branch: unknown): boolean => isJsonObject(branch) && branch.type === 'null';
    const nonNullBranches = out.anyOf.filter((branch) => !isNullBranch(branch));
    if (nonNullBranches.length < out.anyOf.length) {
      out.nullable = true;
    }
    delete out.anyOf;
    const onlyBranch =
      nonNullBranches.length === 1 && isJsonObject(nonNullBranches[0])
        ? nonNullBranches[0]
        : undefined;
    if (onlyBranch && (onlyBranch.type === undefined || onlyBranch.type === out.type)) {
      out = { ...onlyBranch, ...out };
    } else if (nonNullBranches.length > 0) {
      if (!Array.isArray(out.oneOf)) {
        out.oneOf = nonNullBranches;
      } else {
        const existingAllOf = Array.isArray(out.allOf) ? out.allOf : [];
        out.allOf = [...existingAllOf, { oneOf: nonNullBranches }];
      }
    }
  }

  if (out.type === undefined && Array.isArray(out.enum)) {
    const values = out.enum.filter((value) => value !== null);
    if (values.length < out.enum.length) {
      out.nullable = true;
    }
    const kinds = new Set(values.map((value) => (Number.isInteger(value) ? 'integer' : typeof value)));
    const singleKind =
      kinds.size === 1
        ? [...kinds][0]
        : kinds.size === 2 && kinds.has('integer') && kinds.has('number')
          ? 'number'
          : '';
    if (
      singleKind === 'string' ||
      singleKind === 'integer' ||
      singleKind === 'number' ||
      singleKind === 'boolean'
    ) {
      out.type = singleKind;
      out.enum = values;
    } else {
      delete out.enum;
    }
  }

  if (out.type === undefined && isJsonObject(out.properties)) {
    out.type = 'object';
  }

  if (out.type === 'array' || (out.type === undefined && Object.hasOwn(out, 'items'))) {
    if (Array.isArray(out.items)) {
      out.items =
        out.items.length === 1 && isJsonObject(out.items[0]) ? sub(out.items[0]) : {};
    } else {
      out.items = isJsonObject(out.items) ? sub(out.items) : {};
    }
    out.type = 'array';
  }

  return out;
}
