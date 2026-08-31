import type { ModelProviderConfig } from './config.js';
import type { PermissionDecision, PermissionRememberScope } from './host.js';
import type { PermissionRulesFile } from './permission.js';
import type { ApplySettingsInput } from './settings.js';
import type { SearchRoutePreviewInput, WebSearchTestInput } from './web.js';

export type HostRuntimeCommand =
  | { id?: string; type: 'host/ping' }
  | { id?: string; type: 'host/status' }
  | { id?: string; type: 'host/list-dir'; path?: string; includeHidden?: boolean }
  | {
      id?: string;
      /** ADR 0040 §8: query-only aggregate residency/resource metrics. */
      type: 'host/runtime-resources';
    }
  | {
      id?: string;
      /**
       * Bounded Host-wide live runs + pending-permission flags.
       * Opaque session/run ids only — never Host filesystem paths.
       */
      type: 'activity/summary';
      maxItems?: number;
    }
  | {
      id?: string;
      /**
       * ADR 0027: replay buffered pushes from `sinceSeq` (exclusive) to the
       * calling sink. Only valid when the sink is sequenced and the host
       * advertised `pushSequencing`. The host re-emits pushes with their
       * original `seq`/`eventId`, then a terminal `{ type: 'host/replay-done', sinceSeq }`.
       */
      type: 'host/replay';
      sinceSeq: number;
    }
  | { id?: string; type: 'config/get' }
  | { id?: string; type: 'settings/get' }
  | { id?: string; type: 'settings/apply'; input: ApplySettingsInput }
  | { id?: string; type: 'permissions/get-rules'; layer: 'user' }
  | {
      id?: string;
      type: 'permissions/set-rules';
      layer: 'user';
      rules: PermissionRulesFile;
      expectedRevision?: string;
    }
  | {
      id?: string;
      type: 'models/discover';
      provider: ModelProviderConfig;
      /** One-shot secret for this request only — never persisted by host. */
      apiKey?: string;
    }
  | {
      id?: string;
      type: 'models/catalog/search';
      input?: import('./model-catalog.js').ModelCatalogSearchRequest;
    }
  | { id?: string; type: 'models/configured' }
  | {
      id?: string;
      type: 'models/image-catalog/search';
    }
  | {
      id?: string;
      type: 'models/test';
      provider: ModelProviderConfig;
      modelId: string;
      /** One-shot secret for this request only — never persisted by host. */
      apiKey?: string;
    }
  | {
      id?: string;
      type: 'models/image-test';
      provider: ModelProviderConfig;
      modelId: string;
      /** Optional test prompt. Host uses a deterministic smoke prompt when omitted. */
      prompt?: string;
      /** One-shot secret for this request only — never persisted by host. */
      apiKey?: string;
    }
  | {
      id?: string;
      type: 'vision/delegate';
      input: import('./vision-delegation.js').VisionDelegateInput;
    }
  | { id?: string; type: 'vision/cache/clear' }
  | {
      id?: string;
      type: 'secrets/set';
      providerId: string;
      secret: string;
    }
  | {
      id?: string;
      type: 'secrets/get';
      providerId: string;
    }
  | {
      id?: string;
      type: 'web/test-search-source';
      input: WebSearchTestInput;
    }
  | {
      id?: string;
      type: 'web/search-route-preview';
      input: SearchRoutePreviewInput;
    }
  | {
      id?: string;
      type: 'permission/resolve';
      requestId: string;
      decision: PermissionDecision;
      /** When decision is allow, optionally remember for this project (network tools). */
      rememberScope?: PermissionRememberScope;
    }
  | { id?: string; type: 'permission/pending-list' }
  /** CE-OBS: token usage rollup (global / project / session). */
  | {
      id?: string;
      type: 'usage/get-rollup';
      /** When set, restrict to one project (else projectPath below). */
      scope?: import('./host.js').SessionScope;
      /** Legacy project path filter (project scope shorthand). */
      projectPath?: string;
      /** Optional ISO datetime window [from, to]. */
      window?: { from?: string; to?: string };
      /** Max number of per-session rows in the breakdown. Default 20. */
      topSessions?: number;
    };
