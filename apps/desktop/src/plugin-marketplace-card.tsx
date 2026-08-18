import type { ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import type { PluginMarketplaceCard } from './plugin-marketplace-catalog.js';
import { PluginMarketplaceIcon } from './plugin-marketplace-icons.js';

export type PluginMarketplaceCardViewProps = {
  card: PluginMarketplaceCard;
  added: boolean;
  busy: boolean;
  isChinese: boolean;
  onAdd: (card: PluginMarketplaceCard) => void;
};

export function PluginMarketplaceCardView(props: PluginMarketplaceCardViewProps): ReactElement {
  const description = props.isChinese ? props.card.descriptionZh : props.card.descriptionEn;
  return (
    <div className="plugin-market-card" data-testid={`plugin-market-card-${props.card.id}`}>
      <PluginMarketplaceIcon icon={props.card.icon} />
      <div className="plugin-market-copy">
        <strong>{props.card.name}</strong>
        <p>{description}</p>
      </div>
      {props.added ? (
        <span className="plugin-market-added" data-testid={`plugin-market-added-${props.card.id}`}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M6.2 11.4 3.4 8.6l1.1-1.1 1.7 1.7 4.3-4.3 1.1 1.1-5.4 5.4Z"
              fill="currentColor"
            />
          </svg>
          {props.isChinese ? '已添加' : 'Added'}
        </span>
      ) : (
        <Button
          size="compact"
          variant="secondary"
          className="plugin-market-add"
          disabled={props.busy}
          onClick={() => props.onAdd(props.card)}
          data-testid={`plugin-market-add-${props.card.id}`}
        >
          {props.busy
            ? props.isChinese
              ? '添加中…'
              : 'Adding…'
            : props.isChinese
              ? '添加'
              : 'Add'}
        </Button>
      )}
    </div>
  );
}
