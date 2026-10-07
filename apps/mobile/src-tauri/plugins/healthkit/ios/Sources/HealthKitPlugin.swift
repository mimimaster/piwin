import Foundation
import HealthKit
import Tauri
import WebKit

struct HealthReadRequest: Decodable {
  let requestId: String
  let arguments: HealthReadArguments
}

struct HealthReadInvokeArgs: Decodable {
  let request: HealthReadRequest
}

struct HealthAuthInvokeArgs: Decodable {
  let metrics: [String]?
}

struct HealthCancelInvokeArgs: Decodable {
  let requestId: String
}

struct HealthBackgroundSyncInvokeArgs: Decodable {
  /// Absent turns background sync off and forgets the stored credential.
  let config: HealthBackgroundSyncConfig?
}

/// One metric's daily records over the whole query window (requested days and
/// baseline days alike) plus its hourly buckets for the requested window.
struct HealthMetricPart {
  var records: [[String: Any]]
  var hourlyRecords: [[String: Any]] = []
  var warning: String?
}

enum HealthMetricReadError: String, Error {
  case cancelled
  case unsupported
  case queryFailed = "query-failed"
  case notAuthorizedOrNoData = "not-authorized-or-no-data"
}

class HealthKitPlugin: Plugin {
  let store = HKHealthStore()
  private let lock = NSLock()
  private var activeQueries: [String: [HKQuery]] = [:]
  private var cancelledIds: Set<String> = []
  private lazy var backgroundSync = HealthBackgroundSync(plugin: self)

  @objc public override func load(webview: WKWebView) {
    backgroundSync.resume()
  }

  @objc public func healthkit_background_sync_configure(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(HealthBackgroundSyncInvokeArgs.self)
    backgroundSync.configure(args.config)
    invoke.resolve(backgroundSync.status())
  }

  @objc public func healthkit_background_sync_status(_ invoke: Invoke) {
    invoke.resolve(backgroundSync.status())
  }

  @objc public func healthkit_background_sync_now(_ invoke: Invoke) {
    backgroundSync.syncNow {
      invoke.resolve(self.backgroundSync.status())
    }
  }

  /// Daily records of every metric over the window, for background sync.
  /// A metric that cannot be read contributes no records rather than failing the rest.
  func readDailyRecords(
    metrics: [String],
    window: HealthQueryWindow,
    generatedAt: String,
    completion: @escaping ([String: [[String: Any]]]) -> Void
  ) {
    let requestId = "background-sync-\(UUID().uuidString)"
    let group = DispatchGroup()
    let resultLock = NSLock()
    var recordsByMetric: [String: [[String: Any]]] = [:]
    for metric in metrics {
      group.enter()
      readMetric(
        metric,
        window: window,
        requestId: requestId,
        timeZone: TimeZone.current.identifier,
        generatedAt: generatedAt
      ) { outcome in
        if case .success(let part) = outcome {
          resultLock.lock()
          recordsByMetric[metric] = part.records.filter {
            window.requestedDates.contains(recordLocalDate($0))
          }
          resultLock.unlock()
        }
        group.leave()
      }
    }
    group.notify(queue: .global(qos: .utility)) {
      self.clear(requestId: requestId)
      completion(recordsByMetric)
    }
  }

  @objc public func healthkit_is_available(_ invoke: Invoke) {
    invoke.resolve(HKHealthStore.isHealthDataAvailable())
  }

  @objc public func healthkit_authorization_request_status(_ invoke: Invoke) {
    guard HKHealthStore.isHealthDataAvailable() else {
      invoke.reject("healthkit-unavailable")
      return
    }
    let types = healthObjectTypes(for: allHealthMetrics)
    store.getRequestStatusForAuthorization(toShare: [], read: types) { status, error in
      if error != nil {
        invoke.resolve("unknown")
        return
      }
      switch status {
      case .shouldRequest:
        invoke.resolve("should-request")
      case .unnecessary:
        invoke.resolve("unnecessary")
      default:
        invoke.resolve("unknown")
      }
    }
  }

