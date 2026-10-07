import Foundation
import HealthKit
import Security

/// Where and as whom this phone uploads daily summaries. Holds the pairing
/// secret, so it lives in the Keychain and nowhere else.
struct HealthBackgroundSyncConfig: Codable {
  let syncUrl: String
  let deviceId: String
  let deviceSecret: String
  let metrics: [String]
}

/// Days recomputed on an ordinary sync. Late-arriving samples (a watch that
/// syncs hours later) land within this window and correct earlier uploads.
private let healthSyncRecentDays = 3
/// Days uploaded the first time, so baselines exist from day one.
private let healthSyncBackfillDays = 60
/// Mirrors `APPLE_HEALTH_MAX_METRICS_PER_CALL`: the Host refuses larger batches.
private let healthSyncMetricsPerBatch = 8
/// HealthKit gives a background wake only a short time; give up well inside it.
private let healthSyncRequestTimeout: TimeInterval = 20

private let healthSyncKeychainService = "app.piwin.mobile.health-sync"
private let healthSyncKeychainAccount = "config"
private let healthSyncLastSyncKey = "piwin.health-sync.last-sync-at"
private let healthSyncLastErrorKey = "piwin.health-sync.last-error"

/// Background summary sync (ADR 0062 M2). HealthKit wakes the app when data
/// changes; this recomputes the recent local days and uploads them over one
/// short HTTP request. Nothing is queued on disk: HealthKit stays the source
/// of truth, and a failed upload is simply recomputed on the next wake.
final class HealthBackgroundSync {
  private weak var plugin: HealthKitPlugin?
  private let queue = DispatchQueue(label: "app.piwin.mobile.health-sync")
  private var observers: [HKObserverQuery] = []
  private var running = false
  private var rerunRequested = false
  private var waiting: [() -> Void] = []

  init(plugin: HealthKitPlugin) {
    self.plugin = plugin
  }

  /// Called on every launch, including a background launch by HealthKit:
  /// observer queries only deliver to a process that registered them.
  func resume() {
    guard let config = loadConfig() else { return }
    startObservers(for: config.metrics)
  }

  func configure(_ config: HealthBackgroundSyncConfig?) {
    stopObservers()
    guard let config else {
      plugin?.store.disableAllBackgroundDelivery { _, _ in }
      deleteConfig()
      UserDefaults.standard.removeObject(forKey: healthSyncLastSyncKey)
      UserDefaults.standard.removeObject(forKey: healthSyncLastErrorKey)
      return
    }
    saveConfig(config)
    startObservers(for: config.metrics)
  }

  func status() -> [String: Any] {
    var status: [String: Any] = ["enabled": loadConfig() != nil]
    if let lastSyncAt = UserDefaults.standard.string(forKey: healthSyncLastSyncKey) {
      status["lastSyncAt"] = lastSyncAt
    }
    if let lastError = UserDefaults.standard.string(forKey: healthSyncLastErrorKey) {
      status["lastError"] = lastError
    }
    return status
  }

  /// Runs one sync. Calls that arrive while one is running are answered by a
  /// single follow-up run, so a burst of observer wakes costs two uploads, not ten.
  func syncNow(completion: @escaping () -> Void) {
    queue.async {
      self.waiting.append(completion)
      if self.running {
        self.rerunRequested = true
        return
      }
      self.running = true
      self.runSync()
    }
  }

  private func runSync() {
    let finishing = waiting
    waiting = []
    performSync { [weak self] error in
      guard let self else { return }
      self.queue.async {
        if let error {
          UserDefaults.standard.set(error, forKey: healthSyncLastErrorKey)
        } else {
          UserDefaults.standard.set(healthRfc3339(Date()), forKey: healthSyncLastSyncKey)
          UserDefaults.standard.removeObject(forKey: healthSyncLastErrorKey)
        }
        finishing.forEach { $0() }
        if self.rerunRequested {
          self.rerunRequested = false
          self.runSync()
        } else {
          self.running = false
        }
      }
    }
  }

