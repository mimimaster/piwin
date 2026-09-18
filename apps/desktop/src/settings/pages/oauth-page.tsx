import type { ReactElement } from 'react';
import { PiEnvironmentIngestCard } from '../../pi-environment-ingest.js';
import { SubscriptionAccountsPanel } from '../../subscription-accounts.js';

/** Settings → OAuth. Accounts live in Host pi-agent/auth.json; channels stay under Models. */
export function OauthPage(): ReactElement {
  return (
    <div className="settings-card oauth-settings-page" data-testid="settings-oauth">
      <PiEnvironmentIngestCard />
      <SubscriptionAccountsPanel />
    </div>
  );
}
