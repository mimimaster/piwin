/**
 * Per-model request protocol picker (ADR 0079). A multi-format gateway row
 * (e.g. CLIProxyAPI) can send one model as Gemini while the rest speak
 * OpenAI; base URL and key stay on the provider.
 */
import type { ChangeEvent, ReactElement } from 'react';
import type { ModelProviderConfig } from '@piwin/contracts';
import { isProviderProtocol, rebaseForProtocol } from '@piwin/contracts';

type ProviderProtocol = ModelProviderConfig['protocol'];

const PROTOCOL_OPTIONS: readonly ProviderProtocol[] = [
  'openai-compatible',
  'anthropic-compatible',
  'google-gemini',
];

function protocolLabel(protocol: ProviderProtocol, zh: boolean): string {
  switch (protocol) {
    case 'openai-compatible':
      return zh ? 'OpenAI 兼容' : 'OpenAI-compatible';
    case 'anthropic-compatible':
      return zh ? 'Anthropic Messages' : 'Anthropic Messages';
    case 'google-gemini':
      return zh ? 'Google Gemini' : 'Google Gemini';
  }
}

export function ModelProtocolField(props: {
  /** '' or omitted = inherit the provider protocol. */
  value: ProviderProtocol | '' | undefined;
  providerProtocol: ProviderProtocol;
  providerBaseUrl?: string;
  disabled?: boolean;
  isChinese: boolean;
  testId: string;
  onChange: (protocol: ProviderProtocol | '') => void;
}): ReactElement {
  const zh = props.isChinese;
  const overridden = props.value && props.value !== props.providerProtocol ? props.value : undefined;
  const target =
    overridden && props.providerBaseUrl ? rebaseForProtocol(props.providerBaseUrl, overridden) : undefined;
  return (
    <label className="model-edit-field-group">
      <span className="model-edit-field-label">{zh ? '请求协议' : 'Request protocol'}</span>
      <select
        value={overridden ?? ''}
        disabled={props.disabled}
        data-testid={props.testId}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
          const value = event.target.value;
          props.onChange(isProviderProtocol(value) && value !== props.providerProtocol ? value : '');
        }}
      >
        <option value="">
          {zh
            ? `跟随服务商（${protocolLabel(props.providerProtocol, zh)}）`
            : `Provider default (${protocolLabel(props.providerProtocol, zh)})`}
        </option>
        {PROTOCOL_OPTIONS.filter((protocol) => protocol !== props.providerProtocol).map((protocol) => (
          <option key={protocol} value={protocol}>
            {protocolLabel(protocol, zh)}
          </option>
        ))}
      </select>
      {target ? (
        <span className="muted" data-testid={`${props.testId}-target`}>
          {zh ? `请求发往 ${target}（同一 Key）` : `Requests go to ${target} (same key)`}
        </span>
      ) : null}
    </label>
  );
}
