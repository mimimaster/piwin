import type { ReactElement } from 'react';
import { useDesktopLocale } from '../../desktop-locale-context.js';
import { SubscriptionAccountsPanel } from '../../subscription-accounts.js';

/** Settings → OAuth. Accounts live in Pi auth.json; channels stay under Models. */
export function OauthPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  return (
    <div className="settings-card oauth-settings-page" data-testid="settings-oauth">
      <div className="oauth-hero-banner">
        <div className="oauth-hero-content">
          <p className="oauth-hero-description">
            {isChinese
              ? '通过官方 OAuth 授权连接主流模型平台。登录后凭证由 Host 安全托管，并在「模型配置」中自动激活可用 Provider，支持快速调参、开关模型与设默认。'
              : 'Connect official subscription accounts via OAuth. Credentials are safely managed by Host and automatically activate available providers in Models.'}
          </p>
          <div className="oauth-hero-tips">
            <span className="oauth-hero-tip-item">
              <span className="oauth-hero-tip-dot" />
              {isChinese ? '凭证托管于 ~/.pi/agent/auth.json' : 'Credentials saved in ~/.pi/agent/auth.json'}
            </span>
            <span className="oauth-hero-tip-item">
              <span className="oauth-hero-tip-dot" />
              {isChinese ? '在「模型配置」中开启或调整参数' : 'Configure params & defaults in Models'}
            </span>
          </div>
        </div>
      </div>
      <SubscriptionAccountsPanel />
    </div>
  );
}
