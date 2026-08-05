import { describe, expect, it } from 'vitest';
import { ProductAgentHost, type ProductAgentHostOptions } from './product-agent-host.js';

describe('ProductAgentHost', () => {
  it('requires a parent-owned tool execution port in non-mock mode', () => {
    expect(
      () =>
        new ProductAgentHost({
          mode: 'sdk',
          mock: false,
        } as ProductAgentHostOptions),
    ).toThrow('ProductAgentHost requires a parent-owned HostToolExecutionPort');
  });
});
