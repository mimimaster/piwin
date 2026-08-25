// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "tauri-plugin-piwin-healthkit",
  platforms: [
    .iOS(.v15)
  ],
  products: [
    .library(
      name: "tauri-plugin-piwin-healthkit",
      type: .static,
      targets: ["tauri-plugin-piwin-healthkit"]
    )
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-piwin-healthkit",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources"
    )
  ]
)
