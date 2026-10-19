import type { AuthPromptPayload } from '@piwin/contracts';
import type { SubscriptionAuthPort } from '@piwin/agent-host';

export type SubscriptionAuthServiceOptions = {
  piwinRoot?: string;
  piAgentDir?: string;
  port?: SubscriptionAuthPort;
  now?: () => number;
  /** Pi CLI opens the auth URL itself. Host must do the same on this machine. */
  openAuthUrl?: (url: string) => void;
};

type PendingPrompt = {
  promptId: string;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
};

export type ActiveLogin = {
  loginId: string;
  providerId: string;
  ownerDeviceId: string;
  startedAt: string;
  preferLoopback: boolean;
  openAuthUrlOnHost: boolean;
  abort: AbortController;
  currentPrompt?: AuthPromptPayload;
  authUrl?: AuthPromptPayload;
  pending?: PendingPrompt;
  newChannelId?: string;
};

