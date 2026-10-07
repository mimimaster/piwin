import Foundation

/// On-device sleep aggregation. Mirrors
/// `packages/host-client/src/device-tools/apple-health-aggregation.ts`.
public struct SleepInterval: Equatable {
  public var startMs: Double
  public var endMs: Double

  public init(startMs: Double, endMs: Double) {
    self.startMs = startMs
    self.endMs = endMs
  }
}

public let sleepEpisodeGapMs: Double = 120 * 60 * 1000
public let sleepLookbackMs: Double = 18 * 60 * 60 * 1000

public func unionIntervals(_ intervals: [SleepInterval]) -> [SleepInterval] {
  let valid = intervals
    .filter { $0.endMs > $0.startMs }
    .sorted { lhs, rhs in
      if lhs.startMs == rhs.startMs {
        return lhs.endMs < rhs.endMs
      }
      return lhs.startMs < rhs.startMs
    }
  var unioned: [SleepInterval] = []
  for interval in valid {
    if let last = unioned.last, interval.startMs <= last.endMs {
      unioned[unioned.count - 1] = SleepInterval(
        startMs: last.startMs,
        endMs: max(last.endMs, interval.endMs)
      )
    } else {
      unioned.append(interval)
    }
  }
  return unioned
}

public func groupSleepEpisodes(_ intervals: [SleepInterval]) -> [SleepInterval] {
  let unioned = unionIntervals(intervals)
  var episodes: [SleepInterval] = []
  for interval in unioned {
    if let last = episodes.last, interval.startMs - last.endMs <= sleepEpisodeGapMs {
      episodes[episodes.count - 1] = SleepInterval(
        startMs: last.startMs,
        endMs: max(last.endMs, interval.endMs)
      )
    } else {
      episodes.append(interval)
    }
  }
  return episodes
}

public func localDateFromInstant(instantMs: Double, timeZone: String) -> String {
  let date = Date(timeIntervalSince1970: instantMs / 1000)
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(identifier: timeZone) ?? TimeZone.current
  let components = calendar.dateComponents([.year, .month, .day], from: date)
  let year = components.year ?? 0
  let month = components.month ?? 0
  let day = components.day ?? 0
  return String(format: "%04d-%02d-%02d", year, month, day)
}

public func attributeSleepEpisodeToLocalDate(
  episode: SleepInterval,
  timeZone: String
) -> String {
  localDateFromInstant(instantMs: episode.endMs, timeZone: timeZone)
}

public func sleepMinutesByLocalDate(
  intervals: [SleepInterval],
  timeZone: String
) -> [String: Int] {
  var totals: [String: Int] = [:]
  for episode in groupSleepEpisodes(intervals) {
    let localDate = attributeSleepEpisodeToLocalDate(episode: episode, timeZone: timeZone)
    let minutes = Int(((episode.endMs - episode.startMs) / 60_000).rounded())
    totals[localDate, default: 0] += minutes
  }
  return totals
}

public struct SleepSchedule: Equatable {
  /// Minutes from noon of the local day before the wake date (23:30 -> 690, 01:00 -> 780).
  public var bedtimeMinutesAfterNoon: Int
  public var wakeMinuteOfDay: Int
  /// Bedtime to wake, including time awake in between.
  public var spanMinutes: Int

  public init(bedtimeMinutesAfterNoon: Int, wakeMinuteOfDay: Int, spanMinutes: Int) {
    self.bedtimeMinutesAfterNoon = bedtimeMinutesAfterNoon
    self.wakeMinuteOfDay = wakeMinuteOfDay
    self.spanMinutes = spanMinutes
  }
}

/// Bedtime and wake time of each night's main (longest) sleep episode, keyed by
/// the local date it ends on. Naps never override the main episode.
public func sleepScheduleByLocalDate(
  intervals: [SleepInterval],
  timeZone: String
) -> [String: SleepSchedule] {
  var longest: [String: SleepInterval] = [:]
  for episode in groupSleepEpisodes(intervals) {
    let localDate = attributeSleepEpisodeToLocalDate(episode: episode, timeZone: timeZone)
    if let current = longest[localDate],
      current.endMs - current.startMs >= episode.endMs - episode.startMs
    {
      continue
    }
    longest[localDate] = episode
  }
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(identifier: timeZone) ?? TimeZone.current
  var schedules: [String: SleepSchedule] = [:]
  for (localDate, episode) in longest {
    let bed = Date(timeIntervalSince1970: episode.startMs / 1000)
    let wake = Date(timeIntervalSince1970: episode.endMs / 1000)
    let bedDay = calendar.startOfDay(for: bed)
    let wakeDay = calendar.startOfDay(for: wake)
    let daysBeforeWake = calendar.dateComponents([.day], from: bedDay, to: wakeDay).day ?? 0
    let bedtimeMinutesAfterNoon =
      minuteOfDay(bed, calendar: calendar) - 720 + (1 - daysBeforeWake) * 1440
    // An "episode" that began before noon of the previous day is not one night.
    guard bedtimeMinutesAfterNoon >= 0 else { continue }
    schedules[localDate] = SleepSchedule(
      bedtimeMinutesAfterNoon: bedtimeMinutesAfterNoon,
      wakeMinuteOfDay: minuteOfDay(wake, calendar: calendar),
      spanMinutes: Int(((episode.endMs - episode.startMs) / 60_000).rounded())
    )
  }
  return schedules
}

private func minuteOfDay(_ date: Date, calendar: Calendar) -> Int {
  let components = calendar.dateComponents([.hour, .minute], from: date)
  return (components.hour ?? 0) * 60 + (components.minute ?? 0)
}
