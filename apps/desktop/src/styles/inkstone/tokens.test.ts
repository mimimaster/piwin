import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(join(here, 'tokens.css'), 'utf8');

describe('Inkstone type tokens', () => {
  it('puts Inter and system Latin ahead of PingFang in --sans', () => {
    expect(tokens).toMatch(
      /--sans:\s*Inter,\s*-apple-system,\s*BlinkMacSystemFont,\s*'PingFang SC'/,
    );
    expect(tokens).not.toMatch(/--sans:\s*Inter,\s*'PingFang SC'/);
  });

  it('leads --mono with JetBrains Mono and tabular-capable system fallbacks', () => {
    expect(tokens).toMatch(
      /--mono:\s*'JetBrains Mono',\s*ui-monospace,\s*'SF Mono',\s*Menlo/,
    );
  });

  it('keeps proto-01 reading measure at 14.5 / 1.72 via --chat-line-height', () => {
    expect(tokens).toContain('--chat-line-height: 1.72');
    expect(tokens).toContain('--fs-ui: 12.5px');
    expect(tokens).toContain('--fs-meta: 11.5px');
  });
});
