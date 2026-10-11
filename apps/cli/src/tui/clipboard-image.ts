import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Read an image off the system clipboard. A terminal only delivers text on
 * paste, so the bytes come from the platform's own clipboard tool.
 *
 * This reads the clipboard of the machine the TUI runs on — the user's — not
 * the Host's.
 */

export type ClipboardImage = { bytes: Uint8Array; mimeType: 'image/png' };

export type ClipboardCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<{ ok: boolean; stdout: Buffer }>;

export type ClipboardReadResult =
  | { kind: 'image'; image: ClipboardImage }
  | { kind: 'empty' }
  /** No clipboard tool for this platform is installed. */
  | { kind: 'unsupported'; hint: string };

const COMMAND_TIMEOUT_MS = 5_000;
const MAX_CLIPBOARD_BYTES = 32 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

const runCommand: ClipboardCommandRunner = (command, args) =>
  new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { timeout: COMMAND_TIMEOUT_MS, maxBuffer: MAX_CLIPBOARD_BYTES, encoding: 'buffer', windowsHide: true },
      (error, stdout) => resolve({ ok: error === null, stdout }),
    );
  });

export async function readClipboardImage(
  options: { platform?: NodeJS.Platform; run?: ClipboardCommandRunner } = {},
): Promise<ClipboardReadResult> {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? runCommand;
  if (platform === 'darwin') return viaTemporaryFile(run, macCommand);
  if (platform === 'win32') return viaTemporaryFile(run, windowsCommand);
  return viaStdout(run);
}

type FileCommand = (file: string) => { command: string; args: string[] };

/** AppleScript coerces whatever image the clipboard holds to PNG, or fails. */
const macCommand: FileCommand = (file) => ({
  command: 'osascript',
  args: [
    '-e',
    'set png to (the clipboard as «class PNGf»)',
    '-e',
    `set out to open for access POSIX file ${JSON.stringify(file)} with write permission`,
    '-e',
    'write png to out',
    '-e',
    'close access out',
  ],
});

const windowsCommand: FileCommand = (file) => ({
  command: 'powershell.exe',
  args: [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Add-Type -AssemblyName System.Windows.Forms; $image = [System.Windows.Forms.Clipboard]::GetImage(); if ($null -eq $image) { exit 1 }; $image.Save('${file.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
  ],
});

async function viaTemporaryFile(run: ClipboardCommandRunner, build: FileCommand): Promise<ClipboardReadResult> {
  const directory = await mkdtemp(path.join(tmpdir(), 'piwin-clipboard-'));
  try {
    const { command, args } = build(path.join(directory, 'clipboard.png'));
    const result = await run(command, args);
    if (!result.ok) return { kind: 'empty' };
    return toResult(await readFile(path.join(directory, 'clipboard.png')).catch(() => Buffer.alloc(0)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Wayland first, then X11; each prints the PNG to stdout. */
async function viaStdout(run: ClipboardCommandRunner): Promise<ClipboardReadResult> {
  const candidates: Array<{ command: string; args: string[] }> = [
    { command: 'wl-paste', args: ['--no-newline', '--type', 'image/png'] },
    { command: 'xclip', args: ['-selection', 'clipboard', '-t', 'image/png', '-o'] },
  ];
  let anyToolRan = false;
  for (const candidate of candidates) {
    const probe = await run('which', [candidate.command]);
    if (!probe.ok) continue;
    anyToolRan = true;
    const result = await run(candidate.command, candidate.args);
    const parsed = result.ok ? toResult(result.stdout) : undefined;
    if (parsed?.kind === 'image') return parsed;
  }
  return anyToolRan ? { kind: 'empty' } : { kind: 'unsupported', hint: '需要安装 wl-clipboard 或 xclip' };
}

function toResult(bytes: Buffer): ClipboardReadResult {
  if (bytes.byteLength < PNG_SIGNATURE.length || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    return { kind: 'empty' };
  }
  return { kind: 'image', image: { bytes: new Uint8Array(bytes), mimeType: 'image/png' } };
}
