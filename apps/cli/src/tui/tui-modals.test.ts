import type { BackendPermissionOption, HostCommand } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import { TuiModalStack, createPermissionModal } from './tui-modals.js';

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

describe('TuiModalStack requests answered elsewhere', () => {
  function stack() {
    const shown: Array<{ hidden: boolean }> = [];
    const tui = {
      showOverlay: () => {
        const handle = { hidden: false, hide: () => (handle.hidden = true) };
        shown.push(handle);
        return handle;
      },
      requestRender: () => undefined,
      setFocus: () => undefined,
    };
    const modals = new TuiModalStack(tui as never, {} as never, () => undefined);
    return { modals, shown };
  }
  const open = (modals: TuiModalStack, key: string) => () => modals.show({ render: () => [], invalidate: () => undefined });

  it('takes down the dialog that is open when its request was answered on another shell', () => {
    const { modals, shown } = stack();
    modals.enqueue('permission:r1', open(modals, 'r1'));
    modals.pump();
    expect(modals.isOpen).toBe(true);
    modals.drop('permission:r1');
    expect(modals.isOpen).toBe(false);
    expect(shown[0]?.hidden).toBe(true);
  });

  it('moves on to the next waiting request when the open one is dropped', () => {
    const { modals, shown } = stack();
    modals.enqueue('permission:r1', open(modals, 'r1'));
    modals.enqueue('permission:r2', open(modals, 'r2'));
    modals.pump();
    modals.drop('permission:r1');
    expect(shown).toHaveLength(2);
    expect(modals.isOpen).toBe(true);
  });

  it('does not queue a request again while its dialog is open', () => {
    const { modals, shown } = stack();
    modals.enqueue('permission:r1', open(modals, 'r1'));
    modals.pump();
    modals.enqueue('permission:r1', open(modals, 'r1'));
    modals.close();
    expect(shown).toHaveLength(1);
  });

  it('leaves a dialog the person opened alone when an unrelated request is dropped', () => {
    const { modals } = stack();
    modals.show({ render: () => [], invalidate: () => undefined });
    modals.drop('permission:other');
    expect(modals.isOpen).toBe(true);
  });
});