  private func performSync(completion: @escaping (String?) -> Void) {
    guard let plugin, let config = loadConfig(), let url = URL(string: config.syncUrl) else {
      completion("not-configured")
      return
    }
    let firstSync = UserDefaults.standard.string(forKey: healthSyncLastSyncKey) == nil
    let window = healthSyncWindow(days: firstSync ? healthSyncBackfillDays : healthSyncRecentDays)
    let metrics = config.metrics.filter { allHealthMetrics.contains($0) }
    let generatedAt = healthRfc3339(Date())
    plugin.readDailyRecords(metrics: metrics, window: window, generatedAt: generatedAt) {
      recordsByMetric in
      var batches: [[String]] = []
      var index = 0
      while index < metrics.count {
        batches.append(Array(metrics[index..<min(index + healthSyncMetricsPerBatch, metrics.count)]))
        index += healthSyncMetricsPerBatch
      }
      self.upload(
        batches: batches,
        recordsByMetric: recordsByMetric,
        window: window,
        generatedAt: generatedAt,
        url: url,
        config: config,
        completion: completion
      )
    }
  }

  private func upload(
    batches: [[String]],
    recordsByMetric: [String: [[String: Any]]],
    window: HealthQueryWindow,
    generatedAt: String,
    url: URL,
    config: HealthBackgroundSyncConfig,
    completion: @escaping (String?) -> Void
  ) {
    guard let metrics = batches.first else {
      completion(nil)
      return
    }
    let body: [String: Any] = [
      "schemaVersion": 1,
      "batchId": UUID().uuidString,
      "generatedAt": generatedAt,
      "timeZone": TimeZone.current.identifier,
      "startDate": window.localDate(window.start),
      "endDateExclusive": window.localDate(window.endExclusive),
      "metrics": metrics,
      "records": metrics.flatMap { recordsByMetric[$0] ?? [] },
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: body) else {
      completion("encode-failed")
      return
    }
    var request = URLRequest(url: url, timeoutInterval: healthSyncRequestTimeout)
    request.httpMethod = "POST"
    request.httpBody = data
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(config.deviceId, forHTTPHeaderField: "X-Piwin-Device-Id")
    request.setValue("Bearer \(config.deviceSecret)", forHTTPHeaderField: "Authorization")
    let session = URLSession(configuration: .ephemeral)
    session.dataTask(with: request) { _, response, error in
      session.finishTasksAndInvalidate()
      if error != nil {
        completion("host-unreachable")
        return
      }
      let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
      guard statusCode == 200 else {
        // The status alone is enough to act on; response bodies are not kept.
        completion("host-status-\(statusCode)")
        return
      }
      self.upload(
        batches: Array(batches.dropFirst()),
        recordsByMetric: recordsByMetric,
        window: window,
        generatedAt: generatedAt,
        url: url,
        config: config,
        completion: completion
      )
    }.resume()
  }

  private func startObservers(for metrics: [String]) {
    guard let plugin, HKHealthStore.isHealthDataAvailable() else { return }
    for objectType in healthObjectTypes(for: metrics) {
      guard let sampleType = objectType as? HKSampleType else { continue }
      let query = HKObserverQuery(sampleType: sampleType, predicate: nil) {
        [weak self] _, observerCompletion, error in
        guard let self, error == nil else {
          observerCompletion()
          return
        }
        // HealthKit stops delivering to an app that does not acknowledge a wake.
        self.syncNow { observerCompletion() }
      }
      plugin.store.execute(query)
      plugin.store.enableBackgroundDelivery(for: sampleType, frequency: .hourly) { _, _ in }
      observers.append(query)
    }
  }

  private func stopObservers() {
    for query in observers {
      plugin?.store.stop(query)
    }
    observers = []
  }

  private func loadConfig() -> HealthBackgroundSyncConfig? {
    var query = keychainQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data
    else {
      return nil
    }
    return try? JSONDecoder().decode(HealthBackgroundSyncConfig.self, from: data)
  }

  private func saveConfig(_ config: HealthBackgroundSyncConfig) {
    guard let data = try? JSONEncoder().encode(config) else { return }
    deleteConfig()
    var attributes = keychainQuery()
    attributes[kSecValueData as String] = data
    // A background wake can come while the phone is locked.
    attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(attributes as CFDictionary, nil)
  }

  private func deleteConfig() {
    SecItemDelete(keychainQuery() as CFDictionary)
  }

  private func keychainQuery() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: healthSyncKeychainService,
      kSecAttrAccount as String: healthSyncKeychainAccount,
    ]
  }
}
