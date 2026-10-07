/** ActivityKit and native tasks must share the operating system's runtime. */
export function checkIosRuntime({ minimumOsVersion, linkedLibraries, bundledConcurrency }) {
  const failures = [];
  if (!/^\d+(\.\d+)*$/.test(minimumOsVersion) || Number(minimumOsVersion.split('.')[0]) < 15) {
    failures.push('Native Live requires a consistent iOS 15 or later deployment target.');
  }
  const concurrency = linkedLibraries.split('\n').filter((line) => line.includes('libswift_Concurrency.dylib'));
  if (concurrency.length === 0 || concurrency.some((line) => !line.trim().startsWith('/usr/lib/swift/libswift_Concurrency.dylib '))) {
    failures.push('The application must link the system Swift concurrency runtime.');
  }
  if (bundledConcurrency) failures.push('Remove the obsolete bundled Swift concurrency runtime from the build output.');
  return failures;
}
