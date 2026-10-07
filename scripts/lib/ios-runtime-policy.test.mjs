import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkIosRuntime } from './ios-runtime-policy.mjs';

const systemRuntime = '\t/usr/lib/swift/libswift_Concurrency.dylib (compatibility version 0.0.0, current version 0.0.0)';
test('accepts a system runtime across simulator architectures', () => {
  assert.deepEqual(checkIosRuntime({ minimumOsVersion: '15.0', linkedLibraries: `${systemRuntime}\n${systemRuntime}`, bundledConcurrency: false }), []);
});
test('rejects the backdeployment runtime that crashed ActivityKit', () => {
  assert.equal(checkIosRuntime({ minimumOsVersion: '14.0', linkedLibraries: '\t@rpath/libswift_Concurrency.dylib (compatibility version 0.0.0)', bundledConcurrency: true }).length, 3);
});
test('detects stale embedded libraries even after relinking', () => {
  assert.equal(checkIosRuntime({ minimumOsVersion: '15.0', linkedLibraries: systemRuntime, bundledConcurrency: true }).length, 1);
  assert.equal(checkIosRuntime({ minimumOsVersion: 'unknown', linkedLibraries: '', bundledConcurrency: false }).length, 2);
});
