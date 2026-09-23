import { describe, expect, it } from 'vitest';

import { shouldOfferGitBash } from './windows-shell-offer.js';

describe('shouldOfferGitBash', () => {
  it('offers while a Windows Host has no Git Bash and the offer was never answered', () => {
    expect(
      shouldOfferGitBash({ windows: true, offerDeclined: false, gitBashInstalled: false }),
    ).toBe(true);
  });

  it('retires the offer once Git Bash exists or the user declined', () => {
    expect(
      shouldOfferGitBash({ windows: true, offerDeclined: false, gitBashInstalled: true }),
    ).toBe(false);
    expect(
      shouldOfferGitBash({ windows: true, offerDeclined: true, gitBashInstalled: false }),
    ).toBe(false);
    expect(
      shouldOfferGitBash({ windows: false, offerDeclined: false, gitBashInstalled: false }),
    ).toBe(false);
  });
});
