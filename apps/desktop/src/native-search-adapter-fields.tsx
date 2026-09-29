/**
 * Native-search adapter picker shown under the 「模型内置搜索」 capability
 * (ADR 0043). Options are filtered to what the provider protocol can express,
 * and to the vendor's own shapes when the base URL identifies an official host;
 * an unknown/incompatible saved value stays visible so readiness can explain
 * it instead of silently failing.
 */
import type { ChangeEvent, ReactElement } from 'react';
import type {
  AnthropicWebSearchToolType,
  ModelProviderConfig,
  NativeSearchAdapterKind,
  ProviderChatApi,
} from '@piwin/contracts';
import {
  compatibleNativeSearchAdapters,
  isNativeSearchAdapterCompatible,
  isNativeSearchAdapterKind,
  nativeSearchProtocolSwitch,
  rebaseForProtocol,
} from '@piwin/contracts';
import type { ModelConfigurationDraft } from './model-configuration.js';

const ANTHROPIC_TOOL_TYPES: readonly AnthropicWebSearchToolType[] = [
  'web_search_20250305',
  'web_search_20260209',
  'web_search_20260318',
];

export function nativeSearchAdapterLabel(adapter: NativeSearchAdapterKind, zh: boolean): string {
  switch (adapter) {
    case 'openai-responses-tool':
      return zh ? 'OpenAI Responses · web_search 工具' : 'OpenAI Responses · web_search tool';
    case 'openai-web-search-options':
      return zh ? 'OpenAI Chat · web_search_options（仅搜索模型）' : 'OpenAI Chat · web_search_options (search models)';
    case 'xai-web-search-tool':
      return zh ? 'xAI Responses · web_search 工具' : 'xAI Responses · web_search tool';
    case 'anthropic-web-search-tool':
      return zh ? 'Anthropic · web_search 服务端工具' : 'Anthropic · web_search server tool';
    case 'google-search-tool':
      return zh ? 'Gemini · Google Search 接地' : 'Gemini · Google Search grounding';
  }
}

const SWITCH_PROTOCOL_VALUE = '__switch-protocol__';

function protocolName(protocol: ModelProviderConfig['protocol']): string {
  switch (protocol) {
    case 'openai-compatible':
      return 'OpenAI';
    case 'anthropic-compatible':
      return 'Anthropic';
    case 'google-gemini':
      return 'Gemini';
  }
}

