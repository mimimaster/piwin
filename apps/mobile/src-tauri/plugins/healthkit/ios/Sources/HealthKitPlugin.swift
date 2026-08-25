import Foundation
import HealthKit
import Tauri

struct HealthRangeSpec: Decodable {
  let preset: String
  let startDate: String?
  let endDateExclusive: String?
}

struct HealthReadArguments: Decodable {
  let metrics: [String]
  let range: HealthRangeSpec
  let granularity: String?
  let includePreviousPeriod: Bool?
}

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

private let allM1Metrics = [
  "steps",
  "active-energy",
  "exercise-minutes",
  "workouts",
  "sleep-duration",
  "sleep-stages",
  "resting-heart-rate",
  "heart-rate-variability",
]

class HealthKitPlugin: Plugin {
  private let store = HKHealthStore()
  private let lock = NSLock()
  private var activeQueries: [String: [HKQuery]] = [:]
  private var cancelledIds: Set<String> = []

  @objc public func healthkit_is_available(_ invoke: Invoke) {
    invoke.resolve(HKHealthStore.isHealthDataAvailable())
  }

  @objc public func healthkit_authorization_request_status(_ invoke: Invoke) {
    guard HKHealthStore.isHealthDataAvailable() else {
      invoke.reject("healthkit-unavailable")
      return
    }
    let types = objectTypes(for: allM1Metrics)
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
      return allM1Metrics
    }()
    let types = objectTypes(for: metrics)
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
    let metrics = Array(Set(args.request.arguments.metrics)).filter { allM1Metrics.contains($0) }
    guard !metrics.isEmpty else {
      invoke.reject("healthkit-query-failed")
      return
    }
    guard let window = resolveWindow(args.request.arguments) else {
      invoke.reject("healthkit-query-failed")
      return
    }

    lock.lock()
    cancelledIds.remove(requestId)
    activeQueries[requestId] = []
    lock.unlock()

