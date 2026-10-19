/** Derived from ZhiAo1120/pi-opencode-zen, MIT, commit bebac80a40ec52136fdf6563ddfdae3e417b708a. */
import { randomBytes, randomInt } from 'node:crypto';
export const ZEN_BASE_URL = 'https://opencode.ai/zen/v1';
export const ZEN_API = 'piwin-opencode-zen-api';
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SESSION_PATTERN = /^ses_[0-9a-f]{9}f[c-f][0-9a-f][0-9A-Za-z]{14}$/;

/** Ephemeral protocol identifier, not an authentication credential. */
export function newZenSessionId() {
  return `ses_${randomBytes(5).toString('hex').slice(0, 9)}${randomInt(0xfc0, 0x1000).toString(16)}${Array.from({ length: 14 }, () => ALPHABET.charAt(randomInt(ALPHABET.length))).join('')}`;
}
/** @param {string | undefined} override */
export function resolveZenSessionId(override) {
  if (!override) return newZenSessionId();
  if (!SESSION_PATTERN.test(override)) throw new Error('Invalid OPENCODE_ZEN_SESSION format');
  return override;
}
/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
/** Fresh protocol-only declarations; never register executable placeholder tools.
 * @param {'bash' | 'read'} name
 */
function placeholder(name) {
  const argument = name === 'bash' ? 'command' : 'filePath';
  return { type: 'function', function: { name, description: 'Protocol placeholder; unavailable unless registered by the Host.', parameters: { type: 'object', properties: { [argument]: { type: 'string' } }, required: [argument] } } };
}
/** @param {unknown} payload @param {ReadonlySet<string>} realTools @returns {unknown} */
export function shapeZenPayload(payload, realTools) {
  if (!isRecord(payload)) return payload;
  const tools = Array.isArray(payload.tools) ? [...payload.tools] : [];
  const names = new Set(tools.map((tool) => isRecord(tool) && isRecord(tool.function) ? tool.function.name : undefined));
  for (const name of /** @type {const} */ (['bash', 'read'])) if (!names.has(name)) tools.push(placeholder(name));
  return { ...payload, stream: true, tools, ...(realTools.size === 0 ? { tool_choice: 'none' } : {}) };
}
/** @param {Record<string, string> | undefined} modelHeaders
 * @param {import('@earendil-works/pi-ai').ProviderHeaders | undefined} requestHeaders
 * @param {string} sessionId @returns {import('@earendil-works/pi-ai').ProviderHeaders}
 */
export function buildZenHeaders(modelHeaders, requestHeaders, sessionId) {
  /** @type {import('@earendil-works/pi-ai').ProviderHeaders} */
  const headers = {};
  const controlled = new Set(['authorization', 'user-agent', 'x-opencode-request', 'x-opencode-session', 'x-opencode-session-id']);
  for (const source of [modelHeaders, requestHeaders]) {
    for (const [name, value] of Object.entries(source ?? {})) if (!controlled.has(name.toLowerCase())) headers[name.toLowerCase()] = value;
  }
  return { ...headers, authorization: 'Bearer public', 'user-agent': 'opencode/1.18.31 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14', 'x-opencode-session': sessionId, 'x-opencode-session-id': sessionId };
}
