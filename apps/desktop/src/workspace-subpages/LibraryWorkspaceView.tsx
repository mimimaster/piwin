import type { ReactElement } from 'react';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import type { DesktopLocale } from '../desktop-locale';
import { MediaLibraryWorkspace, type MediaLibraryFilter } from './studio/media-library-workspace';

export type LibraryWorkspaceViewProps = {
  locale?: DesktopLocale;
  onClose: () => void;
  request: (command: HostCommand) => Promise<HostResponse>;
  refreshToken?: number;
  initialKind?: MediaLibraryFilter;
};

export function LibraryWorkspaceView(props: LibraryWorkspaceViewProps): ReactElement {
  return (
    <MediaLibraryWorkspace
      initialKind={props.initialKind ?? 'image'}
      onClose={props.onClose}
      request={props.request}
      {...(props.locale !== undefined ? { locale: props.locale } : {})}
      {...(props.refreshToken !== undefined ? { refreshToken: props.refreshToken } : {})}
    />
  );
}
