/**
 * What a Devin sign-in set up on the Host, reported where the user signed in.
 *
 * The Host turns on code_search and the Devin web-search source when the user
 * had not configured them, but never changes the search priority: a user on
 * "model-native first" may have picked it deliberately. Here they get a
 * one-click switch instead of a silent change.
 */
import { useState, type ReactElement } from 'react';
import type { PiwinConfig, SubscriptionLoginFollowUp } from '@piwin/contracts';
import { Button, Notice } from '@piwin/ui-kit';

import { useSettings } from './settings-context.js';

function enabledSentence(enabled: SubscriptionLoginFollowUp['enabled'], zh: boolean): string | null {
  const codeSearch = enabled.includes('code-search');
  const web = enabled.includes('web-search-source');
  if (codeSearch && web) {
    return zh
      ? '已用 Devin 账号启用 code_search 和 Devin 网页搜索。'
      : 'code_search and Devin web search are now on, using your Devin account.';
  }
  if (codeSearch) return zh ? '已用 Devin 账号启用 code_search。' : 'code_search is now on, using your Devin account.';
  if (web) return zh ? '已启用 Devin 网页搜索。' : 'Devin web search is now on.';
  return null;
}

export function DevinLoginFollowUp(props: {
  followUp: SubscriptionLoginFollowUp;
  zh: boolean;
  onDismiss: () => void;
}): ReactElement {
  const { followUp, zh } = props;
  const { hostClient, saveConfig, setInfo } = useSettings();
  const [switching, setSwitching] = useState(false);
  const [switched, setSwitched] = useState(false);
  const offerSwitch = followUp.suggestExternalSearchPriority === true && !switched;

  async function switchToExternalFirst(): Promise<void> {
    if (!hostClient?.request) return;
    setSwitching(true);
    try {
      // Read the Host's current config: this sign-in just changed web and
      // codeSearch there, and saving an older copy would undo that.
      const response = await hostClient.request({ type: 'settings/get' });
      const fresh = response.success
        ? (response.data as { snapshot?: { config?: PiwinConfig } } | undefined)?.snapshot?.config
        : undefined;
      if (!fresh?.web) {
        setInfo(zh ? '切换失败：读取不到当前配置。' : 'Switch failed: could not read the current config.');
        return;
      }
      const ok = await saveConfig({ ...fresh, web: { ...fresh.web, searchRoutePolicy: 'external-first' } });
      if (ok) {
        setSwitched(true);
        setInfo(zh ? '已切换为外部搜索优先。' : 'Search now prefers external sources.');
      } else {
        setInfo(zh ? '切换失败：无法写入配置。' : 'Switch failed: could not write config.');
      }
    } finally {
      setSwitching(false);
    }
  }

  const sentence = enabledSentence(followUp.enabled, zh);
  return (
    <Notice
      tone="info"
      testId="devin-login-follow-up"
      title={zh ? 'Devin 已连接' : 'Devin connected'}
      action={
        <Button variant="ghost" size="compact" onClick={props.onDismiss} data-testid="devin-login-follow-up-dismiss">
          {zh ? '知道了' : 'Got it'}
        </Button>
      }
    >
      {sentence ? <p>{sentence}</p> : null}
      {offerSwitch ? (
        <p className="devin-follow-up-priority">
          {zh
            ? '网页搜索当前是「模型内置搜索优先」，Devin 搜索很少会被用到。'
            : 'Web search currently prefers the model’s built-in search, so Devin search will rarely run.'}{' '}
          <Button
            variant="primary"
            size="compact"
            disabled={switching}
            onClick={() => void switchToExternalFirst()}
            data-testid="devin-login-follow-up-switch"
          >
            {zh ? '切换为外部搜索优先' : 'Prefer external search'}
          </Button>
        </p>
      ) : null}
    </Notice>
  );
}
