import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export async function prepareOolong(project, output) {
  const provenance = JSON.parse(await readFile(join(output, 'dataset-provenance.json'), 'utf8'));
  const tasks = []; const expected = {};
  for (const row of provenance.tasks) {
    const content = await readFile(join(output, 'inputs', row.inputFile));
    if (createHash('sha256').update(content).digest('hex') !== row.inputHash) throw new Error('Pinned OOLONG material hash mismatch');
    await writeFile(join(project, 'experiment-data', row.inputFile), content);
    tasks.push({ id: row.taskId, prompt: `Read the complete benchmark material in experiment-data/${row.inputFile}.\n\nOriginal OOLONG question:\n${row.question}\n\nDo the original classification and aggregation on the unlabeled input. Do not guess, estimate, or invent missing labels. Final answer must be exactly one JSON object {"answer":VALUE}, where VALUE is an integer for numerical questions or the original exact category string for label questions. Keep any evidence or calculations in tool work; return no extra JSON keys. Only access files inside this project; do not read the runner, configs, credentials, evaluator, or answer files outside it.` });
    expected[row.taskId] = row.expected;
  }
  return { tasks, expected, provenance };
}

export function gradeOolong(answer, expected) {
  let parsed;
  try { parsed = JSON.parse(answer.trim()); } catch { return { passed: false, failures: ['invalid JSON'], officialScore: 0 }; }
  const keys = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed) : [];
  const actual = parsed?.answer;
  const valid = keys.length === 1 && keys[0] === 'answer' && (typeof expected.answer === 'number' ? Number.isInteger(actual) : typeof actual === 'string');
  const passed = valid && actual === expected.answer;
  // Official numeric credit is 0.75 ** absolute error. Primary acceptance
  // remains exact, so near misses never count as a correct answer.
  const officialScore = valid && typeof actual === 'number' ? 0.75 ** Math.abs(actual - expected.answer) : Number(passed);
  return { passed, failures: passed ? [] : [valid ? 'answer differs from pinned gold' : 'invalid answer schema/type'], parsed, officialScore };
}
