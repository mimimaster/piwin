import { describe, expect, it, vi } from 'vitest';
import { runSubagentResult, runSubagentResults } from './subagent-result-command.js';

describe('runSubagentResults / runSubagentResult', () => {
  it('sends subagent/results for a parent session', async () => {
    const handleCommand = vi.fn(async () => ({
      type: 'response' as const,
      command: 'subagent/results',
      success: true as const,
      data: { results: [] },
    }));
    const lines: string[] = [];
    await runSubagentResults({ handleCommand }, 'session-1', (line) => {
      lines.push(line);
    });
    expect(handleCommand).toHaveBeenCalledWith({
      type: 'subagent/results',
      parentSessionId: 'session-1',
    });
    expect(lines[0]).toContain('no subagent results');
  });

  it('sends subagent/result by resultId', async () => {
    const handleCommand = vi.fn(async () => ({
      type: 'response' as const,
      command: 'subagent/result',
      success: true as const,
      data: {
        resultId: 'r1',
        revision: 1,
        deliveryIntent: 'integrate',
        integrationStatus: 'applied',
      },
    }));
    const lines: string[] = [];
    await runSubagentResult({ handleCommand }, 'r1', (line) => {
      lines.push(line);
    });
    expect(handleCommand).toHaveBeenCalledWith({ type: 'subagent/result', resultId: 'r1' });
    expect(lines[0]).toContain('r1');
  });
});
