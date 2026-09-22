/**
 * The bootstrap's failure channel, executed rather than pattern-matched.
 *
 * The reported case was an artifact whose only inline script had a duplicate
 * `const`. A SyntaxError kills the whole script before a line runs, so the
 * author's own "enable JavaScript" placeholder stayed on screen and read as
 * the platform blocking scripts. The frame now says what actually happened.
 */
import { describe, expect, it } from 'vitest';
import { ARTIFACT_BRIDGE_ERROR_TYPE, ARTIFACT_ERROR_REPORT_BUDGET } from './constants.js';
import { parseArtifactErrorMessage } from './bridge-protocol.js';
import { createMeasuredRoot, runBridgeSession } from './srcdoc-bridge-test-harness.js';

type Posted = { type?: string } & Record<string, unknown>;

function errorReports(messages: readonly Posted[]) {
  return messages
    .filter((message) => message.type === ARTIFACT_BRIDGE_ERROR_TYPE)
    .map((message) => parseArtifactErrorMessage(message));
}

describe('artifact bridge failure channel', () => {
  it('reports a script error with its name and position', () => {
    const session = runBridgeSession(createMeasuredRoot(120));
    session.dispatchWindowEvent('error', {
      message: "Uncaught SyntaxError: Identifier 'TEA' has already been declared",
      lineno: 155,
      colno: 7,
      error: { name: 'SyntaxError' },
    });

    const reports = errorReports(session.postedMessages as Posted[]);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      kind: 'script',
      name: 'SyntaxError',
      line: 155,
      column: 7,
    });
    expect(reports[0]?.message).toContain("Identifier 'TEA' has already been declared");
  });

  it('reports an unhandled rejection', () => {
    const session = runBridgeSession(createMeasuredRoot(120));
    session.dispatchWindowEvent('unhandledrejection', {
      reason: { name: 'TypeError', message: 'ctx is null' },
    });

    const reports = errorReports(session.postedMessages as Posted[]);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ kind: 'rejection', name: 'TypeError' });
    expect(reports[0]?.message).toBe('ctx is null');
  });

  it('survives an error event with nothing useful on it', () => {
    const session = runBridgeSession(createMeasuredRoot(120));
    session.dispatchWindowEvent('error', {});
    const reports = errorReports(session.postedMessages as Posted[]);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toBe('Script error');
    expect(reports[0]?.line).toBeUndefined();
  });

  it('stops reporting past its budget so a throwing render loop cannot flood', () => {
    const session = runBridgeSession(createMeasuredRoot(120));
    for (let index = 0; index < ARTIFACT_ERROR_REPORT_BUDGET + 20; index += 1) {
      session.dispatchWindowEvent('error', { message: `frame ${index} failed` });
    }
    expect(errorReports(session.postedMessages as Posted[])).toHaveLength(
      ARTIFACT_ERROR_REPORT_BUDGET,
    );
  });

  it('clips a huge message before it crosses the boundary', () => {
    const session = runBridgeSession(createMeasuredRoot(120));
    session.dispatchWindowEvent('error', { message: 'x'.repeat(10_000) });
    const reports = errorReports(session.postedMessages as Posted[]);
    expect(reports[0]?.message.length).toBeLessThan(500);
  });

  it('does not report anything when the artifact behaves', () => {
    const session = runBridgeSession(createMeasuredRoot(120));
    session.remeasure();
    expect(errorReports(session.postedMessages as Posted[])).toHaveLength(0);
  });
});
