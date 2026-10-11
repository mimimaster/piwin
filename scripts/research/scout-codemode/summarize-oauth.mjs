import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { summarizeNativeSession } from './native-sessions.mjs';
const output = resolve(process.argv[2] ?? join(import.meta.dirname, '../../../docs/research/scout-codemode-oauth-2026-10-11'));
const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
const filenames = (await readdir(output)).filter(name => /^\d{2}-.*\.json$/.test(name)).sort();
const runs = await Promise.all(filenames.map(async name => JSON.parse(await readFile(join(output, name), 'utf8'))));
let recovered = [];
try { recovered = await Promise.all((await readdir(join(output, 'native-recovery'))).map(async name => JSON.parse(await readFile(join(output, 'native-recovery', name), 'utf8')))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const addUsage = usages => {
  if (!usages.length || usages.some(usage => !usage)) return null;
  return Object.fromEntries(['promptTokens','completionTokens','cacheReadTokens','cacheWriteTokens','reasoningTokens','totalTokens'].map(key => [key,
    usages.every(usage => typeof usage[key] === 'number') ? usages.reduce((total, usage) => total + usage[key], 0) : null]));
};
const metrics = runs.map(run => {
  const native = run.nativeSessions ?? recovered.find(evidence => evidence.index.sessions.some(session => session.id === run.sessionId));
  const controlRuns = run.events.flatMap(row => row.event.presentation?.subagentControl?.runs ?? []);
  const scouts = native?.index.sessions.filter(session => session.parentSessionId === run.sessionId && session.subagentRole === 'scout') ?? [];
  const scoutIds = [...new Set([...scouts.map(session => session.id), ...controlRuns.map(row => row.childSessionId).filter(Boolean)])];
  const summaries = native?.sessions.map(summarizeNativeSession) ?? [];
  // Match main Pi usage to independently observed SSE total, rather than
  // assuming file order maps RPC sessions to product session IDs.
  const mainCandidates = summaries.filter(summary => summary.complete && summary.usage?.totalTokens === run.mainObservedUsage?.totalTokens);
  const mainNative = mainCandidates.length === 1 ? mainCandidates[0] : null;
  const children = mainNative ? summaries.filter(summary => summary !== mainNative) : [];
  const scoutComplete = children.length === scoutIds.length && scoutIds.length > 0 && children.every(summary => summary.complete && summary.usage);
  const mainUsage = run.mainObservedUsage ? {
    promptTokens: Number.isFinite(run.mainObservedUsage.cacheReadTokens) ? run.mainObservedUsage.promptTokensIncludingCache - run.mainObservedUsage.cacheReadTokens : null,
    completionTokens: run.mainObservedUsage.completionTokens, cacheReadTokens: run.mainObservedUsage.cacheReadTokens,
    cacheWriteTokens: run.mainObservedUsage.cacheWriteTokens, reasoningTokens: run.mainObservedUsage.reasoningTokens,
    totalTokens: run.mainObservedUsage.totalTokens,
  } : null;
  const scoutUsage = scoutComplete ? addUsage(children.map(summary => summary.usage)) : null;
  const totalUsage = addUsage([mainUsage, scoutUsage]);
  const starts = run.events.filter(row => row.sessionId === run.sessionId && row.event.type === 'tool/start');
  const mainCodemode = starts.filter(row => row.event.toolName === 'piwin_codemode').length;
  const allComplete = !!mainNative && scoutComplete;
  const nativeTools = allComplete ? summaries.flatMap(summary => summary.tools) : null;
  const nativeResults = allComplete ? summaries.flatMap(summary => summary.results) : null;
  const nested = allComplete ? summaries.flatMap(summary => summary.nested) : null;
  const codemodeResults = nativeResults?.filter(result => result.toolName === 'piwin_codemode') ?? [];
  const nestedComplete = codemodeResults.every(result => result.details?.invocationLocalStore === true);
  const totalCodemode = nativeTools ? nativeTools.filter(tool => tool.name === 'piwin_codemode').length : (run.group === 'A' ? 0 : null);
  return {
    ordinal: run.ordinal, taskId: run.taskId, group: run.group, repetition: run.repetition,
    status: run.status, elapsedMs: run.elapsedMs, correct: run.validation.passed, acceptanceFailures: run.validation.failures,
    mainUsage, scoutUsage, totalUsage, scoutCount: scoutIds.length || null, scoutSessionIds: scoutIds,
    mainToolCalls: starts.length, scoutToolCalls: scoutComplete ? children.reduce((total, summary) => total + summary.tools.length, 0) : null,
    toolCalls: nativeTools?.length ?? null, mainCodemodeCalls: mainCodemode, codemodeCalls: totalCodemode,
    codemodeFailures: nativeResults ? nativeResults.filter(result => result.toolName === 'piwin_codemode' && result.isError).length : (run.group === 'A' ? 0 : null),
    nestedCallCount: totalCodemode === 0 ? 0 : (allComplete && nestedComplete ? nested.length : null),
    observedNestedCallCount: nested?.length ?? null,
    executedToolCalls: nativeTools && (totalCodemode === 0 || nestedComplete) ? nativeTools.length + nested.length : null,
    toolFailures: nativeResults ? nativeResults.filter(result => result.isError).length : null,
    mainToolFailures: run.events.filter(row => row.sessionId === run.sessionId && row.event.type === 'tool/end' && row.event.isError).length,
    mainModelRetryAttempts: run.events.filter(row => row.sessionId === run.sessionId && row.event.type === 'model/retry' && row.event.phase === 'attempting').length, allModelRetryAttempts: null, toolRetryAttempts: null, upstreamInternalRetries: null,
    evidence: { rawFile: filenames[runs.indexOf(run)], nativeRecoveryRoot: native?.root ?? null, mainSseMatchesNative: !!mainNative,
      scoutUsageComplete: scoutComplete, originalChildEventGap: !run.nativeSessions, sourceUnchanged: run.sourceUnchanged,
      configHash: run.configHashWithoutCodemodeEnabled, promptHash: run.promptHash, snapshotHash: run.snapshotHash },
  };
});
await writeFile(join(output, 'metrics.json'), JSON.stringify({ measurementNotes: {
  authoritative: 'These corrected metrics take precedence over original scoutCount/tool totals in raw capture files.',
  main: 'Actual xAI Responses SSE usage, reconciled with Host finalized usage and native Pi where available.',
  scout: 'Actual provider-normalized Pi assistant usage in completed RPC sessions; no estimation.',
  cache: 'promptTokens is uncached; cacheRead counted once in totalTokens; reasoning is output subset; cacheWrite unknown because xAI did not report it.',
  gap: 'The executing original recorder omitted subagent/stream. Passive native recovery began during attempt 6. Attempts 1–5 have unknown Scout and full-task tokens. No task was rerun.',
  retries: 'Main retry events observed; Scout/provider internal/model-selected tool retries not reliably measured, left unknown.',
}, runs: metrics }, null, 2));
const columns = ['ordinal','taskId','group','repetition','status','correct','elapsedMs','mainTokens','scoutTokens','totalTokens','mainUncachedInput','scoutUncachedInput','mainCacheRead','scoutCacheRead','mainOutput','scoutOutput','mainReasoning','scoutReasoning','cacheWrite','scoutCount','mainToolCalls','scoutToolCalls','toolCalls','mainCodemodeCalls','codemodeCalls','codemodeFailures','nestedCallCount','observedNestedCallCount','executedToolCalls','toolFailures','mainModelRetryAttempts','allModelRetryAttempts','toolRetryAttempts','upstreamInternalRetries'];
const rows = metrics.map(row => ({ ...row, mainTokens: row.mainUsage?.totalTokens, scoutTokens: row.scoutUsage?.totalTokens, totalTokens: row.totalUsage?.totalTokens,
  mainUncachedInput: row.mainUsage?.promptTokens, scoutUncachedInput: row.scoutUsage?.promptTokens, mainCacheRead: row.mainUsage?.cacheReadTokens, scoutCacheRead: row.scoutUsage?.cacheReadTokens,
  mainOutput: row.mainUsage?.completionTokens, scoutOutput: row.scoutUsage?.completionTokens, mainReasoning: row.mainUsage?.reasoningTokens, scoutReasoning: row.scoutUsage?.reasoningTokens, cacheWrite: null }));
await writeFile(join(output, 'runs.csv'), [columns.join(','), ...rows.map(row => columns.map(column => row[column] ?? 'unknown').join(','))].join('\n')+'\n');
const mean = (rows, getter) => rows.length && rows.every(row => Number.isFinite(getter(row))) ? rows.reduce((total, row) => total + getter(row), 0) / rows.length : null;
const stats = manifest.tasks.map(task => ({ task: task.id, ...Object.fromEntries(['A','B'].map(group => {
  const rows = metrics.filter(row => row.taskId === task.id && row.group === group);
  return [group, { attempts: rows.length, correct: rows.filter(row => row.correct).length, meanMs: mean(rows, row => row.elapsedMs),
    tokenComplete: rows.filter(row => row.totalUsage).length, meanTokens: mean(rows, row => row.totalUsage?.totalTokens),
    codemodeCalls: rows.every(row => Number.isFinite(row.codemodeCalls)) ? rows.reduce((total,row)=>total+row.codemodeCalls,0) : null }];
})) }));
await writeFile(join(output, 'comparison.json'), JSON.stringify(stats, null, 2));
console.log(JSON.stringify(stats, null, 2));
