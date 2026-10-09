import type { BackendPermissionOption, HostCommand } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import { createPermissionModal } from './tui-modals.js';

const DOWN = '\x1b[B';
const ENTER = '\r';
const ESCAPE = '\x1b';

const OPTIONS: BackendPermissionOption[] = [
  { optionId: 'reject', label: 'No', kind: 'reject_once' },
  { optionId: 'always', label: 'Always allow', kind: 'allow_always' },
  { optionId: 'once', label: 'Allow once', kind: 'allow_once' },
];

function open(input: { backendOptions?: readonly BackendPermissionOption[] }) {
  const resolved: HostCommand[] = [];
  const modal = createPermissionModal({
    requestId: 'r1',
    title: 't',
    message: 'm',
    inProject: true,
    resolve: (command) => resolved.push(command),
    ...input,
  }) as unknown as { handleInput: (data: string) => void; render: (width: number) => string[] };
  return { modal, resolved };
}

describe('createPermissionModal', () => {
  it('answers piwin’s own choices with a remember scope', () => {
    const { modal, resolved } = open({});
    modal.handleInput(DOWN);
    modal.handleInput(ENTER);
    expect(resolved).toEqual([{ type: 'permission/resolve', requestId: 'r1', decision: 'allow', rememberScope: 'session' }]);
  });

  it('lists an agent’s choices as given, allows first, and answers by option id', () => {
    const { modal, resolved } = open({ backendOptions: OPTIONS });
    const text = modal.render(80).join('\n');
    expect(text.indexOf('Always allow')).toBeLessThan(text.indexOf('No'));
    modal.handleInput(ENTER);
    expect(resolved).toEqual([
      { type: 'permission/resolve', requestId: 'r1', decision: 'allow', backendOptionId: 'always' },
    ]);
  });

  it('answers a refusal from the agent’s list with the matching polarity', () => {
    const { modal, resolved } = open({ backendOptions: OPTIONS });
    modal.handleInput(DOWN);
    modal.handleInput(DOWN);
    modal.handleInput(ENTER);
    expect(resolved).toEqual([
      { type: 'permission/resolve', requestId: 'r1', decision: 'deny', backendOptionId: 'reject' },
    ]);
  });

  it('turns Escape into the agent’s own refusal, not a bare deny', () => {
    const { modal, resolved } = open({ backendOptions: OPTIONS });
    modal.handleInput(ESCAPE);
    expect(resolved).toEqual([
      { type: 'permission/resolve', requestId: 'r1', decision: 'deny', backendOptionId: 'reject' },
    ]);
  });
});
