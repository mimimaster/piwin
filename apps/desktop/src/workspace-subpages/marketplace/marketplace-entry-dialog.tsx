/**
 * Catalog entry detail: what it does, exact version and source, Host
 * prerequisites, evidence, runtime risk, example requests — and the install
 * action. Install always goes through this dialog so the risk is seen first.
 */
import type { ReactElement } from 'react';
import type { MarketplaceCatalogEntry, MarketplaceInstalledItem } from '@piwin/contracts';
import { Button, Dialog, Notice } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../desktop-locale.js';
import { openExternalUrl } from '../../open-external-url.js';
import {
  availabilityLabel,
  categoryLabel,
  installRiskNotice,
  kindLabel,
  localizedText,
  operationLabel,
  verificationLabel,
} from './marketplace-copy.js';
import type { MarketOperation } from './marketplace-types.js';

export type MarketplaceEntryDialogProps = {
  entry: MarketplaceCatalogEntry | null;
  installed: MarketplaceInstalledItem | undefined;
  operation: MarketOperation | undefined;
  locale?: DesktopLocale | undefined;
  onInstall: (entry: MarketplaceCatalogEntry) => void;
  onUseExample?: ((prompt: string) => void) | undefined;
  onClose: () => void;
};

function shortVersion(version: string): string {
  return /^[0-9a-f]{40}$/.test(version) ? version.slice(0, 12) : `v${version}`;
}

export function MarketplaceEntryDialog(props: MarketplaceEntryDialogProps): ReactElement | null {
  const { entry, locale } = props;
  const zh = locale === 'zh-CN';
  const t = (en: string, zhText: string) => (zh ? zhText : en);
  if (!entry) return null;

  return (
    <Dialog
      label={localizedText(entry.name, locale)}
      open={true}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      testId="marketplace-entry-dialog"
    >
      <div className="market-dialog-body">
        <h3 className="market-dialog-title">{localizedText(entry.name, locale)}</h3>
        <div className="market-dialog-meta">
          <span>{kindLabel(entry.kind, locale)}</span>
          <span>•</span>
          <span>{categoryLabel(entry.category, locale)}</span>
          <span>•</span>
          <span title={entry.version}>{shortVersion(entry.version)}</span>
          <span>•</span>
          <span>{entry.author}</span>
          <span>•</span>
          <span>{entry.sourceLabel}</span>
        </div>
        <p className="market-card-desc">{localizedText(entry.description, locale)}</p>

        <section className="market-detail-section">
          <h4>{t('Evidence', '验证情况')}</h4>
          <p className="market-card-meta">
            {verificationLabel(entry.verification, locale)}
            {entry.verification.some((evidence) => evidence.level === 'piwin-tested')
              ? ''
              : ` — ${t(
                  'piwin has not run this exact version yet; compatibility is checked after install.',
                  'piwin 尚未实测此版本；安装后由 Host 做兼容性检查。',
                )}`}
          </p>
        </section>

        {entry.requirements.length > 0 ? (
          <section className="market-detail-section">
            <h4>{t('Before you install', '前提条件')}</h4>
            <ul className="market-detail-list">
              {entry.requirements.map((requirement) => (
                <li key={`${requirement.kind}:${requirement.value}`}>
                  <code className="market-code-tag">{requirement.value}</code>{' '}
                  {requirement.required ? '' : t('(optional) ', '（可选）')}
                  {localizedText(requirement.description, locale)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="market-detail-section">
          <h4>{t('Try it with', '可以这样用')}</h4>
          <ul className="market-detail-list">
            {entry.examples.map((example) => (
              <li key={example.prompt.en}>
                <strong>{localizedText(example.title, locale)}</strong>
                <span className="market-detail-example">{localizedText(example.prompt, locale)}</span>
                {example.expectedResult ? (
                  <span className="market-card-meta">
                    {t('Expect: ', '预期：')}
                    {localizedText(example.expectedResult, locale)}
                  </span>
                ) : null}
                {props.installed?.availability === 'available' && props.onUseExample ? (
                  <Button
                    variant="ghost"
                    size="compact"
                    onClick={() => props.onUseExample?.(localizedText(example.prompt, locale))}
                  >
                    {t('Put in composer', '填入输入框')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        {props.installed ? (
          <Notice tone={props.installed.availability === 'failed' ? 'warning' : 'info'}>
            {availabilityLabel(props.installed.availability, locale)}
            {props.installed.message ? ` — ${props.installed.message}` : ''}
          </Notice>
        ) : (
          <Notice tone="warning">{installRiskNotice(entry, locale)}</Notice>
        )}

        <div className="market-dialog-footer">
          {entry.homepage ? (
            <Button variant="ghost" size="compact" onClick={() => void openExternalUrl(entry.homepage ?? '')}>
              {t('Source', '查看源码')}
            </Button>
          ) : null}
          <Button variant="ghost" size="compact" onClick={props.onClose}>
            {t('Close', '关闭')}
          </Button>
          {props.installed ? null : (
            <Button
              variant="primary"
              size="compact"
              disabled={props.operation !== undefined}
              aria-busy={props.operation !== undefined}
              onClick={() => props.onInstall(entry)}
              data-testid="marketplace-entry-install"
            >
              {props.operation ? operationLabel(props.operation, locale) : t('Install', '安装')}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
