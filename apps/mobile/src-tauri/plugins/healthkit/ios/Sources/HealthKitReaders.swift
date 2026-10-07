import Foundation
import HealthKit

enum HealthSleepReadMode {
  case duration
  case stages
  case schedule
}

private struct HealthStatisticsBucket {
  let start: Date
  let value: Double
}

/// HealthKit queries, one per metric family. Each reader reports every day of
/// the query window; the plugin decides which days are requested records and
/// which only feed the baseline.
extension HealthKitPlugin {
  func readQuantity(
    metric: String,
    spec: HealthQuantitySpec,
    window: HealthQueryWindow,
    requestId: String,
    generatedAt: String,
    completion: @escaping (Result<HealthMetricPart, HealthMetricReadError>) -> Void
  ) {
    guard let quantityType = HKQuantityType.quantityType(forIdentifier: spec.identifier) else {
      completion(.failure(.unsupported))
      return
    }
    readStatistics(
      quantityType: quantityType,
      spec: spec,
      start: window.queryStart,
      endExclusive: window.endExclusive,
      interval: DateComponents(day: 1),
      requestId: requestId
    ) { [weak self] daily in
      guard let self else { return }
      switch daily {
      case .failure(let reason):
        completion(.failure(reason))
      case .success(let buckets):
        let records: [[String: Any]] = buckets.map { bucket in
          [
            "metric": metric,
            "localDate": window.localDate(bucket.start),
            "unit": spec.unitName,
            "value": bucket.value,
            "freshAsOf": generatedAt,
          ]
        }
        guard window.hourly, spec.cumulative else {
          completion(.success(HealthMetricPart(records: records)))
          return
        }
        self.readStatistics(
          quantityType: quantityType,
          spec: spec,
          start: window.start,
          endExclusive: window.endExclusive,
          interval: DateComponents(hour: 1),
          requestId: requestId
        ) { hourly in
          // The day total already answers the question; a failed hourly
          // breakdown only loses detail.
          let hourlyBuckets = (try? hourly.get()) ?? []
          completion(
            .success(
              HealthMetricPart(
                records: records,
                hourlyRecords: self.hourlyRecords(
                  hourlyBuckets, metric: metric, unitName: spec.unitName, window: window,
                  generatedAt: generatedAt)
              )))
        }
      }
    }
  }

  private func hourlyRecords(
    _ buckets: [HealthStatisticsBucket],
    metric: String,
    unitName: String,
    window: HealthQueryWindow,
    generatedAt: String
  ) -> [[String: Any]] {
    // A clock change can repeat a local hour; those buckets are one hour to the reader.
    var totals: [String: [Int: Double]] = [:]
    for bucket in buckets {
      let localDate = window.localDate(bucket.start)
      guard window.requestedDates.contains(localDate) else { continue }
      let hour = window.calendar.component(.hour, from: bucket.start)
      totals[localDate, default: [:]][hour, default: 0] += bucket.value
    }
    var records: [[String: Any]] = []
    for localDate in totals.keys.sorted() {
      let hours = totals[localDate] ?? [:]
      for hour in hours.keys.sorted() {
        records.append([
          "metric": metric,
          "localDate": localDate,
          "localHour": hour,
          "unit": unitName,
          "value": hours[hour] ?? 0,
          "freshAsOf": generatedAt,
        ])
      }
    }
    return records
  }

  private func readStatistics(
    quantityType: HKQuantityType,
    spec: HealthQuantitySpec,
    start: Date,
    endExclusive: Date,
    interval: DateComponents,
    requestId: String,
    completion: @escaping (Result<[HealthStatisticsBucket], HealthMetricReadError>) -> Void
  ) {
    let predicate = HKQuery.predicateForSamples(
      withStart: start,
      end: endExclusive,
      options: .strictStartDate
    )
    let query = HKStatisticsCollectionQuery(
      quantityType: quantityType,
      quantitySamplePredicate: predicate,
      options: spec.cumulative ? .cumulativeSum : .discreteAverage,
      anchorDate: start,
      intervalComponents: interval
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
      var buckets: [HealthStatisticsBucket] = []
      collection?.enumerateStatistics(from: start, to: endExclusive.addingTimeInterval(-1)) {
        statistics, stop in
        if self.isCancelled(requestId) {
          stop.pointee = true
          return
        }
        let quantity = spec.cumulative ? statistics.sumQuantity() : statistics.averageQuantity()
        guard let quantity else { return }
        let value = quantity.doubleValue(for: spec.unit) * spec.scale
        guard value.isFinite, value >= 0 else { return }
        buckets.append(HealthStatisticsBucket(start: statistics.startDate, value: value))
      }
      completion(.success(buckets))
    }
    execute(query, requestId: requestId)
  }

  func readWorkouts(
    window: HealthQueryWindow,
    requestId: String,
    generatedAt: String,
    completion: @escaping (Result<HealthMetricPart, HealthMetricReadError>) -> Void
  ) {
    let predicate = HKQuery.predicateForSamples(
      withStart: window.queryStart,
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
        let localDate = window.localDate(workout.endDate)
        let minutes = workout.duration / 60
        guard minutes.isFinite, minutes >= 0 else { continue }
        var bucket = buckets[localDate] ?? (0, 0, [:])
        bucket.minutes += minutes
        bucket.count += 1
        bucket.components[healthWorkoutComponent(workout.workoutActivityType), default: 0] +=
          minutes
        buckets[localDate] = bucket
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
      completion(.success(HealthMetricPart(records: records)))
    }
    execute(query, requestId: requestId)
  }

