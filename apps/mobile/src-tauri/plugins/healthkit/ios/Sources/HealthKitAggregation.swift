import Foundation

/// On-device sleep aggregation. Mirrors
/// `apps/mobile/src/health/apple-health-aggregation.ts`.
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
