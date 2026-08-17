import type { HostCommand, HostResponse } from '@piwin/contracts';

export type DoccardsHostRequest = (
  command: Extract<
    HostCommand,
    {
      type:
        | 'doccards/scan-folder'
        | 'doccards/index-folder'
        | 'doccards/index-status'
        | 'doccards/cancel-index'
        | 'doccards/generate'
        | 'doccards/generation-status'
        | 'doccards/cancel-generation'
        | 'doccards/list-by-folder'
        | 'doccards/retrieve'
        | 'doccards/open-source'
        | 'doccards/forget-folder'
        | 'config/get'
        | 'flashcards/rate';
    }
  >,
) => Promise<HostResponse>;
