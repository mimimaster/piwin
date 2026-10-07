import XCTest
import HealthKitAggregation

final class HealthKitAggregationTests: XCTestCase {
  func testUnionsOverlappingIntervalsInsteadOfSummingThem() {
    let unioned = unionIntervals([
      SleepInterval(startMs: 0, endMs: 60 * 60_000),
      SleepInterval(startMs: 30 * 60_000, endMs: 90 * 60_000),
    ])
    XCTAssertEqual(unioned, [SleepInterval(startMs: 0, endMs: 90 * 60_000)])
  }

  func testJoinsGapsOfAtMost120MinutesIntoOneSleepEpisode() {
    let episodes = groupSleepEpisodes([
      SleepInterval(startMs: 0, endMs: 60 * 60_000),
      SleepInterval(startMs: 180 * 60_000, endMs: 240 * 60_000),
    ])
    XCTAssertEqual(episodes.count, 1)
    XCTAssertEqual(episodes.first, SleepInterval(startMs: 0, endMs: 240 * 60_000))
  }

  func testAttributesAnEpisodeToTheLocalDateOnWhichItEnds() {
    let end = isoMillis("2026-03-08T07:00:00Z")
    let start = end - 8 * 60 * 60_000
    let localDate = attributeSleepEpisodeToLocalDate(
      episode: SleepInterval(startMs: start, endMs: end),
      timeZone: "America/New_York"
    )
    XCTAssertEqual(localDate, "2026-03-08")
  }

  func testKeepsDSTSpringForwardDaysAsSeparateLocalDates() {
    let before = isoMillis("2026-03-08T06:30:00-05:00")
    let after = isoMillis("2026-03-08T08:30:00-04:00")
    let totals = sleepMinutesByLocalDate(
      intervals: [SleepInterval(startMs: before, endMs: after)],
      timeZone: "America/New_York"
    )
    XCTAssertEqual(Array(totals.keys), ["2026-03-08"])
  }

  func testReportsBedtimeAndWakeOfTheMainEpisodeAcrossMidnight() {
    let schedules = sleepScheduleByLocalDate(
      intervals: [
        SleepInterval(
          startMs: isoMillis("2026-03-02T23:30:00+08:00"),
          endMs: isoMillis("2026-03-03T07:15:00+08:00")
        ),
        // An afternoon nap ends on the same local date and must not win.
        SleepInterval(
          startMs: isoMillis("2026-03-03T13:00:00+08:00"),
          endMs: isoMillis("2026-03-03T13:40:00+08:00")
        ),
      ],
      timeZone: "Asia/Shanghai"
    )
    XCTAssertEqual(
      schedules["2026-03-03"],
      SleepSchedule(bedtimeMinutesAfterNoon: 690, wakeMinuteOfDay: 435, spanMinutes: 465)
    )
  }

  func testKeepsBedtimeOrderedWhenSleepStartsAfterMidnight() {
    let schedules = sleepScheduleByLocalDate(
      intervals: [
        SleepInterval(
          startMs: isoMillis("2026-03-03T01:00:00+08:00"),
          endMs: isoMillis("2026-03-03T08:00:00+08:00")
        )
      ],
      timeZone: "Asia/Shanghai"
    )
    XCTAssertEqual(schedules["2026-03-03"]?.bedtimeMinutesAfterNoon, 780)
    XCTAssertEqual(schedules["2026-03-03"]?.wakeMinuteOfDay, 480)
  }

  private func isoMillis(_ value: String) -> Double {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    let date = formatter.date(from: value)
    XCTAssertNotNil(date, value)
    return (date?.timeIntervalSince1970 ?? 0) * 1000
  }
}
