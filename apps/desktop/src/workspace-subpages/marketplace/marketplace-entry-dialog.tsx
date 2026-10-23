/**
 * Catalog entry detail drawer: what it does, exact version and source, Host
 * prerequisites (checked live on the Host), evidence, runtime risk, example
 * requests — and the install action. Install always goes through here so the
 * risk is seen first.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type {
  HostCommand,
  HostResponse,
  MarketplaceCatalogEntry,
  MarketplaceInstalledItem,
  MarketplaceRequirementCheck,
  MarketplaceRequirementsCheckData,
} from '@piwin/contracts';
import { Button, Dialog, IconButton, Notice, ProgressBar } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../i18n/desktop-locale.js';
import { openExternalUrl } from '../../platform/open-external-url.js';
import { IconClose, IconExternalLink } from '../../tool-cards/shell-icons.js';
import {
  availabilityLabel,
  categoryLabel,
  entryName,
  installRiskNotice,
  inventoryMessage,
  isPiwinTested,
  kindLabel,
  localizedText,
  operationLabel,
  requirementStatusLabel,
  verificationLabel,
} from './marketplace-copy.js';
import { hasCatalogUpdate } from './marketplace-catalog-card.js';
import { MarketplaceKindSeal } from './marketplace-kind-seal.js';
import type { MarketOperation } from './marketplace-types.js';

export type MarketplaceEntryDialogProps = {
  entry: MarketplaceCatalogEntry | null;
  installed: MarketplaceInstalledItem | undefined;
  operation: MarketOperation | undefined;
  locale?: DesktopLocale | undefined;
  onInstall: (entry: MarketplaceCatalogEntry) => void;
  onUpdate?:
    ((entry: MarketplaceCatalogEntry, installed: MarketplaceInstalledItem) => void) | undefined;
  onRemove?: ((item: MarketplaceInstalledItem) => void) | undefined;
  onUseExample?: ((prompt: string) => void) | undefined;
  /** Opens another entry, e.g. the replacement of a withdrawn one. */
  onOpenEntry?: ((entryId: string) => void) | undefined;
  replacementName?: string | undefined;
  /** Host requests; when present, requirements are checked on the Host. */
  request?: ((command: HostCommand) => Promise<HostResponse>) | undefined;
  onClose: () => void;
};

/** States in which the capability can actually be tried from a prompt. */
const TRYABLE = new Set<MarketplaceInstalledItem['availability']>([
  'available',
  'installed',
  'pending-apply',
]);

