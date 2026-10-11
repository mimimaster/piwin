import { afterEach, describe, expect, it, vi } from 'vitest';
import { InteractiveTerminalManager } from './interactive-terminal.js';

const output: string[] = [];
const exits: number[] = [];
let manager = new InteractiveTerminalManager({ onData: (_id, data) => output.push(data), onExit: (_id, code) => exits.push(code) });
afterEach(async () => {
  await manager.dispose(); output.length = 0; exits.length = 0;
  manager = new InteractiveTerminalManager({ onData: (_id, data) => output.push(data), onExit: (_id, code) => exits.push(code) });
});

describe('real Host interactive terminals', () => {
  it('opens a real TTY, carries input, resizes and observes exit', async () => {
    const id = await manager.open({ executable: process.execPath, cwd: process.cwd(), cols: 80, rows: 24, args: ['-e', `
      process.stdin.setRawMode(true);
      console.log('READY:'+process.stdout.isTTY+':'+process.stdout.columns+'x'+process.stdout.rows);
      process.on('SIGWINCH',()=>console.log('SIZE:'+process.stdout.columns+'x'+process.stdout.rows));
      process.stdin.on('data',(data)=>{if(data.toString()==='q') process.exit(0); else console.log('INPUT:'+data.toString());});
    `] });
    await vi.waitFor(() => expect(output.join('')).toContain('READY:true:80x24'));
    manager.write(id, '你好');
    await vi.waitFor(() => expect(output.join('')).toContain('INPUT:你好'));
    manager.resize(id, 100, 30);
    if (process.platform !== 'win32') await vi.waitFor(() => expect(output.join('')).toContain('SIZE:100x30'));
    manager.write(id, 'q');
    await vi.waitFor(() => expect(exits).toEqual([0]));
    await manager.close(id);
    expect(() => manager.write(id, 'x')).toThrow('terminal-not-found');
  });
  it('rejects invalid dimensions before spawning and closes a live process', async () => {
    await expect(manager.open({ executable: process.execPath, args: [], cwd: process.cwd(), cols: 0, rows: 24 })).rejects.toThrow('invalid-terminal-size');
    const id = await manager.open({ executable: process.execPath, args: ['-e', "console.log('WAITING');setInterval(()=>{},1000)"], cwd: process.cwd(), cols: 80, rows: 24 });
    await vi.waitFor(() => expect(output.join('')).toContain('WAITING'));
    expect(() => manager.resize(id, 80.1, 24)).toThrow('invalid-terminal-size');
    expect(() => manager.write(id, 'x'.repeat(65537))).toThrow('terminal-input-too-large');
    await Promise.all([manager.close(id), manager.close(id)]);
    await vi.waitFor(() => expect(exits).toHaveLength(1));
  });
});