    let group = DispatchGroup()
    let resultLock = NSLock()
    var records: [[String: Any]] = []
    var unavailable: [[String: String]] = []
    var warnings: [String] = []
    let timeZone = TimeZone.current.identifier
    let generatedAt = rfc3339(Date())

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
          records.append(contentsOf: part.records)
          if let warning = part.warning, !warnings.contains(warning) {
            warnings.append(warning)
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
      if self.timezoneChanged(during: window) {
        warnings.append("timezone-changed-within-range")
      }
      invoke.resolve([
        "schemaVersion": 1,
        "source": "apple-health",
        "timeZone": timeZone,
        "startAt": rfc3339(window.start),
        "endAt": rfc3339(window.endExclusive),
        "generatedAt": generatedAt,
        "records": records,
        "unavailableMetrics": unavailable,
        "warnings": warnings,
      ])
    }
  }

  private struct MetricPart {
    let records: [[String: Any]]
    let warning: String?
  }

  private enum MetricReadError: String, Error {
    case cancelled
    case unsupported
    case queryFailed = "query-failed"
    case notAuthorizedOrNoData = "not-authorized-or-no-data"
  }

  private struct QueryWindow {
    let start: Date
    let endExclusive: Date
    let requestedDates: Set<String>
    let calendar: Calendar
  }

  private func readMetric(
    _ metric: String,
    window: QueryWindow,
    requestId: String,
    timeZone: String,
    generatedAt: String,
    completion: @escaping (Result<MetricPart, MetricReadError>) -> Void
  ) {
    if isCancelled(requestId) {
      completion(.failure(.cancelled))
      return
    }
    switch metric {
    case "steps":
      readQuantity(
        identifier: .stepCount,
        unit: HKUnit.count(),
        options: .cumulativeSum,
        metric: metric,
        unitName: "count",
        window: window,
        requestId: requestId,
        generatedAt: generatedAt,
        completion: completion
      )
    case "active-energy":
      readQuantity(
        identifier: .activeEnergyBurned,
        unit: HKUnit.kilocalorie(),
        options: .cumulativeSum,
        metric: metric,
        unitName: "kcal",
        window: window,
        requestId: requestId,
        generatedAt: generatedAt,
        completion: completion
      )
    case "exercise-minutes":
      readQuantity(
        identifier: .appleExerciseTime,
        unit: HKUnit.minute(),
        options: .cumulativeSum,
        metric: metric,
        unitName: "minute",
        window: window,
        requestId: requestId,
        generatedAt: generatedAt,
        completion: completion
      )
    case "resting-heart-rate":
      readQuantity(
        identifier: .restingHeartRate,
        unit: HKUnit.count().unitDivided(by: HKUnit.minute()),
        options: .discreteAverage,
        metric: metric,
        unitName: "bpm",
        window: window,
        requestId: requestId,
        generatedAt: generatedAt,
        completion: completion
      )
    case "heart-rate-variability":
      readQuantity(
        identifier: .heartRateVariabilitySDNN,
        unit: HKUnit.secondUnit(with: .milli),
        options: .discreteAverage,
        metric: metric,
        unitName: "ms",
        window: window,
        requestId: requestId,
        generatedAt: generatedAt,
        completion: completion
      )
    case "workouts":
      readWorkouts(window: window, requestId: requestId, generatedAt: generatedAt, completion: completion)
    case "sleep-duration":
      readSleep(window: window, requestId: requestId, timeZone: timeZone, generatedAt: generatedAt, stages: false, completion: completion)
    case "sleep-stages":
      readSleep(window: window, requestId: requestId, timeZone: timeZone, generatedAt: generatedAt, stages: true, completion: completion)
    default:
      completion(.failure(.unsupported))
    }
  }

  private func readQuantity(
    identifier: HKQuantityTypeIdentifier,
    unit: HKUnit,
    options: HKStatisticsOptions,
    metric: String,
    unitName: String,
    window: QueryWindow,
    requestId: String,
    generatedAt: String,
    completion: @escaping (Result<MetricPart, MetricReadError>) -> Void
  ) {
    guard let quantityType = HKQuantityType.quantityType(forIdentifier: identifier) else {
      completion(.failure(.unsupported))
      return
    }
    let predicate = HKQuery.predicateForSamples(
      withStart: window.start,
      end: window.endExclusive,
      options: .strictStartDate
    )
    let query = HKStatisticsCollectionQuery(
      quantityType: quantityType,
      quantitySamplePredicate: predicate,
      options: options,
      anchorDate: window.start,
      intervalComponents: DateComponents(day: 1)
    )
    query.initialResultsHandler = { [weak self] _, collection, error in
      guard let self else { return }
      if self.isCancelled(requestId) {
      completion(.failure(.cancelled))
        return
      }
      if error != nil {
      completion(.failure(.queryFailed))
        return
      }
      var records: [[String: Any]] = []
      collection?.enumerateStatistics(from: window.start, to: window.endExclusive.addingTimeInterval(-1)) { statistics, stop in
        if self.isCancelled(requestId) {
          stop.pointee = true
          return
        }
        let localDate = self.localDate(statistics.startDate, calendar: window.calendar)
        guard window.requestedDates.contains(localDate) else { return }
        let quantity: HKQuantity?
        if options.contains(.cumulativeSum) {
          quantity = statistics.sumQuantity()
        } else {
          quantity = statistics.averageQuantity()
        }
        guard let quantity else { return }
        let value = quantity.doubleValue(for: unit)
        guard value.isFinite, value >= 0 else { return }
        records.append([
          "metric": metric,
          "localDate": localDate,
          "unit": unitName,
          "value": value,
          "freshAsOf": generatedAt,
        ])
      }
      if records.isEmpty {
      completion(.failure(.notAuthorizedOrNoData))
      } else {
        completion(.success(MetricPart(records: records, warning: nil)))
      }
    }
    execute(query, requestId: requestId)
  }

  private func readWorkouts(
    window: QueryWindow,
    requestId: String,
    generatedAt: String,
    completion: @escaping (Result<MetricPart, MetricReadError>) -> Void
  ) {
    let predicate = HKQuery.predicateForSamples(
      withStart: window.start,
      end: window.endExclusive,
      options: .strictStartDate
    )
    let query = HKSampleQuery(
      sampleType: .workoutType(),
      predicate: predicate,
      limit: HKObjectQueryNoLimit,
      sortDescriptors: nil
    ) { [weak self] _, samples, error in
      guard let self else { return }
      if self.isCancelled(requestId) {
      completion(.failure(.cancelled))
        return
      }
      if error != nil {
      completion(.failure(.queryFailed))
        return
      }
      let workouts = (samples as? [HKWorkout]) ?? []
      var buckets: [String: (minutes: Double, count: Int, components: [String: Double])] = [:]
      for workout in workouts {
        let localDate = self.localDate(workout.endDate, calendar: window.calendar)
        guard window.requestedDates.contains(localDate) else { continue }
        let minutes = workout.duration / 60
        guard minutes.isFinite, minutes >= 0 else { continue }
        var bucket = buckets[localDate] ?? (0, 0, [:])
        bucket.minutes += minutes
        bucket.count += 1
        let key = self.workoutComponent(workout.workoutActivityType)
        bucket.components[key, default: 0] += minutes
        buckets[localDate] = bucket
      }
      if buckets.isEmpty {
      completion(.failure(.notAuthorizedOrNoData))
        return
      }
      let records: [[String: Any]] = buckets.keys.sorted().compactMap { localDate in
        guard let bucket = buckets[localDate] else { return nil }
        return [
          "metric": "workouts",
          "localDate": localDate,
          "unit": "minute",
          "value": bucket.minutes,
          "sampleCount": bucket.count,
          "components": bucket.components,
          "freshAsOf": generatedAt,
        ]
      }
      completion(.success(MetricPart(records: records, warning: nil)))
    }
    execute(query, requestId: requestId)
  }

  private func readSleep(
    window: QueryWindow,
    requestId: String,
    timeZone: String,
    generatedAt: String,
    stages: Bool,
    completion: @escaping (Result<MetricPart, MetricReadError>) -> Void
  ) {
    guard let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
      completion(.failure(.unsupported))
      return
    }
    let lookbackStart = window.start.addingTimeInterval(-sleepLookbackMs / 1000)
    let predicate = HKQuery.predicateForSamples(
      withStart: lookbackStart,
      end: window.endExclusive,
      options: .strictStartDate
    )
    let query = HKSampleQuery(
      sampleType: sleepType,
      predicate: predicate,
      limit: HKObjectQueryNoLimit,
      sortDescriptors: nil
    ) { [weak self] _, samples, error in
      guard let self else { return }
      if self.isCancelled(requestId) {
      completion(.failure(.cancelled))
        return
      }
      if error != nil {
      completion(.failure(.queryFailed))
        return
      }
      let categorySamples = (samples as? [HKCategorySample]) ?? []
      var asleep: [SleepInterval] = []
      var stageIntervals: [String: [SleepInterval]] = [:]
      for sample in categorySamples {
        let interval = SleepInterval(
          startMs: sample.startDate.timeIntervalSince1970 * 1000,
          endMs: sample.endDate.timeIntervalSince1970 * 1000
        )
        let stage = self.sleepStage(sample.value)
        if self.isAsleep(sample.value) {
          asleep.append(interval)
        }
        if let stage {
          stageIntervals[stage, default: []].append(interval)
        }
      }
      var warning: String?
      var records: [[String: Any]] = []
      if stages {
        let asleepByDay = sleepMinutesByLocalDate(intervals: asleep, timeZone: timeZone)
        var stageByDay: [String: [String: Int]] = [:]
        for (stage, intervals) in stageIntervals {
          for (day, minutes) in sleepMinutesByLocalDate(intervals: intervals, timeZone: timeZone) {
            stageByDay[day, default: [:]][stage] = minutes
          }
        }
        let days = Set(asleepByDay.keys).union(stageByDay.keys).intersection(window.requestedDates)
        for day in days.sorted() {
          let asleepMinutes = asleepByDay[day] ?? 0
          var components = stageByDay[day] ?? [:]
          let asleepComponentSum =
            (components["core"] ?? 0) + (components["deep"] ?? 0) + (components["rem"] ?? 0)
            + (components["asleep-unspecified"] ?? 0)
          if asleepComponentSum > asleepMinutes, asleepMinutes > 0 {
            warning = "sleep-source-overlap-normalized"
            let scale = Double(asleepMinutes) / Double(asleepComponentSum)
            for key in ["core", "deep", "rem", "asleep-unspecified"] {
              if let value = components[key] {
                components[key] = Int((Double(value) * scale).rounded())
              }
            }
          }
          records.append([
            "metric": "sleep-stages",
            "localDate": day,
            "unit": "minute",
            "value": asleepMinutes,
            "components": components,
            "freshAsOf": generatedAt,
          ])
        }
      } else {
        let episodes = groupSleepEpisodes(asleep)
        var minutesByDay: [String: Int] = [:]
        var episodeCount: [String: Int] = [:]
        for episode in episodes {
          let day = attributeSleepEpisodeToLocalDate(episode: episode, timeZone: timeZone)
          guard window.requestedDates.contains(day) else { continue }
          let minutes = Int(((episode.endMs - episode.startMs) / 60_000).rounded())
          minutesByDay[day, default: 0] += minutes
          episodeCount[day, default: 0] += 1
        }
        for day in minutesByDay.keys.sorted() {
          records.append([
            "metric": "sleep-duration",
            "localDate": day,
            "unit": "minute",
            "value": minutesByDay[day] ?? 0,
            "sampleCount": episodeCount[day] ?? 0,
            "freshAsOf": generatedAt,
          ])
        }
      }
      if records.isEmpty {
      completion(.failure(.notAuthorizedOrNoData))
      } else {
        completion(.success(MetricPart(records: records, warning: warning)))
      }
    }
    execute(query, requestId: requestId)
  }

  private func execute(_ query: HKQuery, requestId: String) {
    lock.lock()
    activeQueries[requestId, default: []].append(query)
    lock.unlock()
    store.execute(query)
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

  private func isCancelled(_ requestId: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return cancelledIds.contains(requestId)
  }

  private func resolveWindow(_ arguments: HealthReadArguments) -> QueryWindow? {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone.current
    let todayStart = calendar.startOfDay(for: Date())
    var start: Date
    var endExclusive: Date
    switch arguments.range.preset {
    case "today":
      start = todayStart
      endExclusive = calendar.date(byAdding: .day, value: 1, to: todayStart) ?? todayStart
    case "last-7-days":
      start = calendar.date(byAdding: .day, value: -6, to: todayStart) ?? todayStart
      endExclusive = calendar.date(byAdding: .day, value: 1, to: todayStart) ?? todayStart
    case "last-30-days":
      start = calendar.date(byAdding: .day, value: -29, to: todayStart) ?? todayStart
      endExclusive = calendar.date(byAdding: .day, value: 1, to: todayStart) ?? todayStart
    case "custom":
      guard
        let startDate = arguments.range.startDate,
        let endDateExclusive = arguments.range.endDateExclusive,
        let parsedStart = parseLocalDate(startDate, calendar: calendar),
        let parsedEnd = parseLocalDate(endDateExclusive, calendar: calendar)
      else {
        return nil
      }
      start = parsedStart
      endExclusive = parsedEnd
    default:
      return nil
    }
    if arguments.includePreviousPeriod == true {
      let days = calendar.dateComponents([.day], from: start, to: endExclusive).day ?? 0
      start = calendar.date(byAdding: .day, value: -days, to: start) ?? start
    }
    let span = calendar.dateComponents([.day], from: start, to: endExclusive).day ?? 0
    if span <= 0 || span > 90 {
      return nil
    }
    let tomorrow = calendar.date(byAdding: .day, value: 1, to: todayStart) ?? todayStart
    if start >= tomorrow || endExclusive > tomorrow {
      return nil
    }
    var requestedDates: Set<String> = []
    var cursor = start
    while cursor < endExclusive {
      requestedDates.insert(localDate(cursor, calendar: calendar))
      cursor = calendar.date(byAdding: .day, value: 1, to: cursor) ?? endExclusive
    }
    return QueryWindow(
      start: start,
      endExclusive: endExclusive,
      requestedDates: requestedDates,
      calendar: calendar
    )
  }

  private func parseLocalDate(_ value: String, calendar: Calendar) -> Date? {
    let parts = value.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return nil }
    var components = DateComponents()
    components.year = parts[0]
    components.month = parts[1]
    components.day = parts[2]
    guard let date = calendar.date(from: components) else { return nil }
    let rebuilt = calendar.dateComponents([.year, .month, .day], from: date)
    guard rebuilt.year == components.year, rebuilt.month == components.month, rebuilt.day == components.day else {
      return nil
    }
    return date
  }

  private func localDate(_ date: Date, calendar: Calendar) -> String {
    let components = calendar.dateComponents([.year, .month, .day], from: date)
    return String(
      format: "%04d-%02d-%02d",
      components.year ?? 0,
      components.month ?? 0,
      components.day ?? 0
    )
  }

  private func timezoneChanged(during window: QueryWindow) -> Bool {
    guard let transition = TimeZone.current.nextDaylightSavingTimeTransition(after: window.start) else {
      return false
    }
    return transition < window.endExclusive
  }

  private func objectTypes(for metrics: [String]) -> Set<HKObjectType> {
    var types = Set<HKObjectType>()
    for metric in metrics {
      switch metric {
      case "steps":
        if let type = HKQuantityType.quantityType(forIdentifier: .stepCount) { types.insert(type) }
      case "active-energy":
        if let type = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) { types.insert(type) }
      case "exercise-minutes":
        if let type = HKQuantityType.quantityType(forIdentifier: .appleExerciseTime) { types.insert(type) }
      case "resting-heart-rate":
        if let type = HKQuantityType.quantityType(forIdentifier: .restingHeartRate) { types.insert(type) }
      case "heart-rate-variability":
        if let type = HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN) { types.insert(type) }
      case "workouts":
        types.insert(.workoutType())
      case "sleep-duration", "sleep-stages":
        if let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { types.insert(type) }
      default:
        break
      }
    }
    return types
  }

  private func workoutComponent(_ type: HKWorkoutActivityType) -> String {
    switch type {
    case .walking:
      return "walking"
    case .running:
      return "running"
    case .cycling:
      return "cycling"
    case .traditionalStrengthTraining, .functionalStrengthTraining:
      return "strength-training"
    case .swimming:
      return "swimming"
    default:
      return "other"
    }
  }

  private func isAsleep(_ value: Int) -> Bool {
    if value == HKCategoryValueSleepAnalysis.asleep.rawValue {
      return true
    }
    if #available(iOS 16.0, *) {
      return value == HKCategoryValueSleepAnalysis.asleepCore.rawValue
        || value == HKCategoryValueSleepAnalysis.asleepDeep.rawValue
        || value == HKCategoryValueSleepAnalysis.asleepREM.rawValue
        || value == HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue
    }
    return false
  }

  private func sleepStage(_ value: Int) -> String? {
    if value == HKCategoryValueSleepAnalysis.awake.rawValue {
      return "awake"
    }
    if #available(iOS 16.0, *) {
      switch value {
      case HKCategoryValueSleepAnalysis.asleepCore.rawValue:
        return "core"
      case HKCategoryValueSleepAnalysis.asleepDeep.rawValue:
        return "deep"
      case HKCategoryValueSleepAnalysis.asleepREM.rawValue:
        return "rem"
      case HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
        HKCategoryValueSleepAnalysis.asleep.rawValue:
        return "asleep-unspecified"
      default:
        return nil
      }
    }
    if value == HKCategoryValueSleepAnalysis.asleep.rawValue {
      return "asleep-unspecified"
    }
    return nil
  }
}

@_cdecl("init_plugin_piwin_healthkit")
func initPlugin() -> Plugin {
  return HealthKitPlugin()
}

private func rfc3339(_ date: Date) -> String {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return formatter.string(from: date)
}
