import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getFinderBundle, injectFinder, pickElementAt, resolveFinderEntryPath } from './pick.js';
import type { InitScriptTarget, PickPage } from './pick.js';
import type { WebElementPickResult } from '@piwin/contracts';

const SNAPSHOT_YAML = `- document [ref=e1] [box=0,0,1280,308]:
  - generic [ref=e2] [box=8,8,1264,292]:
    - button "Submit form" [ref=e13] [box=8,193,88,21]
    - textbox "Name" [ref=e15] [box=166,193,153,21]
`;

type EvaluateResult = {
  selector: string;
  text: string;
  html: string;
  rect: { x: number; y: number; width: number; height: number };
};

function mockPage(
  overrides: {
    evaluateResult?: EvaluateResult | null;
    snapshotYaml?: string;
  } = {},
): PickPage {
  return {
    evaluate: async <R>(_pageFunction: string): Promise<R> =>
      (overrides.evaluateResult ?? null) as R,
    locator: (selector: string) => ({
      ariaSnapshot: async () => {
        expect(selector).toBe('html');
        return overrides.snapshotYaml ?? SNAPSHOT_YAML;
      },
    }),
  };
}

describe('pickElementAt', () => {
  it('assembles a pick result with a matched snapshot ref', async () => {
    const page = mockPage({
      evaluateResult: {
        selector: 'button.submit',
        text: 'Submit form',
        html: '<button class="submit">Submit form</button>',
        rect: { x: 8, y: 193, width: 88, height: 21 },
      },
      snapshotYaml: SNAPSHOT_YAML,
    });

    const picked = await pickElementAt(page, 30, 200);
    expect(picked.selector).toBe('button.submit');
    expect(picked.text).toBe('Submit form');
    expect(picked.html).toBe('<button class="submit">Submit form</button>');
    expect(picked.boundingRect).toEqual({ x: 8, y: 193, width: 88, height: 21 });
    // Point (30,200) falls inside the button's [box=8,193,88,21].
    expect(picked.ref).toBe('e13');
  });

  it('omits ref when the snapshot has no box annotations at the point', async () => {
    const page = mockPage({
      evaluateResult: {
        selector: 'div.page',
        text: 'body text',
        html: '<div class="page">body text</div>',
        rect: { x: 0, y: 0, width: 10, height: 10 },
      },
      // No [box=…] annotations anywhere → no ref can be matched.
      snapshotYaml: '- document [ref=e1]\n  - main [ref=e2]\n',
    });

    const picked = await pickElementAt(page, 5, 5);
    expect(picked.ref).toBeUndefined();
    expect(picked.selector).toBe('div.page');
  });

  it('omits html when the element has no outerHTML content', async () => {
    const page = mockPage({
      evaluateResult: {
        selector: 'div',
        text: '',
        html: '',
        rect: { x: 0, y: 0, width: 1, height: 1 },
      },
    });
    const picked = await pickElementAt(page, 0, 0);
    expect(picked.html).toBeUndefined();
    expect(picked.text).toBe('');
  });

  it('survives an ariaSnapshot failure (ref stays best-effort)', async () => {
    const page = mockPage({
      evaluateResult: {
        selector: 'a.home',
        text: 'Home',
        html: '<a class="home">Home</a>',
        rect: { x: 48, y: 42, width: 39, height: 18 },
      },
    });
    // Force the locator snapshot to throw.
    page.locator = () => {
      throw new Error('snapshot unavailable');
    };

    const picked = await pickElementAt(page, 60, 50);
    expect(picked.selector).toBe('a.home');
    expect(picked.ref).toBeUndefined();
  });

  it('throws PickError when elementFromPoint finds nothing', async () => {
    const page = mockPage({ evaluateResult: null });
    await expect(pickElementAt(page, 10, 10)).rejects.toThrow('no element at');
  });

  it('exposes the finder bundle as an injectable init script', async () => {
    const calls: string[] = [];
    const target: InitScriptTarget = {
      addInitScript: async (options) => {
        calls.push(options.content);
      },
    };
    const bundle = getFinderBundle();
    expect(bundle).toContain('FinderModule');
    // Footer re-assigns the global so it survives Playwright's function wrapper.
    expect(bundle).toContain('window.FinderModule');
    await injectFinder(target);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(bundle);
  });

  it('resolves the finder entry from the browser package instead of process.cwd()', () => {
    const entryPath = resolveFinderEntryPath();
    expect(entryPath).toContain('@medv');
    expect(entryPath).toContain('finder');
    expect(existsSync(entryPath)).toBe(true);
  });
});

// Compile-time guard: PickedElement maps cleanly onto the contract type.
const _result: WebElementPickResult = {
  url: 'https://example.com',
  selector: 'button.submit',
  text: 'Submit form',
  boundingRect: { x: 0, y: 0, width: 10, height: 10 },
};
void _result;