  @objc public func healthkit_request_read_authorization(_ invoke: Invoke) throws {
    guard HKHealthStore.isHealthDataAvailable() else {
      invoke.reject("healthkit-unavailable")
      return
    }
    let args = try invoke.parseArgs(HealthAuthInvokeArgs.self)
    let metrics = {
      if let requested = args.metrics, !requested.isEmpty {
        return requested
      }
      return allHealthMetrics
    }()
    let types = healthObjectTypes(for: metrics)
    DispatchQueue.main.async {
      self.store.requestAuthorization(toShare: [], read: types) { _, error in
        if error != nil {
          invoke.reject("healthkit-query-failed")
          return
        }
        invoke.resolve(["ok": true])
      }
    }
  }

  @objc public func healthkit_cancel_read(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(HealthCancelInvokeArgs.self)
    cancel(requestId: args.requestId)
    invoke.resolve(["cancelled": true])
  }

  @objc public func healthkit_read_context(_ invoke: Invoke) throws {
    guard HKHealthStore.isHealthDataAvailable() else {
      invoke.reject("healthkit-unavailable")
      return
    }
    let args = try invoke.parseArgs(HealthReadInvokeArgs.self)
    let requestId = args.request.requestId
    let metrics = Array(Set(args.request.arguments.metrics)).filter {
      allHealthMetrics.contains($0)
    }
    guard !metrics.isEmpty else {
      invoke.reject("healthkit-query-failed")
      return
    }
    guard let window = resolveHealthQueryWindow(args.request.arguments) else {
      invoke.reject("healthkit-query-failed")
      return
    }

    lock.lock()
    cancelledIds.remove(requestId)
    activeQueries[requestId] = []
    lock.unlock()

    ensureReadAuthorization(for: metrics) {
      self.read(metrics: metrics, window: window, requestId: requestId, invoke: invoke)
    }
  }

  /// Categories added after the user first connected have never been asked
  /// for. The system sheet covers exactly those; already-decided ones stay as
  /// they are and no sheet appears.
  private func ensureReadAuthorization(for metrics: [String], then proceed: @escaping () -> Void) {
    let types = healthObjectTypes(for: metrics)
    guard !types.isEmpty else {
      proceed()
      return
    }
    store.getRequestStatusForAuthorization(toShare: [], read: types) { status, _ in
      guard status == .shouldRequest else {
        proceed()
        return
      }
      DispatchQueue.main.async {
        self.store.requestAuthorization(toShare: [], read: types) { _, _ in
          proceed()
        }
      }
    }
  }

