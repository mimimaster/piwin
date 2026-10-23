/**
 * Windows Credential Manager store for Host secrets (generic credentials,
 * per-user, persisted locally). Node has no binding, so the Host calls the
 * Win32 CredRead/CredWrite/CredDelete API through Windows PowerShell.
 *
 * Invariants:
 * - The secret travels through stdin/stdout only, never argv or env, so it is
 *   not visible in the process list.
 * - The target name is `piwin:<service>`; `service` is already restricted to
 *   `[A-Za-z0-9._-]` by the resolver and passed through env, not interpolated.
 * - WinRT PasswordVault is avoided on purpose: it caps unpackaged apps at
 *   about ten credentials, fewer than providers plus plugin secrets need.
 */
import { spawn } from 'node:child_process';

/** CRED_MAX_CREDENTIAL_BLOB_SIZE: 5 * 512 bytes of UTF-16. */
export const WINDOWS_CREDENTIAL_MAX_CHARS = 1280;

export type WindowsCredentialOperation = 'read' | 'write' | 'delete';

export type PowerShellResult = { exitCode: number; stdout: string; stderr: string };

export type RunPowerShell = (input: {
  script: string;
  env: Record<string, string>;
  stdin: string;
}) => Promise<PowerShellResult>;

export type WindowsCredentialStore = {
  read: (service: string) => Promise<string | null>;
  write: (service: string, secret: string) => Promise<void>;
  delete: (service: string) => Promise<void>;
};

/** Exit code the script uses for "no such credential" (ERROR_NOT_FOUND). */
const NOT_FOUND_EXIT_CODE = 3;

export const WINDOWS_CREDENTIAL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class PiwinCredential {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredReadW(string target, int type, int flags, out IntPtr credential);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredWriteW(ref CREDENTIAL credential, int flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredDeleteW(string target, int type, int flags);
  [DllImport("advapi32.dll")]
  private static extern void CredFree(IntPtr credential);
  private const int GENERIC = 1;
  private const int PERSIST_LOCAL_MACHINE = 2;
  private const int ERROR_NOT_FOUND = 1168;
  public static string Read(string target) {
    IntPtr pointer;
    if (!CredReadW(target, GENERIC, 0, out pointer)) {
      int error = Marshal.GetLastWin32Error();
      if (error == ERROR_NOT_FOUND) return null;
      throw new Win32Exception(error);
    }
    try {
      CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
      if (credential.CredentialBlobSize == 0) return "";
      return Marshal.PtrToStringUni(credential.CredentialBlob, credential.CredentialBlobSize / 2);
    } finally {
      CredFree(pointer);
    }
  }
  public static void Write(string target, string secret) {
    byte[] blob = Encoding.Unicode.GetBytes(secret);
    CREDENTIAL credential = new CREDENTIAL();
    credential.Type = GENERIC;
    credential.TargetName = target;
    credential.UserName = "piwin";
    credential.Persist = PERSIST_LOCAL_MACHINE;
    credential.CredentialBlobSize = blob.Length;
    credential.CredentialBlob = Marshal.AllocHGlobal(blob.Length);
    try {
      Marshal.Copy(blob, 0, credential.CredentialBlob, blob.Length);
      if (!CredWriteW(ref credential, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
    } finally {
      Marshal.FreeHGlobal(credential.CredentialBlob);
    }
  }
  public static void Delete(string target) {
    if (CredDeleteW(target, GENERIC, 0)) return;
    int error = Marshal.GetLastWin32Error();
    if (error != ERROR_NOT_FOUND) throw new Win32Exception(error);
  }
}
'@
$target = $env:PIWIN_CREDENTIAL_TARGET
switch ($env:PIWIN_CREDENTIAL_OP) {
  'read' {
    $value = [PiwinCredential]::Read($target)
    if ($null -eq $value) { exit ${NOT_FOUND_EXIT_CODE} }
    [Console]::Out.Write($value)
  }
  'write' { [PiwinCredential]::Write($target, [Console]::In.ReadToEnd()) }
  'delete' { [PiwinCredential]::Delete($target) }
  default { throw "unknown credential operation" }
}
`;

export function windowsCredentialTarget(service: string): string {
  return `piwin:${service}`;
}

export function createWindowsCredentialStore(
  runPowerShell: RunPowerShell = runWindowsPowerShell,
): WindowsCredentialStore {
  async function run(
    operation: WindowsCredentialOperation,
    service: string,
    stdin = '',
  ): Promise<PowerShellResult> {
    return runPowerShell({
      script: WINDOWS_CREDENTIAL_SCRIPT,
      env: {
        PIWIN_CREDENTIAL_OP: operation,
        PIWIN_CREDENTIAL_TARGET: windowsCredentialTarget(service),
      },
      stdin,
    });
  }

  return {
    async read(service) {
      const result = await run('read', service);
      if (result.exitCode === NOT_FOUND_EXIT_CODE) return null;
      if (result.exitCode !== 0) throw credentialError('read', service, result);
      const value = result.stdout.trim();
      return value.length > 0 ? value : null;
    },
    async write(service, secret) {
      if (secret.length > WINDOWS_CREDENTIAL_MAX_CHARS) {
        throw new Error(
          `Windows Credential Manager holds at most ${WINDOWS_CREDENTIAL_MAX_CHARS} characters per secret (${service})`,
        );
      }
      const result = await run('write', service, secret);
      if (result.exitCode !== 0) throw credentialError('write', service, result);
    },
    async delete(service) {
      const result = await run('delete', service);
      if (result.exitCode !== 0) throw credentialError('delete', service, result);
    },
  };
}

function credentialError(
  operation: WindowsCredentialOperation,
  service: string,
  result: PowerShellResult,
): Error {
  // stderr carries the PowerShell/Win32 message only; the secret never reaches it.
  const detail = result.stderr.trim().split(/\r?\n/, 1)[0] ?? '';
  return new Error(
    `Windows Credential Manager ${operation} failed for ${service} (exit ${result.exitCode})${detail ? `: ${detail}` : ''}`,
  );
}

/** Windows PowerShell 5.1 ships with every supported Windows; pwsh may be absent. */
export const runWindowsPowerShell: RunPowerShell = ({ script, env, stdin }) =>
  new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
    child.stdin.end(stdin, 'utf8');
  });
