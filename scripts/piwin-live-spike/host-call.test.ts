import { createCodexLiveCall, buildCodexLiveCallUrl, buildCodexLiveCallBody } from './host-call.js';
import { extractChatgptAccountId, buildCodexLiveHeaders } from './codex-auth.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Synthetic JWT with chatgpt_account_id claim (not a real credential). */
function fakeJwt(accountId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_account_id: accountId },
    }),
  ).toString('base64url');
  return `${header}.${payload}.sig`;
}

async function run(): Promise<void> {
  assert(buildCodexLiveCallUrl().includes('intent=quicksilver'), 'url intent');
  assert(buildCodexLiveCallUrl().includes('architecture=avas'), 'url arch');
  assert(!buildCodexLiveCallUrl().includes('api.openai.com'), 'not platform');

  const body = JSON.parse(buildCodexLiveCallBody({ sdp: 'v=0\n' })) as {
    session: { model: string; delegation: { type: string } };
  };
  assert(body.session.model === 'gpt-live-1-codex', 'model');
  assert(body.session.delegation.type === 'client', 'delegation');

  const token = fakeJwt('acct_test_123');
  assert(extractChatgptAccountId(token) === 'acct_test_123', 'account id');
  const headers = buildCodexLiveHeaders({
    accessToken: token,
    accountId: 'acct_test_123',
    sessionId: 's1',
  });
  assert(headers['openai-alpha'] === 'quicksilver=v2', 'alpha');
  assert(headers['chatgpt-account-id'] === 'acct_test_123', 'header account');
  assert(headers.originator === 'pi', 'originator');
  assert(headers['user-agent'] === 'pi-codex-conversion', 'user-agent');

  const ok = await createCodexLiveCall({
    sdp: 'v=0\n',
    accessToken: token,
    fetchImpl: async () =>
      new Response('v=0\no=- 1 1 IN IP4 0.0.0.0\ns=-\nt=0 0\n', { status: 201 }),
  });
  assert(ok.ok === true, 'ok create');

  const unauthorized = await createCodexLiveCall({
    sdp: 'v=0\n',
    accessToken: token,
    fetchImpl: async () => new Response('nope', { status: 401 }),
  });
  assert(unauthorized.ok === false, '401');
  if (!unauthorized.ok) {
    assert(unauthorized.mappedErrorCode === 'unauthorized', '401 mapped');
  }

  console.log(JSON.stringify({ event: 'host-call-test', phase: 'ok' }));
}

void run();