export function NativeSearchAdapterFields(props: {
  draft: ModelConfigurationDraft;
  protocol: ModelProviderConfig['protocol'];
  chatApi?: ProviderChatApi;
  /** Provider base URL: an official vendor host shows only that vendor's shapes. */
  baseUrl?: string;
  /**
   * Offer switching the model's request protocol when its vendor's search
   * needs another wire (ADR 0079). Off for subscriptions (fixed wire).
   */
  allowProtocolSwitch?: boolean;
  disabled?: boolean;
  isChinese: boolean;
  onChange: (update: (current: ModelConfigurationDraft) => ModelConfigurationDraft) => void;
}): ReactElement | null {
  const { draft, isChinese: zh, disabled } = props;
  if (!draft.supportsNativeWebSearch) return null;
  // ADR 0079: a per-model protocol changes which search shapes the model speaks.
  const overridden = draft.protocol && draft.protocol !== props.protocol ? draft.protocol : undefined;
  const protocol = overridden ?? props.protocol;
  const chatApi = overridden ? undefined : props.chatApi;
  const baseUrl =
    overridden && props.baseUrl ? rebaseForProtocol(props.baseUrl, overridden) : props.baseUrl;
  const modelId = draft.id.trim() || undefined;
  const options = compatibleNativeSearchAdapters(protocol, chatApi, baseUrl, modelId);
  // e.g. `gemini-*` on an OpenAI gateway row: search needs the Gemini wire.
  const switchTo = props.allowProtocolSwitch
    ? nativeSearchProtocolSwitch({ protocol, ...(baseUrl ? { baseUrl } : {}), ...(modelId ? { modelId } : {}) })
    : undefined;
  const switchAdapter = switchTo
    ? compatibleNativeSearchAdapters(
        switchTo,
        undefined,
        props.baseUrl ? rebaseForProtocol(props.baseUrl, switchTo) : undefined,
        modelId,
      )[0]
    : undefined;
  const saved = draft.nativeSearchAdapter;
  const savedIncompatible =
    saved !== '' &&
    (!isNativeSearchAdapterKind(saved) ||
      !isNativeSearchAdapterCompatible(protocol, chatApi, saved, baseUrl, modelId));
  const anthropic = draft.nativeSearchOptions?.anthropic;
  const includeSources = draft.nativeSearchOptions?.openaiResponses?.includeSources ?? true;

  return (
    <div className="model-edit-route-fields" data-testid="model-edit-native-search">
      <p className="model-edit-route-fields-hint">
        {zh
          ? '模型内置搜索 = web_search 工具调用时，用该模型发起一次厂商原生搜索子请求（会多一次模型调用，可在「网络」设置里选更便宜的搜索代理模型）。'
          : 'Built-in search runs one provider-native sub-request on this model whenever web_search is called (an extra model call; pick a cheaper search delegate under Web settings).'}
      </p>
      <label className="model-edit-field-group">
        <span className="model-edit-field-label">{zh ? '请求方式' : 'Request shape'}</span>
        <select
          value={saved}
          disabled={disabled}
          data-testid="model-edit-native-search-adapter"
          onChange={(event: ChangeEvent<HTMLSelectElement>) => {
            const value = event.target.value;
            if (value === SWITCH_PROTOCOL_VALUE && switchTo) {
              // One step: move the model to the wire its search needs; Auto then infers it.
              props.onChange((current) => ({
                ...current,
                protocol: switchTo === props.protocol ? '' : switchTo,
                nativeSearchAdapter: '',
              }));
              return;
            }
            props.onChange((current) => ({
              ...current,
              nativeSearchAdapter: isNativeSearchAdapterKind(value) ? value : '',
            }));
          }}
        >
          <option value="">{zh ? '自动（按服务商推断）' : 'Auto (infer from provider)'}</option>
          {savedIncompatible ? (
            <option value={saved}>
              {zh ? `${saved}（与当前服务商不兼容）` : `${saved} (incompatible with this provider)`}
            </option>
          ) : null}
          {options.map((adapter) => (
            <option key={adapter} value={adapter}>
              {nativeSearchAdapterLabel(adapter, zh)}
            </option>
          ))}
          {switchTo && switchAdapter ? (
            <option value={SWITCH_PROTOCOL_VALUE}>
              {zh
                ? `${nativeSearchAdapterLabel(switchAdapter, zh)}（改用 ${protocolName(switchTo)} 协议）`
                : `${nativeSearchAdapterLabel(switchAdapter, zh)} (switch to ${protocolName(switchTo)} protocol)`}
            </option>
          ) : null}
        </select>
      </label>
      {switchTo && options.length === 0 && saved === '' ? (
        <p className="model-edit-route-fields-hint" data-testid="model-edit-native-search-needs-protocol">
          {zh
            ? `当前请求协议无法发起该模型的内置搜索，需改用 ${protocolName(switchTo)} 协议（同一服务商、同一 Key）。`
            : `This protocol cannot run this model's built-in search; switch it to ${protocolName(switchTo)} (same provider and key).`}
        </p>
      ) : null}
      {saved === 'openai-responses-tool' ? (
        <label className="model-edit-inline-cap">
          <input
            type="checkbox"
            checked={includeSources}
            disabled={disabled}
            data-testid="model-edit-native-search-include-sources"
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              props.onChange((current) => ({
                ...current,
                nativeSearchOptions: { openaiResponses: { includeSources: event.target.checked } },
              }))
            }
          />
          <span>{zh ? '请求完整来源（include sources）' : 'Request full sources (include)'}</span>
        </label>
      ) : null}
      {saved === 'anthropic-web-search-tool' ? (
        <div className="model-edit-route-grid">
          <label className="model-edit-field-group">
            <span className="model-edit-field-label">{zh ? '工具版本' : 'Tool version'}</span>
            <select
              value={anthropic?.toolType ?? 'web_search_20250305'}
              disabled={disabled}
              data-testid="model-edit-native-search-anthropic-version"
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                const toolType = ANTHROPIC_TOOL_TYPES.find((type) => type === event.target.value);
                props.onChange((current) => ({
                  ...current,
                  nativeSearchOptions: {
                    anthropic: { ...current.nativeSearchOptions?.anthropic, ...(toolType ? { toolType } : {}) },
                  },
                }));
              }}
            >
              {ANTHROPIC_TOOL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="model-edit-field-group">
            <span className="model-edit-field-label">allowed_callers</span>
            <input
              value={(anthropic?.allowedCallers ?? []).join(', ')}
              disabled={disabled}
              placeholder={zh ? '新版本默认 direct' : 'newer versions default to direct'}
              data-testid="model-edit-native-search-anthropic-callers"
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const callers = event.target.value
                  .split(',')
                  .map((caller) => caller.trim())
                  .filter(Boolean);
                props.onChange((current) => {
                  const { allowedCallers: _drop, ...rest } = current.nativeSearchOptions?.anthropic ?? {};
                  return {
                    ...current,
                    nativeSearchOptions: {
                      anthropic: { ...rest, ...(callers.length > 0 ? { allowedCallers: callers } : {}) },
                    },
                  };
                });
              }}
            />
          </label>
        </div>
      ) : null}
      {saved === 'google-search-tool' ? (
        <p className="model-edit-route-fields-hint">
          {zh
            ? 'Gemini 需在工具卡中原样展示 Google Search Suggestions；仅支持 API Key，不支持 Vertex / OAuth。'
            : 'Gemini requires showing Google Search Suggestions unmodified; API key only (no Vertex/OAuth).'}
        </p>
      ) : null}
      {saved === 'openai-responses-tool' ? (
        <p className="model-edit-route-fields-hint">
          {zh
            ? 'Codex / WebSocket 通道可能拿不到结构化来源，仅保留模型简报。'
            : 'Codex/WebSocket transports may expose no structured sources; only the brief is kept.'}
        </p>
      ) : null}
    </div>
  );
}
