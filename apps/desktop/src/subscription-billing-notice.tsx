import type { ReactElement } from 'react';
import {
  getSubscriptionBillingNotice,
  modelUsesThirdPartyExtraUsage,
  type SubscriptionBillingNoticeLocale,
} from '@piwin/contracts';
import { Notice } from '@piwin/ui-kit';
import { openExternalUrl } from './open-external-url.js';

export type SubscriptionBillingNoticeBannerProps = {
  providerId: string;
  locale: SubscriptionBillingNoticeLocale;
  variant: 'card' | 'drawer' | 'compact';
};

export function composerSubscriptionBillingNotice(
  model: { providerId: string; source?: string } | undefined,
  locale: SubscriptionBillingNoticeLocale,
): ReactElement | null {
  if (!model || !modelUsesThirdPartyExtraUsage(model)) {
    return null;
  }
  return (
    <SubscriptionBillingNoticeBanner
      providerId={model.providerId}
      locale={locale}
      variant="compact"
    />
  );
}

export function SubscriptionBillingNoticeBanner(
  props: SubscriptionBillingNoticeBannerProps,
): ReactElement | null {
  const copy = getSubscriptionBillingNotice(props.providerId, props.locale);
  if (!copy) {
    return null;
  }

  const openManage = (): void => {
    void openExternalUrl(copy.manageUrl);
  };

  if (props.variant === 'compact') {
    return (
      <div className="composer-billing-notice" data-testid="composer-billing-notice" role="status">
        <span className="composer-billing-notice-text">{copy.compact}</span>
        <button type="button" className="composer-billing-notice-link" onClick={openManage}>
          {copy.manageLabel}
        </button>
      </div>
    );
  }

  return (
    <div
      className={
        props.variant === 'drawer' ? 'oauth-quota-billing-notice' : 'oauth-billing-notice'
      }
    >
      <Notice
        tone="warning"
        title={copy.title}
        testId="subscription-billing-notice"
        action={
          <button type="button" className="oauth-billing-notice-link" onClick={openManage}>
            {copy.manageLabel}
          </button>
        }
      >
        {copy.body}
      </Notice>
    </div>
  );
}
