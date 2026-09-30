import type {
  SearchRoutePreviewData,
  WebSearchSource,
  WebSearchSourceKind,
  WebSearchTestableSourceKind,
} from '@piwin/contracts';
import type { DesktopLocale, DesktopTranslator } from '../../desktop-locale.js';
import type { DraftSearchSource, DraftWeb } from '../web-draft';
import type { SearchDelegateOption } from './web-page-model-ref.js';

export type WebPageSearchTabProps = {
  zh: boolean;
  locale: DesktopLocale;
  translator: DesktopTranslator;
  webDraft: DraftWeb;
  setWebDraft: (draft: DraftWeb) => void;
  saving: boolean;
  remoteSettingsReadOnly: boolean | undefined;
  hasTaggedNativeSearch: boolean;
  searchDelegateOptions: SearchDelegateOption[];
  selectSearchDelegate: (key: string) => void;
  isKindEnabled: (kind: WebSearchSourceKind) => boolean;
  findSource: (kind: WebSearchSourceKind) => DraftSearchSource | undefined;
  toggleKind: (kind: WebSearchSourceKind, enabled: boolean) => void;
  toggleExpanded: (sourceId: string) => void;
  expandedSourceIds: Set<string>;
  updateKind: (kind: WebSearchSourceKind, patch: Partial<DraftSearchSource>) => void;
  loadProviderSecret: (secretId: string) => Promise<string | null>;
  storeProviderSecret: (secretId: string, secret: string) => Promise<string>;
  saveSearchSecret: (
    kind: 'brave' | 'tavily',
    apiKeyRef: string,
    apiKeyEnv: string,
  ) => Promise<boolean>;
  testSearchConnection: (
    sourceId: string,
    kind: WebSearchTestableSourceKind,
    draft?: WebSearchSource,
  ) => Promise<{ durationMs: number; resultCount: number }>;
  pickCliScript: () => Promise<string | null>;
  routePreview: SearchRoutePreviewData | null;
  routePreviewLoading: boolean;
  routePreviewError: boolean;
};

export type WebPageFetchTabProps = {
  zh: boolean;
  webDraft: DraftWeb;
  setWebDraft: (draft: DraftWeb) => void;
  saving: boolean;
  remoteSettingsReadOnly: boolean | undefined;
  fetchDelegateOptions: SearchDelegateOption[];
  selectFetchDelegate: (key: string) => void;
  loadProviderSecret: (secretId: string) => Promise<string | null>;
  storeProviderSecret: (secretId: string, secret: string) => Promise<string>;
  saveFetchSecret: (apiKeyRef: string, apiKeyEnv: string) => Promise<boolean>;
};
