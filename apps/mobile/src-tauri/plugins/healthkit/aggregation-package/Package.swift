// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "HealthKitAggregation",
  platforms: [
    .macOS(.v12)
  ],
  products: [
    .library(name: "HealthKitAggregation", targets: ["HealthKitAggregation"])
  ],
  targets: [
    .target(name: "HealthKitAggregation"),
    .testTarget(
      name: "HealthKitAggregationTests",
      dependencies: ["HealthKitAggregation"]
    ),
  ]
)