  private func read(
    metrics: [String],
    window: HealthQueryWindow,
    requestId: String,
    invoke: Invoke
  ) {
    let group = DispatchGroup()
    let resultLock = NSLock()
    var records: [[String: Any]] = []
    var baselineRecords: [[String: Any]] = []
    var unavailable: [[String: String]] = []
    var warnings: [String] = []
    let timeZone = TimeZone.current.identifier
    let generatedAt = healthRfc3339(Date())

    for metric in metrics {
      group.enter()
      readMetric(
        metric,
        window: window,
        requestId: requestId,
        timeZone: timeZone,
        generatedAt: generatedAt
      ) { outcome in
        resultLock.lock()
        switch outcome {
        case .success(let part):
          let requested =
            part.records.filter { window.requestedDates.contains(recordLocalDate($0)) }
            + part.hourlyRecords
          if requested.isEmpty {
            unavailable.append([
              "metric": metric,
              "reason": HealthMetricReadError.notAuthorizedOrNoData.rawValue,
            ])
          } else {
            records.append(contentsOf: requested)
            if let warning = part.warning, !warnings.contains(warning) {
              warnings.append(warning)
            }
          }
          if !healthMetricsWithoutBaseline.contains(metric) {
            baselineRecords.append(
              contentsOf: part.records.filter {
                window.baselineDates.contains(recordLocalDate($0))
              })
          }
        case .failure(let reason):
          unavailable.append(["metric": metric, "reason": reason.rawValue])
        }
        resultLock.unlock()
        group.leave()
      }
    }

    group.notify(queue: .global(qos: .userInitiated)) {
      defer { self.clear(requestId: requestId) }
      if self.isCancelled(requestId) {
        invoke.reject("cancelled")
        return
      }
      if records.isEmpty {
        invoke.reject("healthkit-no-accessible-data")
        return
      }
      if !unavailable.isEmpty, !warnings.contains("partial-result") {
        warnings.append("partial-result")
      }
      if healthTimezoneChanged(during: window) {
        warnings.append("timezone-changed-within-range")
      }
      var response: [String: Any] = [
        "schemaVersion": 1,
        "source": "apple-health",
        "timeZone": timeZone,
        "startAt": healthRfc3339(window.start),
        "endAt": healthRfc3339(window.endExclusive),
        "generatedAt": generatedAt,
        "records": records,
        "unavailableMetrics": unavailable,
        "warnings": warnings,
      ]
      // The shell turns the baseline days into statistics and drops the days;
      // they are handed over separately so they can never pass as records.
      if let startDate = window.baselineStartDate,
        let endDateExclusive = window.baselineEndDateExclusive
      {
        response["baselineRecords"] = baselineRecords
        response["baselineWindow"] = [
          "startDate": startDate,
          "endDateExclusive": endDateExclusive,
        ]
      }
      invoke.resolve(response)
    }
  }

  private func readMetric(
    _ metric: String,
    window: HealthQueryWindow,
    requestId: String,
    timeZone: String,
    generatedAt: String,
    completion: @escaping (Result<HealthMetricPart, HealthMetricReadError>) -> Void
  ) {
    if isCancelled(requestId) {
      completion(.failure(.cancelled))
      return
    }
    switch metric {
    case "workouts":
      readWorkouts(
        window: window, requestId: requestId, generatedAt: generatedAt, completion: completion)
    case "sleep-duration":
      readSleep(
        .duration, window: window, requestId: requestId, timeZone: timeZone,
        generatedAt: generatedAt, completion: completion)
    case "sleep-stages":
      readSleep(
        .stages, window: window, requestId: requestId, timeZone: timeZone,
        generatedAt: generatedAt, completion: completion)
    case "sleep-schedule":
      readSleep(
        .schedule, window: window, requestId: requestId, timeZone: timeZone,
        generatedAt: generatedAt, completion: completion)
    case "mindful-minutes":
      readMindfulMinutes(
        window: window, requestId: requestId, generatedAt: generatedAt, completion: completion)
    default:
      guard let spec = healthQuantitySpec(for: metric) else {
        completion(.failure(.unsupported))
        return
      }
      readQuantity(
        metric: metric, spec: spec, window: window, requestId: requestId,
        generatedAt: generatedAt, completion: completion)
    }
  }

  func execute(_ query: HKQuery, requestId: String) {
    lock.lock()
    activeQueries[requestId, default: []].append(query)
    lock.unlock()
    store.execute(query)
  }

  func isCancelled(_ requestId: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return cancelledIds.contains(requestId)
  }

  private func cancel(requestId: String) {
    lock.lock()
    cancelledIds.insert(requestId)
    let queries = activeQueries.removeValue(forKey: requestId) ?? []
    lock.unlock()
    for query in queries {
      store.stop(query)
    }
  }

  private func clear(requestId: String) {
    lock.lock()
    activeQueries.removeValue(forKey: requestId)
    cancelledIds.remove(requestId)
    lock.unlock()
  }
}

private func recordLocalDate(_ record: [String: Any]) -> String {
  record["localDate"] as? String ?? ""
}

@_cdecl("init_plugin_piwin_healthkit")
func initPlugin() -> Plugin {
  return HealthKitPlugin()
}
