/** Verify the packaged app adopts scenes without advertising extra windows. */
export function checkIosSceneConfiguration(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['The application must declare an iOS scene manifest.'];
  }

  const failures = [];
  if (manifest.UIApplicationSupportsMultipleScenes !== false) {
    failures.push('The application must retain its single-window scene policy.');
  }
  const configurations = manifest.UISceneConfigurations?.UIWindowSceneSessionRoleApplication;
  if (!Array.isArray(configurations) || !configurations.some((entry) =>
    entry?.UISceneDelegateClassName === 'TaoSceneDelegate'
    && typeof entry.UISceneConfigurationName === 'string'
    && entry.UISceneConfigurationName.length > 0
  )) {
    failures.push('The application must declare a named TaoSceneDelegate window scene.');
  }
  return failures;
}
