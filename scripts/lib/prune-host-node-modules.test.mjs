import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import {
  classifyRemovableFile,
  clipboardPackagesToKeep,
  formatPruneReport,
  isUnderPiDocsOrExamples,
  pruneHostNodeModules,
} from './prune-host-node-modules.mjs';

test('clipboardPackagesToKeep: darwin arm64 keeps universal + arm64', () => {
  const keep = clipboardPackagesToKeep('darwin', 'arm64');
  assert.ok(keep.has('clipboard'));
  assert.ok(keep.has('clipboard-darwin-arm64'));
  assert.ok(keep.has('clipboard-darwin-universal'));
  assert.equal(keep.has('clipboard-darwin-x64'), false);
  assert.equal(keep.has('clipboard-linux-x64-gnu'), false);
});

test('clipboardPackagesToKeep: win32 x64', () => {
  const keep = clipboardPackagesToKeep('win32', 'x64');
  assert.ok(keep.has('clipboard-win32-x64-msvc'));
  assert.equal(keep.has('clipboard-win32-arm64-msvc'), false);
});

test('classifyRemovableFile', () => {
  assert.equal(classifyRemovableFile('index.js.map'), 'sourcemap');
  assert.equal(classifyRemovableFile('index.d.ts'), 'typedef');
  assert.equal(classifyRemovableFile('index.d.mts'), 'typedef');
  assert.equal(classifyRemovableFile('CHANGELOG.md'), null);
  assert.equal(classifyRemovableFile('README.md'), 'markdown');
  assert.equal(classifyRemovableFile('index.js'), null);
});

test('isUnderPiDocsOrExamples', () => {
  const root = '/tmp/node_modules';
  assert.equal(
    isUnderPiDocsOrExamples(root, `${root}/@earendil-works/pi-coding-agent/docs/extensions.md`),
    true,
  );
  assert.equal(
    isUnderPiDocsOrExamples(root, `${root}/@earendil-works/pi-coding-agent/examples/x.ts`),
    true,
  );
  assert.equal(
    isUnderPiDocsOrExamples(root, `${root}/@earendil-works/pi-coding-agent/dist/index.js`),
    false,
  );
});

/**
 * @param {string} root
 */
async function touch(root, rel, content = 'x') {
  const full = join(root, rel);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content);
  return full;
}

