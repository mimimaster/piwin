import type { ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import { useInkstone } from '../inkstone-context.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { FlashcardCatalogPage } from '../../surfaces/flashcards/FlashcardCatalogPage.js';
import { navigateMobileFlashcardsRoute } from '../../mobile-flashcards-route.js';

export function CardsPage(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedCardsPage hostCtx={hostCtx} />;
}

function ConnectedCardsPage({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const client = host.client;
  return (
    <FlashcardCatalogPage
      request={(command, options) => {
        if (client === undefined) {
          return Promise.resolve({
            type: 'response' as const,
            command: command.type,
            success: false as const,
            error: 'Host 尚未连接。',
          });
        }
        return client.request(command, options);
      }}
      connected={client !== undefined && host.connectionState.kind === 'ready'}
      hasStudyCapability={() => host.hostStatus?.capabilities.flashcardStudy === true}
      onOpenStudy={(roundId) => navigateMobileFlashcardsRoute({ kind: 'study', roundId }, 'push')}
      onBack={() => dispatch({ type: 'navigate', route: 'shelf' })}
    />
  );
}
