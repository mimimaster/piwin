/**
 * Slash commands registered by enabled Pi extensions (ADR 0080), taken from
 * the Host's static scan so listing never runs extension code. Refreshes when
 * the Host pushes a new extension catalog.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  ExtensionSummary,
  HostCommand,
  HostResponse,
  HostServerMessage,
} from '@piwin/contracts';

export type ComposerExtensionCommand = {
  name: string;
  extensionId: string;
  extensionName: string;
};

export type ExtensionSlashCommandsHostPort = {
  subscribe(listener: (message: HostServerMessage) => void): () => void;
  request(command: HostCommand): Promise<HostResponse>;
};

export function useExtensionSlashCommands(
  host: ExtensionSlashCommandsHostPort,
  hostReady: boolean,
): ComposerExtensionCommand[] {
  const [commands, setCommands] = useState<ComposerExtensionCommand[]>([]);

  const refresh = useCallback(async (): Promise<void> => {
    const response = await host.request({ type: 'extensions/list' });
    if (!response.success) {
      console.warn(`[extension-commands] extensions/list failed: ${response.error}`);
      return;
    }
    const data = response.data as { extensions?: ExtensionSummary[] } | undefined;
    setCommands(listExtensionSlashCommands(data?.extensions ?? []));
  }, [host]);

  useEffect(() => {
    if (!hostReady) return;
    void refresh();
  }, [hostReady, refresh]);

  useEffect(
    () =>
      host.subscribe((message) => {
        if (message.type === 'extension/catalog-updated') {
          setCommands(listExtensionSlashCommands(message.extensions));
        }
      }),
    [host],
  );

  return commands;
}

/** First extension wins a duplicated command name, matching Pi's registration order. */
export function listExtensionSlashCommands(
  extensions: readonly ExtensionSummary[],
): ComposerExtensionCommand[] {
  const seen = new Set<string>();
  const commands: ComposerExtensionCommand[] = [];
  for (const extension of extensions) {
    if (!extension.enabled) continue;
    for (const name of extension.compatibility?.capabilities?.commands ?? []) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      commands.push({ name, extensionId: extension.id, extensionName: extension.name });
    }
  }
  return commands;
}
