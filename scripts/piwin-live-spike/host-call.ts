/**
 * WP1.1 — Host-shaped Codex Live call create (openai-codex token stays in-process).
 *
 * POST {base}/realtime/calls?intent=quicksilver&architecture=avas
 * Evidence: @howaboua/pi-codex-conversion voice path. Not Platform Realtime.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  formatSpikeLog,
  mapCaughtError,
  mapHttpStatus,
  type MappedSpikeErrorCode,
} from './redact.js';
import { buildCodexLiveHeaders, extractChatgptAccountId, readSpikeAccessToken } from './codex-auth.js';

const DEFAULT_MODEL = 'gpt-live-1-codex';
const DEFAULT_DEADLINE_MS = 15_000;
const DEFAULT_BASE = 'https://chatgpt.com/backend-api/codex';

/** Minimal SDP offer — enough to exercise HTTP create (not a live media offer). */
const FIXTURE_SDP = `v=0
o=- 4227147428 1719357865 IN IP4 127.0.0.1
s=-
c=IN IP4 0.0.0.0
t=0 0
a=group:BUNDLE 0 1
a=msid-semantic:WMS *
a=fingerprint:sha-256 CA:92:52:51:B4:91:3B:34:DD:9C:0B:FB:76:19:7E:3B:F1:21:0F:32:2C:38:01:72:5D:3F:78:C7:5F:8B:C7:36
m=audio 9 UDP/TLS/RTP/SAVPF 111 0 8
a=mid:0
a=ice-ufrag:kZ2qkHXX/u11
a=ice-pwd:uoD16Di5OGx3VbqgA3ymjEQV2kwiOjw6
a=setup:actpass
a=rtcp-mux
a=rtpmap:111 opus/48000/2
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
a=mid:1
a=sctp-port:5000
a=max-message-size:262144
`;

export type CreateCodexLiveCallResult =
  | {
      ok: true;
      durationMs: number;
      hasAnswerSdp: boolean;
      answerSdpLength: number;
      answerSdp: string;
    }
  | {
      ok: false;
      durationMs: number;
      mappedErrorCode: MappedSpikeErrorCode;
      httpStatus?: number;
    };

export function buildCodexLiveCallUrl(baseUrl = DEFAULT_BASE): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return `${normalized}/realtime/calls?intent=quicksilver&architecture=avas`;
}

export function buildCodexLiveCallBody(input: {
  sdp: string;
  instructions?: string;
  voice?: string;
}): string {
  return JSON.stringify({
    sdp: input.sdp,
    session: {
      model: DEFAULT_MODEL,
      instructions: input.instructions ?? 'You are a concise coding work session voice assistant.',
      audio: { output: { voice: input.voice ?? 'alloy' } },
      delegation: { type: 'client', ack_filler: true },
    },
  });
}

/**
 * Host-side create: access token never enters logs.
 */
export async function createCodexLiveCall(input: {
  sdp: string;
  accessToken: string;
  baseUrl?: string;
  instructions?: string;
  voice?: string;
  deadlineMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<CreateCodexLiveCallResult> {
  const deadlineMs = input.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  const started = Date.now();

  try {
    const accountId = extractChatgptAccountId(input.accessToken);
    if (!accountId) {
      return { ok: false, durationMs: Date.now() - started, mappedErrorCode: 'unauthorized' };
    }

    const headers = buildCodexLiveHeaders({
      accessToken: input.accessToken,
      accountId,
      sessionId: 'piwin-live-spike',
    });

    const response = await fetchImpl(buildCodexLiveCallUrl(input.baseUrl), {
      method: 'POST',
      headers,
      body: buildCodexLiveCallBody({
        sdp: input.sdp,
        ...(input.instructions ? { instructions: input.instructions } : {}),
        ...(input.voice ? { voice: input.voice } : {}),
      }),
      signal: controller.signal,
    });

    const durationMs = Date.now() - started;
    if (!response.ok) {
      await response.arrayBuffer().catch(() => undefined);
      return {
        ok: false,
        durationMs,
        mappedErrorCode: mapHttpStatus(response.status),
        httpStatus: response.status,
      };
    }

    const answerSdp = await response.text();
    return {
      ok: true,
      durationMs,
      hasAnswerSdp: answerSdp.trim().startsWith('v='),
      answerSdpLength: answerSdp.length,
      answerSdp,
    };
  } catch (error: unknown) {
    const durationMs = Date.now() - started;
    const mapped = mapCaughtError(error);
    return {
      ok: false,
      durationMs,
      mappedErrorCode: mapped === 'aborted' && durationMs >= deadlineMs - 50 ? 'timeout' : mapped,
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseArgs(argv: string[]): {
  dryRun: boolean;
  once: boolean;
  loop: number;
  servePort: number | null;
  sdpPath?: string;
} {
  let dryRun = false;
  let once = false;
  let loop = 0;
  let servePort: number | null = null;
  let sdpPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--once') once = true;
    else if (arg === '--loop') {
      loop = Number.parseInt(argv[index + 1] ?? '20', 10);
      index += 1;
    } else if (arg === '--serve') {
      servePort = Number.parseInt(argv[index + 1] ?? '8787', 10);
      index += 1;
    } else if (arg === '--sdp' && argv[index + 1]) {
      sdpPath = argv[index + 1];
      index += 1;
    }
  }
  if (!dryRun && !once && loop <= 0 && servePort === null) once = true;
  return { dryRun, once, loop, servePort, ...(sdpPath ? { sdpPath } : {}) };
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function startSpikeSessionServer(input: {
  port: number;
  accessToken: string;
}): Promise<{ close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    void handleSpikeRequest(req, res, input.accessToken);
  });

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(input.port, '127.0.0.1', () => {
      console.log(
        formatSpikeLog({
          event: 'serve',
          phase: 'listening',
          mappedErrorCode: 'ok',
          callIdHint: `127.0.0.1:${input.port}`,
        }),
      );
      resolvePromise({
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          }),
      });
    });
  });
}

