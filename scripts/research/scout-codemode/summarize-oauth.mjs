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
  const summaries = native?.sessions.map(session => ({ ...summarizeNativeSession(session), file: session.file })) ?? [];
  // Match main Pi usage to independently observed SSE total, rather than
  // assuming file order maps RPC sessions to product session IDs.
  const mainCandidates = summaries.filter(summary => run.mainObservedUsage && summary.recordedUsage?.totalTokens === run.mainObservedUsage.totalTokens);
  const mainNative = mainCandidates.length === 1 ? mainCandidates[0] : (summaries.find(summary => summary.file === run.mainNativeSessionFile) ?? null);
  const children = mainNative ? summaries.filter(summary => summary !== mainNative) : [];
  const scoutComplete = children.length === scoutIds.length && scoutIds.length > 0 && children.every(summary => summary.complete && Number.isFinite(summary.usage?.totalTokens));
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
  const toolsCaptured = !!mainNative && children.length === scoutIds.length;
  const nativeTools = toolsCaptured ? summaries.flatMap(summary => summary.tools) : null;
  const nativeResults = toolsCaptured ? summaries.flatMap(summary => summary.results) : null;
  const nested = toolsCaptured ? summaries.flatMap(summary => summary.nested) : null;
  const codemodeResults = nativeResults?.filter(result => result.toolName === 'piwin_codemode') ?? [];
  const nestedComplete = codemodeResults.every(result => result.details?.invocationLocalStore === true);
  const totalCodemode = nativeTools ? nativeTools.filter(tool => tool.name === 'piwin_codemode').length : (run.group === 'A' ? 0 : null);
  return {
    ordinal: run.ordinal, taskId: run.taskId, group: run.group, repetition: run.repetition,
    status: run.status, validProtocol: !run.status.startsWith('invalid-'), elapsedMs: run.status === 'timeout' ? (run.endToEndElapsedMs ?? null) : run.elapsedMs, deadlineElapsedMs: run.status === 'timeout' ? run.elapsedMs : null, correct: run.validation.passed, officialScore: run.validation.officialScore ?? null, acceptanceFailures: run.validation.failures,
    mainUsage, scoutUsage, totalUsage,
    mainRecordedUsageLowerBound: mainNative?.recordedUsage ?? null,
    scoutSessions: children.map(summary => ({ nativeFile: summary.file, complete: summary.complete, usage: summary.usage, recordedUsageLowerBound: summary.recordedUsage })),
    scoutCount: native ? scoutIds.length : null, scoutSessionIds: scoutIds,
    mainToolCalls: starts.length, scoutToolCalls: toolsCaptured ? children.reduce((total, summary) => total + summary.tools.length, 0) : null,
    toolCalls: nativeTools?.length ?? null, mainCodemodeCalls: mainCodemode, codemodeCalls: totalCodemode,
    codemodeFailures: nativeResults ? nativeResults.filter(result => result.toolName === 'piwin_codemode' && result.isError).length : (run.group === 'A' ? 0 : null),
    nestedCallCount: totalCodemode === 0 ? 0 : (toolsCaptured && nestedComplete ? nested.length : null),
    observedNestedCallCount: nested?.length ?? null,
    executedToolCalls: nativeTools && (totalCodemode === 0 || nestedComplete) ? nativeTools.length + nested.length : null,
    failedModelResponses: native ? native.sessions.flatMap(session => session.records).filter(record => record.role === 'assistant' && ['error', 'aborted'].includes(record.stopReason)).length : null,
    toolFailures: nativeResults ? nativeResults.filter(result => result.isError).length : null,
    mainToolFailures: run.events.filter(row => row.sessionId === run.sessionId && row.event.type === 'tool/end' && row.event.isError).length,
    mainModelRetryAttempts: run.eventsRecoveredFromNative ? null : run.events.filter(row => row.sessionId === run.sessionId && row.event.type === 'model/retry' && row.event.phase === 'attempting').length, allModelRetryAttempts: run.nativeSessions && !run.eventsRecoveredFromNative ? (run.modelRetryAttempts ?? null) : null, toolRetryAttempts: null, upstreamInternalRetries: null,
    evidence: { rawFile: filenames[runs.indexOf(run)], nativeRecoveryRoot: native?.root ?? null, mainSseMatchesNative: mainCandidates.length === 1,
      scoutUsageComplete: scoutComplete, originalChildEventGap: !run.nativeSessions, sourceUnchanged: run.sourceUnchanged,
      configHash: run.configHashWithoutCodemodeEnabled, promptHash: run.promptHash, snapshotHash: run.snapshotHash },
  };
});
await writeFile(join(output, 'metrics.json'), JSON.stringify({ measurementNotes: {
  authoritative: 'These corrected metrics take precedence over original scoutCount/tool totals in raw capture files.',
  timing: 'Completed runs measure prompt submission to observed primary terminal. Legacy timeout raw elapsedMs measures deadline detection only; normalized full end-to-end time is unknown, with deadlineElapsedMs reported separately.',
  incomplete: 'Interrupted/aborted native recordedUsageLowerBound sums only observed usage; incomplete response or provider billing remains unknown. It is never used as full-task token savings.',
  main: 'Actual xAI Responses SSE usage, reconciled with Host finalized usage and native Pi where available.',
  scout: 'Actual provider-normalized Pi assistant usage in completed RPC sessions; no estimation.',
  cache: 'promptTokens is uncached; cacheRead counted once in totalTokens; reasoning is output subset; cacheWrite unknown because xAI did not report it.',
  interruption: runs.some(run => run.eventsRecoveredFromNative) ? 'Interrupted protocol-violation attempts have recovered native tool evidence, completed-request token lower bound only, and unknown exact elapsed/retries; excluded from valid A/B means.' : null,
  gap: runs.some(run => run.eventsRecoveredFromNative) ? 'Interrupted attempts have reconstructed native evidence, not full streaming capture. Normal completed/timeout attempts preserve subagent/stream plus native SDK/RPC evidence; per-run completeness is explicit.' : (runs.every(run => run.nativeSessions) ? 'Full subagent/stream capture plus native SDK/RPC evidence saved before cleanup.' : 'Legacy recorder omitted subagent/stream. Passive native recovery began during attempt 6. Attempts 1–5 have unknown Scout and full-task tokens; no reruns.'),
  retries: 'Observed main/Scout retry events are counted when full child capture exists; provider-internal/model-selected tool retries remain unknown.',
}, runs: metrics }, null, 2));
const columns = ['ordinal','taskId','group','repetition','status','validProtocol','correct','officialScore','elapsedMs','deadlineElapsedMs','mainTokens','scoutTokens','totalTokens','mainUncachedInput','scoutUncachedInput','mainCacheRead','scoutCacheRead','mainOutput','scoutOutput','mainReasoning','scoutReasoning','cacheWrite','scoutCount','mainToolCalls','scoutToolCalls','toolCalls','mainCodemodeCalls','codemodeCalls','codemodeFailures','nestedCallCount','observedNestedCallCount','executedToolCalls','toolFailures','failedModelResponses','mainModelRetryAttempts','allModelRetryAttempts','toolRetryAttempts','upstreamInternalRetries'];
const rows = metrics.map(row => ({ ...row, mainTokens: row.mainUsage?.totalTokens, scoutTokens: row.scoutUsage?.totalTokens, totalTokens: row.totalUsage?.totalTokens,
  mainUncachedInput: row.mainUsage?.promptTokens, scoutUncachedInput: row.scoutUsage?.promptTokens, mainCacheRead: row.mainUsage?.cacheReadTokens, scoutCacheRead: row.scoutUsage?.cacheReadTokens,
  mainOutput: row.mainUsage?.completionTokens, scoutOutput: row.scoutUsage?.completionTokens, mainReasoning: row.mainUsage?.reasoningTokens, scoutReasoning: row.scoutUsage?.reasoningTokens, cacheWrite: null }));
