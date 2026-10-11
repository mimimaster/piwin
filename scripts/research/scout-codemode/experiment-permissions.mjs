// OS-protected shell computation and the authorized readonly Scout workflow
// remain available. Network and all other permission requests are refused.
export function decideExperimentPermission(action) {
  return ['bash', 'codemode:run', 'subagent:run'].includes(action) ? 'allow' : 'deny';
}
