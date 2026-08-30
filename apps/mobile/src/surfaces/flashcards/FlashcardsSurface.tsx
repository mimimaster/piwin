import { useCallback, useMemo, type ReactElement } from 'react';
import { hostSupportsFlashcardStudy, type HostPush, type RemoteHostStatusData } from '@piwin/contracts';
import type { HostClient, HostClientState } from '@piwin/host-client';
import { Button, EmptyState } from '@piwin/ui-kit';
import {
  leaveMobileFlashcardsToChat,
  navigateMobileFlashcardsRoute,
  type MobileFlashcardsRoute,
} from '../../mobile-flashcards-route.js';
import { FlashcardCatalogPage } from './FlashcardCatalogPage.js';
import { FlashcardStudyPage } from './FlashcardStudyPage.js';
import { MOBILE_FLASHCARD_STUDY_COPY as copy } from './study-copy.js';
import {
  loadMobileStudyReturnContext,
  type MobileStudyReturnSource,
} from './study-return-context.js';
import type { MobileFlashcardStudyPorts } from './study-session.js';

export type FlashcardsSurfaceProps = {
  route: MobileFlashcardsRoute;
  client?: HostClient | undefined;
  hostStatus?: RemoteHostStatusData | undefined;
  connectionState: HostClientState;
};

function portsFromClient(
  client: HostClient,
  hostStatus: RemoteHostStatusData | undefined,
): MobileFlashcardStudyPorts {
  return {
    request: (command, options) => client.request(command, options),
    subscribePush: (listener) =>
      client.subscribePush((push: HostPush) => {
        listener(push);
      }),
    subscribeConnected: (listener) =>
      client.subscribeState((state) => {
        listener(state.kind === 'ready');
      }),
    hasStudyCapability: () => hostSupportsFlashcardStudy(hostStatus?.capabilities),
    ...(hostStatus?.hostInstanceId ? { hostIdentity: hostStatus.hostInstanceId } : {}),
  };
}

export function FlashcardsSurface(props: FlashcardsSurfaceProps): ReactElement {
  const connected = props.connectionState.kind === 'ready';
  const returnContext = loadMobileStudyReturnContext();
  const returnSource: MobileStudyReturnSource = returnContext?.source === 'chat' ? 'chat' : 'catalog';
  const client = props.client;
  const capability = hostSupportsFlashcardStudy(props.hostStatus?.capabilities);
  const hostIdentity = props.hostStatus?.hostInstanceId;
  const ports = useMemo(
    () => (client ? portsFromClient(client, props.hostStatus) : null),
    [client, capability, hostIdentity, props.hostStatus],
  );

  const openStudy = useCallback((roundId: string) => {
    navigateMobileFlashcardsRoute({ kind: 'study', roundId }, 'push');
  }, []);

  const leaveStudy = useCallback(() => {
    if (returnSource === 'chat') {
      leaveMobileFlashcardsToChat();
      return;
    }
    navigateMobileFlashcardsRoute({ kind: 'catalog' }, 'replace');
  }, [returnSource]);

  if (!client || !ports) {
    return (
      <div className="mobile-flashcards-page" data-testid="flashcards-catalog-page">
        <EmptyState
          title={copy.notConnected}
          description={copy.notConnectedBody}
          action={
            <Button variant="secondary" onClick={leaveMobileFlashcardsToChat}>
              {copy.backChat}
            </Button>
          }
          testId="flashcards-catalog-disconnected"
        />
      </div>
    );
  }

  if (props.route.kind === 'study') {
    return (
      <FlashcardStudyPage
        roundId={props.route.roundId}
        ports={ports}
        returnSource={returnSource}
        onLeave={leaveStudy}
      />
    );
  }

  return (
    <FlashcardCatalogPage
      request={ports.request}
      connected={connected}
      hasStudyCapability={ports.hasStudyCapability ?? (() => false)}
      onOpenStudy={openStudy}
      onBack={leaveMobileFlashcardsToChat}
      {...(returnContext?.selectedDeck ? { initialDeck: returnContext.selectedDeck } : {})}
      {...(returnContext?.search ? { initialSearch: returnContext.search } : {})}
      {...(returnContext?.scrollTop ? { initialScrollTop: returnContext.scrollTop } : {})}
    />
  );
}
