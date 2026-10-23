export const GIT_FOR_WINDOWS_DOWNLOAD_URL = 'https://git-scm.com/download/win';

/**
 * The offer is driven by detection, not by a stored shell: it appears while a
 * Windows Host has no Git Bash, and disappears by itself once one is installed.
 * Declining only stops the asking.
 */
export function shouldOfferGitBash(input: {
  windows: boolean;
  offerDeclined: boolean;
  gitBashInstalled: boolean;
}): boolean {
  return input.windows && !input.offerDeclined && !input.gitBashInstalled;
}
