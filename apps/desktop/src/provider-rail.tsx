/**
 * Left rail of the provider workspace: search, add, and the configured
 * providers grouped custom-first (the channels people actually edit), then
 * OAuth packages. Selecting an item shows it in the detail pane.
 */

import { resolveProviderCategory, type ModelProviderConfig } from '@piwin/contracts';
import { IconButton } from '@piwin/ui-kit';
import type { ReactElement } from 'react';
import { ProviderAvatar } from './provider-avatar.js';
import { IconPlus, IconSearch } from './shell-icons.js';

export type ProviderRailTone = 'ok' | 'err' | 'on' | 'off';

export type ProviderRailPending = { id: string; name: string };

export type ProviderRailCopy = {
  searchPlaceholder: string;
  addProvider: string;
  noProviders: string;
  noMatchingProviders: string;
};

export type ProviderRailProps = {
  providers: readonly ModelProviderConfig[];
  selectedId: string | null;
  /** An unsaved new provider, shown first while its draft is open. */
  pending: ProviderRailPending | null;
  defaultProviderId: string | undefined;
  query: string;
  isChinese: boolean;
  copy: ProviderRailCopy;
  subtitleOf: (provider: ModelProviderConfig) => string;
  toneOf: (provider: ModelProviderConfig) => ProviderRailTone;
  onQueryChange: (query: string) => void;
  onSelect: (providerId: string) => void;
  onAdd: () => void;
};

function toneLabel(tone: ProviderRailTone, isChinese: boolean): string {
  if (tone === 'off') return isChinese ? '已停用' : 'Disabled';
  if (tone === 'err') return isChinese ? '上次测试失败' : 'Last test failed';
  if (tone === 'ok') return isChinese ? '测试通过' : 'Test passed';
  return isChinese ? '已启用' : 'Enabled';
}

export function ProviderRail({
  providers,
  selectedId,
  pending,
  defaultProviderId,
  query,
  isChinese,
  copy,
  subtitleOf,
  toneOf,
  onQueryChange,
  onSelect,
  onAdd,
}: ProviderRailProps): ReactElement {
  const custom = providers.filter((provider) => resolveProviderCategory(provider) === 'custom');
  const packages = providers.filter((provider) => resolveProviderCategory(provider) === 'package');
  const showGroupTitles = packages.length > 0;

  function renderItem(provider: ModelProviderConfig): ReactElement {
    const tone = toneOf(provider);
    const selected = provider.id === selectedId;
    return (
      <li key={provider.id}>
        <button
          type="button"
          className={`prail-item${selected ? ' is-selected' : ''}${tone === 'off' ? ' is-off' : ''}`}
          aria-current={selected ? 'true' : undefined}
          onClick={() => onSelect(provider.id)}
          data-testid={`provider-row-${provider.id}`}
        >
          <span className="prail-icon">
            <ProviderAvatar id={provider.id} name={provider.name} size={28} />
            <span
              className={`prail-dot prail-dot--${tone}`}
              title={toneLabel(tone, isChinese)}
              aria-label={toneLabel(tone, isChinese)}
            />
          </span>
          <span className="prail-text">
            <span className="prail-name">
              <span className="prail-name-text">{provider.name}</span>
              {provider.id === defaultProviderId ? (
                <span className="prail-default">{isChinese ? '默认' : 'Default'}</span>
              ) : null}
            </span>
            <span className="prail-sub">{subtitleOf(provider)}</span>
          </span>
          <span className="prail-count" title={isChinese ? '模型数' : 'Models'}>
            {provider.models.length}
          </span>
        </button>
      </li>
    );
  }

  return (
    <nav className="prail" aria-label={isChinese ? '提供商' : 'Providers'}>
      <div className="prail-head">
        <label className="prail-search">
          <IconSearch width={13} height={13} />
          <input
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            placeholder={copy.searchPlaceholder}
            spellCheck={false}
            data-testid="provider-search-input"
          />
        </label>
        <IconButton
          label={copy.addProvider}
          size={30}
          className="prail-add"
          onClick={onAdd}
          data-testid="provider-add-block"
        >
          <IconPlus width={15} height={15} />
        </IconButton>
      </div>

      <div className="prail-scroll">
        {pending ? (
          <ul className="prail-list">
            <li>
              <button
                type="button"
                className="prail-item is-selected is-pending"
                aria-current="true"
                data-testid="provider-row-pending"
              >
                <span className="prail-icon">
                  <ProviderAvatar id={pending.id} name={pending.name} size={28} />
                </span>
                <span className="prail-text">
                  <span className="prail-name">
                    <span className="prail-name-text">
                      {pending.name || (isChinese ? '新提供商' : 'New provider')}
                    </span>
                  </span>
                  <span className="prail-sub">{isChinese ? '未保存' : 'Not saved yet'}</span>
                </span>
              </button>
            </li>
          </ul>
        ) : null}

        {custom.length > 0 ? (
          <div className="prail-group" data-testid="provider-section-custom">
            {showGroupTitles ? (
              <h4 className="prail-group-title">
                {isChinese ? '自定义' : 'Custom'}
                <span>{custom.length}</span>
              </h4>
            ) : null}
            <ul className="prail-list">{custom.map(renderItem)}</ul>
          </div>
        ) : null}

        {packages.length > 0 ? (
          <div className="prail-group" data-testid="provider-section-package">
            <h4 className="prail-group-title">
              {isChinese ? '套餐 · OAuth' : 'Plans · OAuth'}
              <span>{packages.length}</span>
            </h4>
            <ul className="prail-list">{packages.map(renderItem)}</ul>
          </div>
        ) : null}

        {providers.length === 0 && !pending ? (
          <p className="prail-empty" data-testid="provider-empty">
            {query ? copy.noMatchingProviders : copy.noProviders}
          </p>
        ) : null}
      </div>
    </nav>
  );
}
