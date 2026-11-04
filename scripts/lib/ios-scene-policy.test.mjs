import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkIosSceneConfiguration } from './ios-scene-policy.mjs';

const scene = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'TaoSceneDelegate' },
    ],
  },
};

test('accepts the single-window scene configuration', () => {
  assert.deepEqual(checkIosSceneConfiguration(scene), []);
});

test('rejects missing scenes, an empty configuration, and accidental multiwindow', () => {
  assert.equal(checkIosSceneConfiguration(undefined).length, 1);
  assert.equal(checkIosSceneConfiguration({ ...scene, UISceneConfigurations: {} }).length, 1);
  assert.equal(checkIosSceneConfiguration({ ...scene, UIApplicationSupportsMultipleScenes: true }).length, 1);
  assert.equal(checkIosSceneConfiguration({ ...scene, UISceneConfigurations: { UIWindowSceneSessionRoleApplication: [{ UISceneDelegateClassName: 'WrongDelegate' }] } }).length, 1);
});
