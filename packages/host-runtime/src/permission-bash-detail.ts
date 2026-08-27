/**
 * Extract the bash command from a parent-owned bash permission detail.
 *
 * The bash registration formats detail as `<reason>: <command>`. The command
 * is the remainder after the first `": "` separator, so a reason containing
 * `: ` cannot steal command text.
 * Returns the empty string when no separator is present (no command to
 * remember).
 */
export function extractBashCommandFromDetail(detail: string): string {
  const separatorIndex = detail.indexOf(': ');
  if (separatorIndex === -1) {
    return '';
  }
  return detail.slice(separatorIndex + 2).trim();
}