  func readMindfulMinutes(
    window: HealthQueryWindow,
    requestId: String,
    generatedAt: String,
    completion: @escaping (Result<HealthMetricPart, HealthMetricReadError>) -> Void
  ) {
    guard let mindfulType = HKObjectType.categoryType(forIdentifier: .mindfulSession) else {
      completion(.failure(.unsupported))
      return
    }
    let predicate = HKQuery.predicateForSamples(
      withStart: window.queryStart,
      end: window.endExclusive,
      options: .strictStartDate
    )
    let query = HKSampleQuery(
      sampleType: mindfulType,
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
      var sessionsByDay: [String: [SleepInterval]] = [:]
      for sample in samples ?? [] {
        sessionsByDay[window.localDate(sample.startDate), default: []].append(
          SleepInterval(
            startMs: sample.startDate.timeIntervalSince1970 * 1000,
            endMs: sample.endDate.timeIntervalSince1970 * 1000
          ))
      }
      var records: [[String: Any]] = []
      for localDate in sessionsByDay.keys.sorted() {
        // Two apps logging the same session must not double the minutes.
        let sessions = unionIntervals(sessionsByDay[localDate] ?? [])
        let minutes = sessions.reduce(0.0) { $0 + ($1.endMs - $1.startMs) / 60_000 }
        records.append([
          "metric": "mindful-minutes",
          "localDate": localDate,
          "unit": "minute",
          "value": minutes.rounded(),
          "sampleCount": sessions.count,
          "freshAsOf": generatedAt,
        ])
      }
      completion(.success(HealthMetricPart(records: records)))
    }
    execute(query, requestId: requestId)
  }

  func readSleep(
    _ mode: HealthSleepReadMode,
    window: HealthQueryWindow,
    requestId: String,
    timeZone: String,
    generatedAt: String,
    completion: @escaping (Result<HealthMetricPart, HealthMetricReadError>) -> Void
  ) {
    guard let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
      completion(.failure(.unsupported))
      return
    }
    let lookbackStart = window.queryStart.addingTimeInterval(-sleepLookbackMs / 1000)
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
        if healthSampleIsAsleep(sample.value) {
          asleep.append(interval)
        }
        if let stage = healthSleepStage(sample.value) {
          stageIntervals[stage, default: []].append(interval)
        }
      }
      switch mode {
      case .duration:
        completion(
          .success(
            sleepDurationPart(asleep: asleep, timeZone: timeZone, generatedAt: generatedAt)))
      case .stages:
        completion(
          .success(
            sleepStagesPart(
              asleep: asleep, stageIntervals: stageIntervals, timeZone: timeZone,
              generatedAt: generatedAt)))
      case .schedule:
        completion(
          .success(
            sleepSchedulePart(asleep: asleep, timeZone: timeZone, generatedAt: generatedAt)))
      }
    }
    execute(query, requestId: requestId)
  }
}

private func sleepDurationPart(
  asleep: [SleepInterval],
  timeZone: String,
  generatedAt: String
) -> HealthMetricPart {
  var minutesByDay: [String: Int] = [:]
  var episodeCount: [String: Int] = [:]
  for episode in groupSleepEpisodes(asleep) {
    let day = attributeSleepEpisodeToLocalDate(episode: episode, timeZone: timeZone)
    let minutes = Int(((episode.endMs - episode.startMs) / 60_000).rounded())
    minutesByDay[day, default: 0] += minutes
    episodeCount[day, default: 0] += 1
  }
  let records: [[String: Any]] = minutesByDay.keys.sorted().map { day in
    [
      "metric": "sleep-duration",
      "localDate": day,
      "unit": "minute",
      "value": minutesByDay[day] ?? 0,
      "sampleCount": episodeCount[day] ?? 0,
      "freshAsOf": generatedAt,
    ]
  }
  return HealthMetricPart(records: records)
}

private func sleepStagesPart(
  asleep: [SleepInterval],
  stageIntervals: [String: [SleepInterval]],
  timeZone: String,
  generatedAt: String
) -> HealthMetricPart {
  let asleepByDay = sleepMinutesByLocalDate(intervals: asleep, timeZone: timeZone)
  var stageByDay: [String: [String: Int]] = [:]
  for (stage, intervals) in stageIntervals {
    for (day, minutes) in sleepMinutesByLocalDate(intervals: intervals, timeZone: timeZone) {
      stageByDay[day, default: [:]][stage] = minutes
    }
  }
  var warning: String?
  var records: [[String: Any]] = []
  for day in Set(asleepByDay.keys).union(stageByDay.keys).sorted() {
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
  return HealthMetricPart(records: records, warning: warning)
}

private func sleepSchedulePart(
  asleep: [SleepInterval],
  timeZone: String,
  generatedAt: String
) -> HealthMetricPart {
  let schedules = sleepScheduleByLocalDate(intervals: asleep, timeZone: timeZone)
  let records: [[String: Any]] = schedules.keys.sorted().compactMap { day in
    guard let schedule = schedules[day] else { return nil }
    return [
      "metric": "sleep-schedule",
      "localDate": day,
      "unit": "minute",
      "value": schedule.spanMinutes,
      "components": [
        "bedtime-minutes-after-noon": schedule.bedtimeMinutesAfterNoon,
        "wake-minute-of-day": schedule.wakeMinuteOfDay,
      ],
      "freshAsOf": generatedAt,
    ]
  }
  return HealthMetricPart(records: records)
}
