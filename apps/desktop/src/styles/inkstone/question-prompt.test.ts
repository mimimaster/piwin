import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const questionPrompt = readFileSync(join(here, 'question-prompt.css'), 'utf8');
const entry = readFileSync(join(here, '../../styles.css'), 'utf8');

describe('Inkstone question-prompt.css', () => {
  it('is imported after the shared interruption frame it refines', () => {
    const frameIndex = entry.indexOf("import './styles/inkstone/permission-gates.css'");
    const questionIndex = entry.indexOf("import './styles/inkstone/question-prompt.css'");
    expect(frameIndex).toBeGreaterThan(-1);
    expect(questionIndex).toBeGreaterThan(frameIndex);
  });

  it('reuses motion.css keyframes instead of redefining them', () => {
    expect(questionPrompt).not.toMatch(/@keyframes/);
    expect(questionPrompt).toContain('animation: stamp 160ms var(--spring)');
    expect(questionPrompt).toContain('animation: breath');
  });

  it('keeps the frame shadow from being overwritten by the gate-pulse behavior', () => {
    expect(questionPrompt).toMatch(
      /\.agent-interruption\[data-activity-animation\] \{\s*animation: agent-interruption-slide-in/,
    );
  });

  it('uses the azure focus ring and honors reduced motion', () => {
    expect(questionPrompt).toContain('outline: 2px solid var(--azure)');
    expect(questionPrompt).not.toMatch(/outline:[^;]*var\(--zhu\)/);
    expect(questionPrompt).toContain('prefers-reduced-motion');
  });
});
