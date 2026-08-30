import type { ReactElement } from 'react';
import { useDesktopLocale } from '../../desktop-locale-context.js';
import { SubscriptionAccountsPanel } from '../../subscription-accounts.js';
import { PageTitle } from '../page-title.js';

/** Settings → OAuth. Accounts live in Pi auth.json; channels stay under Models. */
export function OauthPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  return (
    <div className="settings-card oauth-settings-page" data-testid="settings-oauth">
      <PageTitle
        title={isChinese ? 'OAuth 订阅账号' : 'OAuth Subscriptions'}
        description={
          isChinese
            ? '通过官方 OAuth 授权连接主流模型平台。登录后会在「模型配置」里加入对应 Provider，可展开查看参数、开关模型和设默认。'
            : 'Connect official subscription accounts via OAuth. Login adds a Provider in Models so you can inspect params, toggle models, and set the default.'
        }
      />
      <SubscriptionAccountsPanel />
    </div>
  );
}
