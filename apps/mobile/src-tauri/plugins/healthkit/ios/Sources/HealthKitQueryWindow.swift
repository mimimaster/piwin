import Foundation

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
  let includeBaseline: Bool?
}

/// Length of the trailing baseline window. Mirrors `APPLE_HEALTH_BASELINE_WINDOW_DAYS`.
let healthBaselineWindowDays = 30

/// The local-date window of one read. `queryStart` reaches back over the
/// baseline days when a baseline was asked for; those days are aggregated
/// here but never returned as records.
struct HealthQueryWindow {
  let start: Date
  let endExclusive: Date
  let queryStart: Date
  let requestedDates: Set<String>
  let baselineDates: Set<String>
  let baselineStartDate: String?
  let baselineEndDateExclusive: String?
  /// Add hourly buckets for cumulative metrics (today only).
  let hourly: Bool
  let calendar: Calendar

  func localDate(_ date: Date) -> String {
    healthLocalDate(date, calendar: calendar)
  }
}

func resolveHealthQueryWindow(_ arguments: HealthReadArguments) -> HealthQueryWindow? {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone.current
  let todayStart = calendar.startOfDay(for: Date())
  let tomorrow = calendar.date(byAdding: .day, value: 1, to: todayStart) ?? todayStart
  var start: Date
  let endExclusive: Date
  switch arguments.range.preset {
  case "today":
    start = todayStart
    endExclusive = tomorrow
  case "last-7-days":
    start = calendar.date(byAdding: .day, value: -6, to: todayStart) ?? todayStart
    endExclusive = tomorrow
  case "last-30-days":
    start = calendar.date(byAdding: .day, value: -29, to: todayStart) ?? todayStart
    endExclusive = tomorrow
  case "custom":
    guard
      let startDate = arguments.range.startDate,
      let endDateExclusive = arguments.range.endDateExclusive,
      let parsedStart = parseHealthLocalDate(startDate, calendar: calendar),
      let parsedEnd = parseHealthLocalDate(endDateExclusive, calendar: calendar)
    else {
      return nil
    }
    start = parsedStart
    endExclusive = parsedEnd
  default:
    return nil
  }
  let hourly = arguments.granularity == "hour"
  if hourly, arguments.range.preset != "today" || arguments.includePreviousPeriod == true {
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
  if start >= tomorrow || endExclusive > tomorrow {
    return nil
  }

  var queryStart = start
  var baselineDates: Set<String> = []
  var baselineStartDate: String?
  var baselineEndDateExclusive: String?
  if arguments.includeBaseline == true,
    // The baseline is the 30 days before the last requested day, so that day
    // can be compared against it without being part of it.
    let lastDay = calendar.date(byAdding: .day, value: -1, to: endExclusive),
    let baselineStart = calendar.date(byAdding: .day, value: -healthBaselineWindowDays, to: lastDay)
  {
    baselineDates = healthLocalDates(from: baselineStart, to: lastDay, calendar: calendar)
    baselineStartDate = healthLocalDate(baselineStart, calendar: calendar)
    baselineEndDateExclusive = healthLocalDate(lastDay, calendar: calendar)
    queryStart = min(start, baselineStart)
  }

  return HealthQueryWindow(
    start: start,
    endExclusive: endExclusive,
    queryStart: queryStart,
    requestedDates: healthLocalDates(from: start, to: endExclusive, calendar: calendar),
    baselineDates: baselineDates,
    baselineStartDate: baselineStartDate,
    baselineEndDateExclusive: baselineEndDateExclusive,
    hourly: hourly,
    calendar: calendar
  )
}

/// The trailing `days` local days ending today, for background summary sync.
func healthSyncWindow(days: Int) -> HealthQueryWindow {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone.current
  let todayStart = calendar.startOfDay(for: Date())
  let endExclusive = calendar.date(byAdding: .day, value: 1, to: todayStart) ?? todayStart
  let start = calendar.date(byAdding: .day, value: 1 - days, to: todayStart) ?? todayStart
  return HealthQueryWindow(
    start: start,
    endExclusive: endExclusive,
    queryStart: start,
    requestedDates: healthLocalDates(from: start, to: endExclusive, calendar: calendar),
    baselineDates: [],
    baselineStartDate: nil,
    baselineEndDateExclusive: nil,
    hourly: false,
    calendar: calendar
  )
}

func healthTimezoneChanged(during window: HealthQueryWindow) -> Bool {
  guard let transition = TimeZone.current.nextDaylightSavingTimeTransition(after: window.start)
  else {
    return false
  }
  return transition < window.endExclusive
}

func healthLocalDate(_ date: Date, calendar: Calendar) -> String {
  let components = calendar.dateComponents([.year, .month, .day], from: date)
  return String(
    format: "%04d-%02d-%02d",
    components.year ?? 0,
    components.month ?? 0,
    components.day ?? 0
  )
}

func healthRfc3339(_ date: Date) -> String {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return formatter.string(from: date)
}

func healthLocalDates(from start: Date, to endExclusive: Date, calendar: Calendar)
  -> Set<String>
{
  var dates: Set<String> = []
  var cursor = start
  while cursor < endExclusive {
    dates.insert(healthLocalDate(cursor, calendar: calendar))
    cursor = calendar.date(byAdding: .day, value: 1, to: cursor) ?? endExclusive
  }
  return dates
}

private func parseHealthLocalDate(_ value: String, calendar: Calendar) -> Date? {
  let parts = value.split(separator: "-").compactMap { Int($0) }
  guard parts.count == 3 else { return nil }
  var components = DateComponents()
  components.year = parts[0]
  components.month = parts[1]
  components.day = parts[2]
  guard let date = calendar.date(from: components) else { return nil }
  let rebuilt = calendar.dateComponents([.year, .month, .day], from: date)
  guard
    rebuilt.year == components.year, rebuilt.month == components.month,
    rebuilt.day == components.day
  else {
    return nil
  }
  return date
}
