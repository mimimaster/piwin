/**
 * Redact secret-like KEY / TOKEN / SECRET assignments from process logs.
 * Pure; safe to apply to every stdout/stderr chunk before storage or UI.
 */

const SECRET_ASSIGNMENT_PATTERN =
  /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET)[A-Za-z0-9_]*)\s*([=:])\s*(['"]?)([^\s'"]+)\3/gi;

const BEARER_PATTERN = /\b(Bearer)\s+([A-Za-z0-9._\-+=/]+)/gi;

/**
 * Replace values of names containing KEY, TOKEN, or SECRET with `***`.
 * Also redacts `Bearer <token>` forms common in HTTP logs.
 */
export function redactSecretText(text: string): string {
  if (!text) {
    return text;
  }
  let result = text.replace(
    SECRET_ASSIGNMENT_PATTERN,
    (_match, name: string, separator: string) => `${name}${separator}***`,
  );
  result = result.replace(BEARER_PATTERN, '$1 ***');
  return result;
}
