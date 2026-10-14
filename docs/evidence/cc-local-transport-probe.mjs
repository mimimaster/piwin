#!/usr/bin/env node
// Verification fixture only: native CC mechanics, not subscription or Desktop UI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const executable = process.env.CC_PROBE_BIN ?? '/Volumes/BigDisk/npm-global/bin/claude';
const model = 'claude-haiku-4-5-20251001';
const command = "printf 'CC_TOOL_PROBE_OK\\n' > ./cc_tool_probe_out.txt";
const proof = { ok: false, checks: [], facts: {}, errors: [], modelRequests: 0 };
const processes = [];
const queue = [
  { kind: 'text', text: 'CC_TEXT_TURN_1' },
  { kind: 'tool' }, { kind: 'text', text: 'CC_AFTER_DENY' },
  { kind: 'tool' }, { kind: 'text', text: 'CC_AFTER_ALLOW' },
  { kind: 'hold' }, { kind: 'text', text: 'CC_AFTER_INTERRUPT' },
  { kind: 'text', text: 'CC_RESUME_TURN' },
];
let root;
let server;
let held;
let resumedHistory = false;
let holdClosed = false;
const json = JSON.stringify;
function check(label, condition) {
  assert(condition, label);
  proof.checks.push(label);
}
async function waitFor(predicate, label, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = predicate();
    if (result) return result;
    await sleep(25);
  }
  throw new Error(`timeout: ${label}`);
}
function event(response, type, data) {
  response.write(`event: ${type}\ndata: ${json({ type, ...data })}\n\n`);
}
function messageStart(response) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  event(response, 'message_start', { message: {
    id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model,
    content: [], stop_reason: null, stop_sequence: null,
    usage: { input_tokens: 8, output_tokens: 0 },
  } });
}
async function handleRequest(request, response) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(json({ data: [{ id: model }] }));
    return;
  }
  assert(request.method === 'POST' && request.url?.split('?')[0] === '/v1/messages', 'unexpected model endpoint');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    assert(bytes <= 4 * 1024 * 1024, 'mock request limit');
    chunks.push(chunk);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const fixture = queue.shift();
  assert(fixture, 'unexpected inference: fixture queue exhausted');
  proof.modelRequests++;
  if (fixture.text === 'CC_RESUME_TURN') {
    // Both original user and assistant evidence must survive, not just the new input.
    const userMessages = body.messages.filter(message => message.role === 'user');
    const assistantMessages = body.messages.filter(message => message.role === 'assistant');
    resumedHistory = userMessages.some(message => json(message.content).includes('FIRST_USER_SENTINEL')) &&
      assistantMessages.some(message => json(message.content).includes('CC_TEXT_TURN_1')) &&
      userMessages.some(message => json(message.content).includes('RESUME_USER_SENTINEL'));
  }
  messageStart(response);
  if (fixture.kind === 'hold') {
    held = response;
    event(response, 'content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    // Never send a final message: only native interrupt may disconnect this stream.
    const heartbeat = setInterval(() => response.write(': waiting\n\n'), 250);
    response.on('close', () => { holdClosed = true; clearInterval(heartbeat); });
    return;
  }
  if (fixture.kind === 'tool') {
    event(response, 'content_block_start', { index: 0, content_block: {
      type: 'tool_use', id: `toolu_${randomUUID()}`, name: 'Bash', input: {},
    } });
    event(response, 'content_block_delta', { index: 0, delta: {
      type: 'input_json_delta', partial_json: json({ command }),
    } });
  } else {
    event(response, 'content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    const middle = Math.floor(fixture.text.length / 2);
    for (const text of [fixture.text.slice(0, middle), fixture.text.slice(middle)]) {
      event(response, 'content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
    }
  }
  event(response, 'content_block_stop', { index: 0 });
  event(response, 'message_delta', { delta: {
    stop_reason: fixture.kind === 'tool' ? 'tool_use' : 'end_turn', stop_sequence: null,
  }, usage: { output_tokens: 16 } });
  event(response, 'message_stop', {});
  response.end();
}
function startProcess(env, cwd, resumeId) {
  const args = ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--verbose', '--include-partial-messages', '--await-initialize', '--bare', '--safe-mode',
    '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--permission-mode', 'manual', '--permission-prompt-tool', 'stdio', '--model', model];
  if (resumeId) args.push('--resume', resumeId);
  const child = spawn(executable, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  const state = { child, events: [], buffer: '', closed: false, error: null };
  processes.push(state);
  child.on('error', error => { state.error = error; });
  child.on('close', () => { state.closed = true; });
  child.stdin.on('error', error => { state.error = error; });
  child.stderr.resume(); // Never print native account/config details.
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    state.buffer += chunk;
    if (state.buffer.length > 2 * 1024 * 1024) { state.error = new Error('frame limit'); child.kill(); return; }
    let index;
    while ((index = state.buffer.indexOf('\n')) >= 0) {
      const line = state.buffer.slice(0, index);
      state.buffer = state.buffer.slice(index + 1);
      if (line.trim()) {
        try { state.events.push(JSON.parse(line)); }
        catch { state.error = new Error('non-JSON native stdout'); }
      }
    }
    if (state.events.length > 2000) { state.error = new Error('event limit'); child.kill(); }
  });
  state.write = value => {
    if (state.error) throw state.error;
    assert(!state.closed, 'native process already closed');
    child.stdin.write(json(value) + '\n');
  };
  state.wait = (predicate, from = 0) => waitFor(() => {
    if (state.error) throw state.error;
    const value = state.events.slice(from).find(predicate);
    if (!value && state.closed) throw new Error('native exited before expected event');
    return value;
  }, 'native event');
  state.control = async request => {
    const requestId = randomUUID();
    const from = state.events.length;
    state.write({ type: 'control_request', request_id: requestId, request });
    const result = await state.wait(value => value.type === 'control_response' && value.response?.request_id === requestId, from);
    assert.equal(result.response.subtype, 'success');
    return result.response.response;
  };
  state.user = text => state.write({ type: 'user', uuid: randomUUID(), parent_tool_use_id: null,
    message: { role: 'user', content: text } });
  return state;
}
async function closeProcess(state) {
  if (state.closed) return;
  state.child.stdin.end();
  state.child.kill('SIGTERM');
  try { await waitFor(() => state.closed, 'process close', 2000); }
  catch { state.child.kill('SIGKILL'); await waitFor(() => state.closed, 'process killed', 2000); }
}
async function textTurn(state, input, expected) {
  const from = state.events.length;
  state.user(input);
  const result = await state.wait(value => value.type === 'result', from);
  assert.equal(result.is_error, false);
  assert.equal(result.result, expected);
  return { result, events: state.events.slice(from) };
}
async function main() {
  try {
    root = await mkdtemp(join(tmpdir(), 'cc-local-probe-'));
    const cwd = join(root, 'cwd');
    const config = join(root, 'config');
    await mkdir(cwd); await mkdir(config);
    server = createServer((request, response) => {
      void handleRequest(request, response).catch(error => {
        proof.errors.push(error.message);
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const env = { PATH: process.env.PATH, HOME: root, TMPDIR: tmpdir(), LANG: 'en_US.UTF-8',
      CLAUDE_CONFIG_DIR: config, ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      ANTHROPIC_API_KEY: 'local-probe-only', ANTHROPIC_MODEL: model,
      DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_CODE_DISABLE_AUTOUPDATER: '1', NO_PROXY: '*', no_proxy: '*' };
    const native = startProcess(env, cwd);
    const catalog = await native.control({ subtype: 'initialize' });
    proof.facts.commands = catalog.commands?.length ?? 0;
    proof.facts.models = catalog.models?.length ?? 0;
    check('initialize catalogs', proof.facts.commands > 0 && proof.facts.models > 0);
    check('initialize sends no inference', proof.modelRequests === 0);
    await native.control({ subtype: 'interrupt' });
    check('idle interrupt receipt', true);
    const first = await textTurn(native, 'FIRST_USER_SENTINEL', 'CC_TEXT_TURN_1');
    const deltas = first.events.filter(value => value.type === 'stream_event' && value.event?.delta?.type === 'text_delta');
    check('real partial text deltas', deltas.length >= 2 && deltas.map(value => value.event.delta.text).join('') === 'CC_TEXT_TURN_1');
    proof.facts.partialTextDeltas = deltas.length;
    const sessionId = first.result.session_id;
    check('native session id', typeof sessionId === 'string' && sessionId.length > 0);
    const output = join(cwd, 'cc_tool_probe_out.txt');
    for (const behavior of ['deny', 'allow']) {
      const from = native.events.length;
      native.user(`Run Bash command exactly: ${command}`);
      const request = await native.wait(value => value.type === 'control_request' && value.request?.subtype === 'can_use_tool', from);
      check(`${behavior} real approval request`, typeof request.request_id === 'string' && request.request.tool_name === 'Bash' && typeof request.request.tool_use_id === 'string');
      native.write({ type: 'control_response', response: { subtype: 'success', request_id: request.request_id,
        response: behavior === 'allow' ? { behavior, updatedInput: request.request.input, toolUseID: request.request.tool_use_id }
          : { behavior, message: 'LOCAL_PROBE_DENIED', toolUseID: request.request.tool_use_id } } });
      const result = await native.wait(value => value.type === 'result', from);
      check(`${behavior} turn completion`, result.is_error === false && result.session_id === sessionId);
      if (behavior === 'deny') {
        await assert.rejects(readFile(output), error => error.code === 'ENOENT');
        check('deny prevents command write', true);
      } else check('allow executes command', await readFile(output, 'utf8') === 'CC_TOOL_PROBE_OK\n');
    }
    const interruptedFrom = native.events.length;
    native.user('HOLD_USER_SENTINEL');
    await waitFor(() => held, 'held inference started');
    await native.control({ subtype: 'interrupt' });
    await waitFor(() => holdClosed, 'native aborts held HTTP stream', 8000);
    check('interrupt aborts unfinished inference', holdClosed);
    await native.wait(value => value.type === 'result', interruptedFrom);
    const after = await textTurn(native, 'RECOVERY_USER_SENTINEL', 'CC_AFTER_INTERRUPT');
    check('same-process recovery', after.result.session_id === sessionId);
    await closeProcess(native);
    const resumed = startProcess(env, cwd, sessionId);
    await resumed.control({ subtype: 'initialize' });
    const replayed = await textTurn(resumed, 'RESUME_USER_SENTINEL', 'CC_RESUME_TURN');
    check('resume exact native session id', replayed.result.session_id === sessionId);
    check('resume retains prior user and assistant history', resumedHistory);
    check('all mock fixtures consumed', queue.length === 0);
    check('no mock handler errors', proof.errors.length === 0);
    proof.ok = true;
  } catch (error) { proof.errors.push(error.message); }
  finally {
    for (const state of processes) { try { await closeProcess(state); } catch (error) { proof.errors.push(error.message); proof.ok = false; } }
    held?.destroy();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (root) { try { await rm(root, { recursive: true, force: true }); } catch (error) { proof.errors.push(error.message); proof.ok = false; } }
  }
  console.log(json(proof));
  process.exitCode = proof.ok ? 0 : 1;
}
await main();
