/** Printed at the start of `piwin extension list` and in `piwin doctor`. */
export const EXTENSION_COMPAT_NOTE = [
  'Pi extensions run in the Agent Runtime (tools, event hooks, confirm/select/input/notify).',
  'Pi TUI custom UI, themes, keybindings, editor, custom rendering, and /reload are not supported.',
  'Enabled modules run with full OS privileges; permission rules are not a sandbox.',
].join('\n');