async function handleSpikeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  accessToken: string,
): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST' || req.url?.split('?')[0] !== '/session') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not-found' }));
    return;
  }

  try {
    const offerSdp = await readRequestBody(req);
    if (!offerSdp.trim().startsWith('v=')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'protocol' }));
      return;
    }

    const result = await createCodexLiveCall({ sdp: offerSdp, accessToken });
    if (!result.ok) {
      console.log(
        formatSpikeLog({
          event: 'serve-create',
          phase: 'failed',
          durationMs: result.durationMs,
          mappedErrorCode: result.mappedErrorCode,
          ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
        }),
      );
      const status =
        result.mappedErrorCode === 'unauthorized'
          ? 401
          : result.mappedErrorCode === 'rate-limited'
            ? 429
            : 502;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: result.mappedErrorCode }));
      return;
    }

    console.log(
      formatSpikeLog({
        event: 'serve-create',
        phase: 'ok',
        durationMs: result.durationMs,
        mappedErrorCode: 'ok',
        hasAnswerSdp: result.hasAnswerSdp,
      }),
    );
    res.writeHead(201, { 'Content-Type': 'application/sdp' });
    res.end(result.answerSdp);
  } catch (error: unknown) {
    console.log(
      formatSpikeLog({
        event: 'serve-create',
        phase: 'failed',
        mappedErrorCode: mapCaughtError(error),
      }),
    );
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unknown' }));
  }
}

function loadSdp(sdpPath?: string): string {
  if (!sdpPath) return FIXTURE_SDP;
  return readFileSync(resolve(sdpPath), 'utf8');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.dryRun) {
    console.log(
      formatSpikeLog({
        event: 'dry-run',
        phase: 'skip-network',
        mappedErrorCode: 'ok',
        hasAnswerSdp: false,
      }),
    );
    const token = readSpikeAccessToken();
    console.log(
      formatSpikeLog({
        event: 'token-present',
        phase: 'env',
        mappedErrorCode: token ? 'ok' : 'missing-api-key',
      }),
    );
    if (token) {
      console.log(
        formatSpikeLog({
          event: 'account-id',
          phase: 'jwt',
          mappedErrorCode: extractChatgptAccountId(token) ? 'ok' : 'unauthorized',
        }),
      );
    }
    return;
  }

  const accessToken = readSpikeAccessToken();
  if (!accessToken) {
    console.log(
      formatSpikeLog({
        event: 'create-call',
        phase: 'failed',
        mappedErrorCode: 'missing-api-key',
      }),
    );
    process.exitCode = 2;
    return;
  }

  if (args.servePort !== null) {
    await startSpikeSessionServer({ port: args.servePort, accessToken });
    return;
  }

  const sdp = loadSdp(args.sdpPath);
  const iterations = args.loop > 0 ? args.loop : 1;
  let failures = 0;
  for (let i = 0; i < iterations; i += 1) {
    const result = await createCodexLiveCall({ sdp, accessToken });
    if (result.ok) {
      console.log(
        formatSpikeLog({
          event: 'create-call',
          phase: 'ok',
          durationMs: result.durationMs,
          mappedErrorCode: 'ok',
          hasAnswerSdp: result.hasAnswerSdp,
        }),
      );
    } else {
      failures += 1;
      console.log(
        formatSpikeLog({
          event: 'create-call',
          phase: 'failed',
          durationMs: result.durationMs,
          mappedErrorCode: result.mappedErrorCode,
          ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
        }),
      );
    }
  }

  if (failures > 0) process.exitCode = 1;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return entry.endsWith('host-call.ts') || entry.endsWith('host-call.js');
  }
}

if (isDirectRun()) {
  void main();
}
