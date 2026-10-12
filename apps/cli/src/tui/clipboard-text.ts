/**
 * OSC 52: ask the terminal to put text on the system clipboard. It works over
 * SSH and needs no helper binary; inside tmux the sequence is wrapped so it
 * reaches the outer terminal (tmux needs `set -g allow-passthrough on`).
 */
export function osc52Sequence(text: string, env: NodeJS.ProcessEnv = process.env): string {
  const sequence = `\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`;
  if (env['TMUX'] === undefined || env['TMUX'] === '') return sequence;
  return `\x1bPtmux;${sequence.replace(/\x1b/g, '\x1b\x1b')}\x1b\\`;
}
