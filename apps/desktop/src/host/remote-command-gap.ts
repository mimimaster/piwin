/** HostServer admission denial. */
const REMOTE_COMMAND_NOT_ENABLED = 'Remote command is not enabled yet:';
/** HostClient local ceiling — command was never sent. */
const REMOTE_COMMAND_NOT_EXPOSED = /This Host does not expose \S+ to remote clients/;
const SILENT_GAP_COMMANDS = /settings\/apply\b/;

/** True when a failed Host request is an expected remote-capability gap, not a product error. */
export function isRemoteCommandGapError(message: string): boolean {
  const text = message.trim();
  if (SILENT_GAP_COMMANDS.test(text)) {
    return false;
  }
  return text.startsWith(REMOTE_COMMAND_NOT_ENABLED) || REMOTE_COMMAND_NOT_EXPOSED.test(text);
}
