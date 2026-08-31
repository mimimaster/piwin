// Browser-safe shared wire adapter; Desktop and Mobile speak the same protocol.
export {
  parseLiveChannelMessage,
  buildDelegationAckPayload,
  buildContextAppendPayloads,
  LIVE_CONTEXT_APPEND_CHUNK_BYTES,
} from '@piwin/voice/wire';
