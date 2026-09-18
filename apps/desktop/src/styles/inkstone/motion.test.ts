import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const motion = readFileSync(join(here, 'motion.css'), 'utf8');
const entry = readFileSync(join(here, '../../styles.css'), 'utf8');

describe('Inkstone motion.css', () => {
  it('is imported from the desktop stylesheet entry', () => {
    expect(entry).toContain("import './styles/inkstone/motion.css'");
  });

  it('defines proto-07 keyframes with the authored timings', () => {
    expect(motion).toMatch(/@keyframes breath/);
    expect(motion).toMatch(/@keyframes grind/);
    expect(motion).toMatch(/@keyframes sheen/);
    expect(motion).toMatch(/@keyframes stamp/);
    expect(motion).toMatch(/@keyframes draw/);
    expect(motion).toMatch(/@keyframes orbit/);
    expect(motion).toContain('160ms var(--spring)');
    expect(motion).toContain('240ms ease-out');
    expect(motion).toContain('outline-color: var(--azure)');
    expect(motion).not.toContain('outline-color: var(--zhu)');
    expect(motion).toContain('prefers-reduced-motion');
  });

  it('overrides Mantine primary focus rings to azure instead of vermillion', () => {
    expect(motion).toContain('.mantine-focus-auto:focus-visible');
    expect(motion).toContain('outline: 2px solid var(--azure)');
  });
});
