// Only this experiment process is changed. RPC tool calls execute at this Host;
// shell children have their own OS network/write prohibition.
export class ExperimentNetworkDenied extends Error {
  constructor() { super('Experiment allows only model generation HTTP requests'); this.name = 'ExperimentNetworkDenied'; }
}
export const networkDenials = [];
export async function allowsModelRequest(input, init) {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== 'https://api.x.ai' || !['/v1/responses', '/v1/chat/completions'].includes(url.pathname) || request.method !== 'POST') return false;
  let payload;
  try { payload = JSON.parse(await request.clone().text()); } catch { return false; }
  // Provider-native search/code tools would perform work outside the fixture.
  return Array.isArray(payload.tools) ? payload.tools.every(tool => tool.type === 'function') : true;
}
export function installModelApiOnlyFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (!await allowsModelRequest(input, init)) {
      const request = new Request(input, init), url = new URL(request.url);
      networkDenials.push({ observerRunDirectory: process.env.PIWIN_EXPERIMENT_OBSERVER_RUN_DIR ?? null, origin: url.origin, pathname: url.pathname, method: request.method });
      throw new ExperimentNetworkDenied();
    }
    return original(input, init);
  };
}
