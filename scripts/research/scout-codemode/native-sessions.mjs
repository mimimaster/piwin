import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { walkFiles } from './tasks.mjs';

// Pi persists provider-normalized usage for SDK and RPC workers. Keep only
// measurement/tool evidence, without credentials, request headers, or costs.
export async function readNativeSessions(root) {
  const index = JSON.parse(await readFile(join(root, 'sessions-index/index.json'), 'utf8'));
  const files = (await walkFiles(join(root, 'pi-agent/sessions'))).filter(path => path.endsWith('.jsonl'));
  const sessions = [];
  for (const path of files) {
    const records = [];
    for (const line of (await readFile(path, 'utf8')).split('\n').filter(Boolean)) {
      let row; try { row = JSON.parse(line); } catch { continue; } // Last append may still be incomplete.
      const message = row.message;
      if (row.type === 'session') records.push({ type: row.type, id: row.id, timestamp: row.timestamp });
      if (message?.role === 'assistant') {
        const usage = message.usage ? Object.fromEntries(Object.entries(message.usage).filter(([key]) => key !== 'cost')) : undefined;
        records.push({ type: row.type, id: row.id, timestamp: row.timestamp, role: message.role,
          model: message.model, usage, stopReason: message.stopReason, errorMessage: message.errorMessage,
          toolCalls: message.content?.filter(content => content.type === 'toolCall') });
      }
      if (message?.role === 'toolResult') records.push({ type: row.type, id: row.id, timestamp: row.timestamp,
        role: message.role, toolName: message.toolName, toolCallId: message.toolCallId,
        isError: message.isError, details: message.details });
    }
    sessions.push({ file: basename(path), records });
  }
  return { root: basename(root), capturedAt: new Date().toISOString(), index, sessions };
}

export function summarizeNativeSession(session) {
  const assistants = session.records.filter(record => record.role === 'assistant');
  const last = assistants.at(-1);
  const complete = !!last && last.stopReason === 'stop';
  const sum = key => assistants.every(record => Number.isFinite(record.usage?.[key]))
    ? assistants.reduce((total, record) => total + record.usage[key], 0) : null;
  const recordedUsage = { promptTokens: sum('input'), completionTokens: sum('output'), cacheReadTokens: sum('cacheRead'),
    cacheWriteTokens: null, reasoningTokens: sum('reasoning'), totalTokens: sum('totalTokens') };
  const usage = complete ? recordedUsage : null;
  // Pi populates cacheWrite=0 even when xAI does not report this category.
  const tools = assistants.flatMap(record => record.toolCalls ?? []);
  const results = session.records.filter(record => record.role === 'toolResult');
  const codemode = tools.filter(tool => tool.name === 'piwin_codemode');
  const nested = results.filter(record => record.details?.invocationLocalStore === true).flatMap(record => record.details.calls ?? []);
  return { complete, requests: assistants.length, usage, recordedUsage, tools, results, codemode, nested };
}

export function sumLedger(records) {
  if (!records.length || records.some(record => record.source !== 'assistant-usage')) return null;
  const keys = ['promptTokens', 'completionTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens', 'reasoningTokens'];
  return Object.fromEntries(keys.map(key => [key, records.every(record => typeof record[key] === 'number')
    ? records.reduce((total, record) => total + record[key], 0) : null]));
}
