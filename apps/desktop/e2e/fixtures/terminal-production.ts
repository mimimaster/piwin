import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

const container = document.getElementById('terminal');
if (container === null) throw new Error('Terminal container missing');
const terminal = new Terminal({ cols: 100, rows: 30 });
const replies: string[] = [];
terminal.onData((data) => {
  replies.push(data);
  document.documentElement.dataset.replies = JSON.stringify(replies);
});
terminal.open(container);
// Captured Antigravity startup probes, including DECRQM for synchronized output.
const handshake = '\x1b[>q\x1b[c\x1b[?2026$p\x1b[?2027$p\x1b]11;?\x07\x1b]7501;?\x07';
terminal.write(`${handshake}\r\nAntigravity startup parsed`, () => {
  document.documentElement.dataset.painted = Array.from({ length: terminal.rows }, (_, row) =>
    terminal.buffer.active.getLine(row)?.translateToString(true) ?? '',
  ).join('\n');
});