function useRequirementChecks(
  entry: MarketplaceCatalogEntry | null,
  request: MarketplaceEntryDialogProps['request'],
): ReadonlyMap<string, MarketplaceRequirementCheck> {
  const [checks, setChecks] = useState<ReadonlyMap<string, MarketplaceRequirementCheck>>(new Map());
  // Parents pass a fresh closure each render; only a new entry should re-check.
  const requestRef = useRef(request);
  requestRef.current = request;
  const entryId = entry?.entryId;
  const hasRequirements = (entry?.requirements.length ?? 0) > 0;
  useEffect(() => {
    setChecks(new Map());
    const send = requestRef.current;
    if (!entryId || !hasRequirements || !send) return undefined;
    let cancelled = false;
    void send({ type: 'marketplace/requirements-check', entryId }).then(
      (response) => {
        if (cancelled || !response.success) return;
        const data = response.data as MarketplaceRequirementsCheckData;
        setChecks(
          new Map(data.results.map((result) => [`${result.kind}:${result.value}`, result])),
        );
      },
      () => {
        // The static list still renders; a failed probe only loses the live status.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [entryId, hasRequirements]);
  return checks;
}

function shortVersion(version: string): string {
  return /^[0-9a-f]{40}$/.test(version) ? version.slice(0, 12) : `v${version}`;
}

export function MarketplaceEntryDialog(props: MarketplaceEntryDialogProps): ReactElement | null {
  const { entry, locale } = props;
  const zh = locale === 'zh-CN';
  const t = (en: string, zhText: string) => (zh ? zhText : en);
  const checks = useRequirementChecks(entry, props.request);
  if (!entry) return null;
  const tested = isPiwinTested(entry.verification);
  const name = entryName(entry, locale);
  const installedMessage = props.installed ? inventoryMessage(props.installed, locale) : undefined;
  const canTry = props.installed !== undefined && TRYABLE.has(props.installed.availability);

  return (
    <Dialog
      label={name}
      open={true}
      closeOnInteractOutside={true}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      testId="marketplace-entry-dialog"
      contentClassName="market-entry-modal market-drawer"
    >
      <div className="market-entry">
        <header className="market-entry-head">
          <MarketplaceKindSeal kind={entry.kind} size="lg" />
          <div className="market-entry-heading">
            <h3 className="market-entry-title">{name}</h3>
            <p className="market-entry-kicker">
              {kindLabel(entry.kind, locale)}
              <span aria-hidden="true"> · </span>
              {categoryLabel(entry.category, locale)}
            </p>
          </div>
          <IconButton
            label={t('Close', '关闭')}
            size="sm"
            className="market-entry-close"
            onClick={props.onClose}
          >
            <IconClose width={14} height={14} aria-hidden="true" />
          </IconButton>
        </header>

        <div className="market-entry-scroll">
          {entry.withdrawn ? (
            <div className="market-entry-status">
              <Notice tone="warning" testId="marketplace-entry-withdrawn">
                {t('Withdrawn from the catalog: ', '已从目录下架：')}
                {localizedText(entry.withdrawn.reason, locale)}
                {entry.withdrawn.replacementEntryId && props.onOpenEntry ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="market-inline-link"
                      onClick={() => props.onOpenEntry?.(entry.withdrawn?.replacementEntryId ?? '')}
                    >
                      {t('See replacement', '查看替代项')}
                      {props.replacementName ? ` · ${props.replacementName}` : ''}
                    </button>
                  </>
                ) : null}
              </Notice>
            </div>
          ) : null}

          <p className="market-entry-desc">{localizedText(entry.description, locale)}</p>

          {/* Provenance as a ledger, not a wrapping dot-list: four fixed cells
              stay legible however long a version or repo name gets. */}
          <dl className="market-entry-ledger">
            <div>
              <dt>{t('Version', '版本')}</dt>
              <dd title={entry.version}>{shortVersion(entry.version)}</dd>
            </div>
            <div>
              <dt>{t('Author', '作者')}</dt>
              <dd title={entry.author}>{entry.author}</dd>
            </div>
            <div>
              <dt>{t('Source', '来源')}</dt>
              <dd title={entry.sourceLabel}>{entry.sourceLabel}</dd>
            </div>
            <div>
              <dt>{t('Evidence', '验证')}</dt>
              <dd className="market-entry-evidence" data-tested={tested ? 'true' : 'false'}>
                {verificationLabel(entry.verification, locale)}
              </dd>
            </div>
          </dl>
          {entry.kind === 'extension' && !tested ? (
            <p className="market-entry-note">
              {t(
                'piwin has not run this exact version yet; compatibility is checked after install.',
                'piwin 尚未实测此版本；安装后由 Host 做兼容性检查。',
              )}
            </p>
          ) : null}

          {entry.requirements.length > 0 ? (
            <section className="market-entry-section">
              <h4 className="market-entry-section-title">{t('Before you install', '前提条件')}</h4>
              <ul className="market-entry-requirements">
                {entry.requirements.map((requirement) => {
                  const check = checks.get(`${requirement.kind}:${requirement.value}`);
                  return (
                    <li key={`${requirement.kind}:${requirement.value}`}>
                      <code className="market-code-tag">{requirement.value}</code>
                      <span>
                        {requirement.required ? '' : t('(optional) ', '（可选）')}
                        {localizedText(requirement.description, locale)}
                      </span>
                      {check ? (
                        <span
                          className={`market-requirement-status is-${check.status}`}
                          data-testid={`marketplace-requirement-${check.status}`}
                        >
                          {requirementStatusLabel(check.status, locale)}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {entry.examples.length > 0 ? (
            <section className="market-entry-section">
              <h4 className="market-entry-section-title">{t('Try it with', '可以这样用')}</h4>
              <ul className="market-entry-examples">
                {entry.examples.map((example) => (
                  <li key={example.prompt.en} className="market-entry-example">
                    <span className="market-entry-example-title">
                      {localizedText(example.title, locale)}
                    </span>
                    <p className="market-entry-example-prompt">
                      {localizedText(example.prompt, locale)}
                    </p>
                    {example.expectedResult ? (
                      <p className="market-entry-example-expect">
                        {t('Expect: ', '预期：')}
                        {localizedText(example.expectedResult, locale)}
                      </p>
                    ) : null}
                    {canTry && props.onUseExample ? (
                      <Button
                        variant="ghost"
                        size="compact"
                        className="market-entry-example-use"
                        onClick={() => props.onUseExample?.(localizedText(example.prompt, locale))}
                      >
                        {t('Put in composer', '填入输入框')}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="market-entry-status">
            {props.installed ? (
              <Notice tone={props.installed.availability === 'failed' ? 'warning' : 'info'}>
                {availabilityLabel(props.installed.availability, locale)}
                {installedMessage ? ` — ${installedMessage}` : ''}
              </Notice>
            ) : (
              <Notice tone="warning">{installRiskNotice(entry, locale)}</Notice>
            )}
            {props.operation ? (
              <ProgressBar
                label={operationLabel(props.operation, locale)}
                testId="marketplace-entry-progress"
              />
            ) : null}
          </div>
        </div>

        <footer className="market-entry-foot">
          {entry.homepage ? (
            <Button
              variant="ghost"
              size="compact"
              className="market-entry-source"
              onClick={() => void openExternalUrl(entry.homepage ?? '')}
            >
              <span className="market-btn-inner">
                <IconExternalLink width={12} height={12} aria-hidden="true" />
                {t('Source', '查看源码')}
              </span>
            </Button>
          ) : null}
          {props.installed ? (
            <>
              {props.installed.removal && props.onRemove ? (
                <Button
                  variant="ghost"
                  size="compact"
                  disabled={props.operation !== undefined}
                  onClick={() => {
                    props.onClose();
                    props.onRemove?.(props.installed!);
                  }}
                  data-testid="marketplace-entry-remove"
                >
                  {t('Uninstall', '卸载')}
                </Button>
              ) : null}
              {hasCatalogUpdate(entry, props.installed) ? (
                <Button
                  variant="primary"
                  size="compact"
                  disabled={props.operation !== undefined}
                  aria-busy={props.operation !== undefined}
                  onClick={() => {
                    if (props.onUpdate && props.installed) {
                      props.onUpdate(entry, props.installed);
                    } else {
                      props.onInstall(entry);
                    }
                  }}
                  data-testid="marketplace-entry-update"
                >
                  {props.operation
                    ? operationLabel(props.operation, locale)
                    : t(`Update to v${entry.version}`, `更新至 v${entry.version}`)}
                </Button>
              ) : entry.withdrawn ? null : (
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={props.operation !== undefined}
                  aria-busy={props.operation !== undefined}
                  onClick={() => {
                    if (props.onUpdate && props.installed) {
                      props.onUpdate(entry, props.installed);
                    } else {
                      props.onInstall(entry);
                    }
                  }}
                  data-testid="marketplace-entry-reinstall"
                >
                  {props.operation
                    ? operationLabel(props.operation, locale)
                    : t('Reinstall', '重新安装')}
                </Button>
              )}
            </>
          ) : entry.withdrawn ? null : (
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
        </footer>
      </div>
    </Dialog>
  );
}
