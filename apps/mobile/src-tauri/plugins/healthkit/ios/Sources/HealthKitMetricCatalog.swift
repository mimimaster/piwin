import Foundation
import HealthKit

/// Metric allowlist. Mirrors `APPLE_HEALTH_METRIC_IDS` in `@piwin/contracts`.
let allHealthMetrics = [
  "steps",
  "active-energy",
  "exercise-minutes",
  "workouts",
  "sleep-duration",
  "sleep-stages",
  "resting-heart-rate",
  "heart-rate-variability",
  "sleep-schedule",
  "body-mass",
  "body-fat-percentage",
  "vo2-max",
  "respiratory-rate",
  "blood-oxygen",
  "wrist-temperature",
  "mindful-minutes",
  "time-in-daylight",
]

/// Composites have no single comparable daily number, so they get no baseline.
/// Mirrors `APPLE_HEALTH_BASELINE_METRIC_IDS`.
let healthMetricsWithoutBaseline: Set<String> = ["workouts", "sleep-stages"]

/// How one quantity metric is read from HealthKit and reported.
struct HealthQuantitySpec {
  let identifier: HKQuantityTypeIdentifier
  let unit: HKUnit
  let unitName: String
  /// Summed over the interval; otherwise the interval's average is reported.
  let cumulative: Bool
  /// HealthKit stores percentages as a 0...1 fraction.
  let scale: Double
}

func healthQuantitySpec(for metric: String) -> HealthQuantitySpec? {
  switch metric {
  case "steps":
    return quantity(.stepCount, HKUnit.count(), "count", cumulative: true)
  case "active-energy":
    return quantity(.activeEnergyBurned, HKUnit.kilocalorie(), "kcal", cumulative: true)
  case "exercise-minutes":
    return quantity(.appleExerciseTime, HKUnit.minute(), "minute", cumulative: true)
  case "time-in-daylight":
    if #available(iOS 17.0, *) {
      return quantity(.timeInDaylight, HKUnit.minute(), "minute", cumulative: true)
    }
    return nil
  case "resting-heart-rate":
    return quantity(.restingHeartRate, HKUnit.count().unitDivided(by: HKUnit.minute()), "bpm")
  case "heart-rate-variability":
    return quantity(.heartRateVariabilitySDNN, HKUnit.secondUnit(with: .milli), "ms")
  case "body-mass":
    return quantity(.bodyMass, HKUnit.gramUnit(with: .kilo), "kg")
  case "body-fat-percentage":
    return quantity(.bodyFatPercentage, HKUnit.percent(), "percent", scale: 100)
  case "vo2-max":
    return quantity(.vo2Max, HKUnit(from: "ml/kg*min"), "ml/kg/min")
  case "respiratory-rate":
    return quantity(
      .respiratoryRate, HKUnit.count().unitDivided(by: HKUnit.minute()), "breaths/min")
  case "blood-oxygen":
    return quantity(.oxygenSaturation, HKUnit.percent(), "percent", scale: 100)
  case "wrist-temperature":
    if #available(iOS 16.0, *) {
      return quantity(.appleSleepingWristTemperature, HKUnit.degreeCelsius(), "degC")
    }
    return nil
  default:
    return nil
  }
}

private func quantity(
  _ identifier: HKQuantityTypeIdentifier,
  _ unit: HKUnit,
  _ unitName: String,
  cumulative: Bool = false,
  scale: Double = 1
) -> HealthQuantitySpec {
  HealthQuantitySpec(
    identifier: identifier, unit: unit, unitName: unitName, cumulative: cumulative, scale: scale)
}

func healthObjectTypes(for metrics: [String]) -> Set<HKObjectType> {
  var types = Set<HKObjectType>()
  for metric in metrics {
    switch metric {
    case "workouts":
      types.insert(.workoutType())
    case "sleep-duration", "sleep-stages", "sleep-schedule":
      if let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { types.insert(type) }
    case "mindful-minutes":
      if let type = HKObjectType.categoryType(forIdentifier: .mindfulSession) { types.insert(type) }
    default:
      if let spec = healthQuantitySpec(for: metric),
        let type = HKQuantityType.quantityType(forIdentifier: spec.identifier)
      {
        types.insert(type)
      }
    }
  }
  return types
}

func healthWorkoutComponent(_ type: HKWorkoutActivityType) -> String {
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

func healthSampleIsAsleep(_ value: Int) -> Bool {
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

func healthSleepStage(_ value: Int) -> String? {
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
