import { Store } from '../store.js';
import type { Topic } from '../model.js';
const [root, courseId, expected, mode] = process.argv.slice(2);
if (!root || !courseId || expected === undefined) throw new Error('Missing worker args');
process.send?.({ state: 'ready' });
process.once('message', async () => {
  try {
    const next = await new Store(root).update<Topic>(courseId, Number(expected), async current => {
      if (!current) throw new Error('Missing topic');
      if (mode === 'hold') {
        process.send?.({ state: 'locked' });
        await new Promise<void>(resolve => process.once('message', () => resolve()));
      }
      current.topic = `writer-${process.pid}`; return current;
    });
    process.send?.({ state: 'done', revision: next.revision });
  } catch (error) { process.send?.({ state: 'error', message: (error as Error).message }); }
  finally { process.disconnect?.(); }
});
