import type {
  LiveClientBootstrapInput,
  LiveOwnerBootstrap,
  LiveProviderDescriptor,
} from '@piwin/contracts';

export type LiveSettingsValidation =
  | { ok: true; normalized: Readonly<Record<string, string>> }
  | { ok: false; field?: string; message: string };

export type LiveProviderStartResult = {
  voiceModelId: string;
  ownerBootstrap: LiveOwnerBootstrap;
  close: () => Promise<void>;
};

export type LiveProviderRegistration = {
  descriptor(): LiveProviderDescriptor;
  /** Optional: refresh dynamic setting options before schema/start. */
  refresh?(): Promise<void>;
  authReady(): Promise<boolean>;
  validateSettings(values: Readonly<Record<string, string>>): LiveSettingsValidation;
  start(input: {
    callId: string;
    sessionId: string;
    settings: Readonly<Record<string, string>>;
    clientBootstrap: LiveClientBootstrapInput;
    signal: AbortSignal;
  }): Promise<LiveProviderStartResult>;
};
