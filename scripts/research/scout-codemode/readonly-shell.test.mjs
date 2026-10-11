import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
const execute = promisify(execFile);
const shell = join(import.meta.dirname, 'readonly-shell.sh');
test('normal reads, pipes and in-memory Python aggregation remain available', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oolong-readonly-test-'));
  try {
    await writeFile(join(directory, 'input.json'), '[{"value":3},{"value":7}]');
    const result = await execute(shell, ['-c', `python3 -c 'import json; print(sum(row["value"] for row in json.load(open("input.json"))))' | cat`], { cwd: directory });
    assert.equal(result.stdout.trim(), '10');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('Python and Node cannot create, overwrite or delete files outside the project', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oolong-write-test-'));
  const existing = join(directory, 'existing');
  await writeFile(existing, 'unchanged');
  try {
    for (const command of [
      `python3 -c 'from pathlib import Path; Path("${directory}/created").write_text("forbidden")'`,
      `node -e 'require("fs").writeFileSync("${existing}", "forbidden")'`,
      `python3 -c 'from pathlib import Path; Path("${existing}").unlink()'`,
    ]) await assert.rejects(execute(shell, ['-c', command]), /EPERM|Operation not permitted/);
    assert.equal(await readFile(existing, 'utf8'), 'unchanged');
    await assert.rejects(readFile(join(directory, 'created')), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