await writeFile(join(output, 'runs.csv'), [columns.join(','), ...rows.map(row => columns.map(column => row[column] ?? 'unknown').join(','))].join('\n')+'\n');
const mean = (rows, getter) => rows.length && rows.every(row => Number.isFinite(getter(row))) ? rows.reduce((total, row) => total + getter(row), 0) / rows.length : null;
const stats = manifest.tasks.map(task => ({ task: task.id, ...Object.fromEntries(['A','B'].map(group => {
  const attempts = metrics.filter(row => row.taskId === task.id && row.group === group);
  const rows = attempts.filter(row => row.validProtocol);
  return [group, { attempts: attempts.length, validAttempts: rows.length, invalidAttempts: attempts.length - rows.length, timeouts: rows.filter(row => row.status === 'timeout').length, correct: rows.filter(row => row.correct).length, meanOfficialScore: mean(rows, row => row.officialScore), meanMs: mean(rows, row => row.elapsedMs),
    tokenComplete: rows.filter(row => Number.isFinite(row.totalUsage?.totalTokens)).length, meanTokens: mean(rows, row => row.totalUsage?.totalTokens),
    codemodeCalls: rows.every(row => Number.isFinite(row.codemodeCalls)) ? rows.reduce((total,row)=>total+row.codemodeCalls,0) : null }];
})) }));
await writeFile(join(output, 'comparison.json'), JSON.stringify(stats, null, 2));
console.log(JSON.stringify(stats, null, 2));
