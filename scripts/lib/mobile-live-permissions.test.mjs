import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('iOS Live can register and release the native audio event channel', () => {
  const permissions = readFileSync(new URL('../../apps/mobile/src-tauri/plugins/live/permissions/default.toml', import.meta.url), 'utf8');
  const commands = JSON.parse(permissions.match(/commands\.allow\s*=\s*(\[[\s\S]*?\])/)?.[1] ?? '[]');
  // Tauri's addPluginListener / PluginListener.unregister use these commands.
  for (const command of ['register_listener', 'remove_listener']) {
    assert.ok(commands.includes(command), `Native audio events are blocked by ACL: ${command}`);
  }
});
