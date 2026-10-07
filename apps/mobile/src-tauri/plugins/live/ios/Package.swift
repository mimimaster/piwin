// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "tauri-plugin-piwin-live",
  platforms: [.iOS(.v15)],
  products: [.library(name: "tauri-plugin-piwin-live", type: .static, targets: ["tauri-plugin-piwin-live"])],
  dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
  targets: [.target(name: "tauri-plugin-piwin-live", dependencies: [.byName(name: "Tauri")], path: "Sources", exclude: ["PiwinLiveIntents.swift"])]
)