test('pruneHostNodeModules removes safe junk and keeps required paths', async () => {
  const root = join(tmpdir(), `piwin-prune-test-${process.pid}-${Date.now()}`);
  const nm = join(root, 'node_modules');
  await mkdir(nm, { recursive: true });

  await touch(nm, 'pkg/index.js', 'console.log(1)');
  await touch(nm, 'pkg/index.js.map', 'MAP');
  await touch(nm, 'pkg/index.d.ts', 'export {}');
  await touch(nm, 'pkg/README.md', '# pkg');
  await touch(nm, 'pkg/CHANGELOG.md', '# changes');

  await touch(
    nm,
    '@earendil-works/pi-coding-agent/docs/extensions.md',
    '# keep me',
  );
  await touch(
    nm,
    '@earendil-works/pi-coding-agent/examples/foo.md',
    '# keep example',
  );
  await touch(nm, '@earendil-works/pi-coding-agent/CHANGELOG.md', '# pi cl');
  await touch(nm, '@earendil-works/pi-coding-agent/dist/index.js', 'export {}');

  // clipboard packages
  await touch(
    nm,
    '@mariozechner/clipboard/package.json',
    '{"name":"clipboard"}',
  );
  await touch(
    nm,
    '@mariozechner/clipboard-darwin-arm64/binary.node',
    'native-arm',
  );
  await touch(
    nm,
    '@mariozechner/clipboard-darwin-universal/binary.node',
    'native-uni',
  );
  await touch(
    nm,
    '@mariozechner/clipboard-linux-x64-gnu/binary.node',
    'native-linux',
  );
  await touch(
    nm,
    '@earendil-works/pi-coding-agent/node_modules/@mariozechner/clipboard-win32-x64-msvc/binary.node',
    'native-win',
  );

  // photon top + nested
  await touch(nm, '@silvia-odwyer/photon-node/photon_rs_bg.wasm', 'WASM-TOP');
  await touch(
    nm,
    '@earendil-works/pi-coding-agent/node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm',
    'WASM-NESTED',
  );

  try {
    const report = await pruneHostNodeModules(nm, {
      platform: 'darwin',
      arch: 'arm64',
    });

    assert.ok(report.removedBytes > 0);
    assert.ok((report.byCategory.sourcemap ?? 0) > 0);
    assert.ok((report.byCategory.typedef ?? 0) > 0);
    assert.ok((report.byCategory.markdown ?? 0) > 0);
    assert.ok((report.byCategory['clipboard-foreign'] ?? 0) > 0);
    assert.ok((report.byCategory['nested-photon-dup'] ?? 0) > 0);

    await assert.rejects(() => access(join(nm, 'pkg/index.js.map')));
    await assert.rejects(() => access(join(nm, 'pkg/index.d.ts')));
    await assert.rejects(() => access(join(nm, 'pkg/README.md')));
    await assert.equal(
      await readFile(join(nm, 'pkg/CHANGELOG.md'), 'utf8'),
      '# changes',
    );
    await assert.equal(await readFile(join(nm, 'pkg/index.js'), 'utf8'), 'console.log(1)');

    // Pi docs / examples kept
    await assert.equal(
      await readFile(
        join(nm, '@earendil-works/pi-coding-agent/docs/extensions.md'),
        'utf8',
      ),
      '# keep me',
    );
    await assert.equal(
      await readFile(
        join(nm, '@earendil-works/pi-coding-agent/examples/foo.md'),
        'utf8',
      ),
      '# keep example',
    );

    // native clipboard kept, foreign gone
    await access(join(nm, '@mariozechner/clipboard/package.json'));
    await access(join(nm, '@mariozechner/clipboard-darwin-arm64/binary.node'));
    await access(join(nm, '@mariozechner/clipboard-darwin-universal/binary.node'));
    await assert.rejects(() =>
      access(join(nm, '@mariozechner/clipboard-linux-x64-gnu/binary.node')),
    );
    await assert.rejects(() =>
      access(
        join(
          nm,
          '@earendil-works/pi-coding-agent/node_modules/@mariozechner/clipboard-win32-x64-msvc/binary.node',
        ),
      ),
    );

    // top photon kept, nested removed
    await assert.equal(
      await readFile(join(nm, '@silvia-odwyer/photon-node/photon_rs_bg.wasm'), 'utf8'),
      'WASM-TOP',
    );
    await assert.rejects(() =>
      access(
        join(
          nm,
          '@earendil-works/pi-coding-agent/node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm',
        ),
      ),
    );

    const formatted = formatPruneReport(report);
    assert.match(formatted, /removed/);
    assert.match(formatted, /sourcemap/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('pruneHostNodeModules keeps nested photon when top-level missing', async () => {
  const root = join(tmpdir(), `piwin-prune-photon-${process.pid}-${Date.now()}`);
  const nm = join(root, 'node_modules');
  await mkdir(nm, { recursive: true });
  const nested = join(
    nm,
    '@earendil-works/pi-coding-agent/node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm',
  );
  await mkdir(join(nested, '..'), { recursive: true });
  await writeFile(nested, 'ONLY-NESTED');

  try {
    const report = await pruneHostNodeModules(nm, {
      platform: 'darwin',
      arch: 'arm64',
    });
    assert.equal(report.byCategory['nested-photon-dup'], undefined);
    assert.equal(await readFile(nested, 'utf8'), 'ONLY-NESTED');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('pruneHostNodeModules drops natives built for other triples', async () => {
  const root = join(tmpdir(), `piwin-prune-natives-${process.pid}-${Date.now()}`);
  const nm = join(root, 'node_modules');
  await mkdir(nm, { recursive: true });

  await touch(nm, 'node-pty/lib/index.js', 'pty');
  await touch(nm, 'node-pty/prebuilds/darwin-arm64/pty.node', 'native');
  await touch(nm, 'node-pty/prebuilds/darwin-x64/pty.node', 'foreign');
  await touch(nm, 'node-pty/prebuilds/win32-x64/conpty.node', 'foreign');

  await touch(nm, '@img/sharp-darwin-arm64/lib/sharp.node', 'native');
  await touch(nm, '@img/sharp-libvips-darwin-arm64/lib/libvips.dylib', 'native');
  await touch(nm, '@img/sharp-wasm32/lib/sharp.wasm', 'fallback');

  try {
    const report = await pruneHostNodeModules(nm, { platform: 'darwin', arch: 'arm64' });

    assert.ok((report.byCategory['node-pty-foreign'] ?? 0) > 0);
    assert.ok((report.byCategory['sharp-wasm-fallback'] ?? 0) > 0);

    await access(join(nm, 'node-pty/lib/index.js'));
    await access(join(nm, 'node-pty/prebuilds/darwin-arm64/pty.node'));
    await assert.rejects(() => access(join(nm, 'node-pty/prebuilds/darwin-x64')));
    await assert.rejects(() => access(join(nm, 'node-pty/prebuilds/win32-x64')));

    await access(join(nm, '@img/sharp-darwin-arm64/lib/sharp.node'));
    await access(join(nm, '@img/sharp-libvips-darwin-arm64/lib/libvips.dylib'));
    await assert.rejects(() => access(join(nm, '@img/sharp-wasm32')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('pruneHostNodeModules keeps every fallback when the native build is missing', async () => {
  const root = join(tmpdir(), `piwin-prune-fallback-${process.pid}-${Date.now()}`);
  const nm = join(root, 'node_modules');
  await mkdir(nm, { recursive: true });

  // linux-arm64 build tree that only received other triples' natives.
  await touch(nm, 'node-pty/prebuilds/darwin-arm64/pty.node', 'other');
  await touch(nm, 'node-pty/prebuilds/win32-x64/conpty.node', 'other');
  await touch(nm, '@img/sharp-linuxmusl-arm64/lib/sharp.node', 'musl');
  await touch(nm, '@img/sharp-wasm32/lib/sharp.wasm', 'fallback');

  try {
    const report = await pruneHostNodeModules(nm, { platform: 'linux', arch: 'arm64' });

    assert.equal(report.byCategory['node-pty-foreign'], undefined);
    assert.equal(report.byCategory['sharp-wasm-fallback'], undefined);
    await access(join(nm, 'node-pty/prebuilds/darwin-arm64/pty.node'));
    await access(join(nm, 'node-pty/prebuilds/win32-x64/conpty.node'));
    await access(join(nm, '@img/sharp-wasm32/lib/sharp.wasm'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
