/** Codex offers browser vs headless device_code. Default is the browser paste flow. */
export function selectSubscriptionLoginMethod(
  options: readonly { id: string }[] | undefined,
): string | undefined {
  if (!options?.some((option) => option.id === 'browser')) {
    return undefined;
  }
  return 'browser';
}
