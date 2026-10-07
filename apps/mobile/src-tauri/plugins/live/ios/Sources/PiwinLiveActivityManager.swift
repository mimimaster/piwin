import ActivityKit
import Foundation

struct LiveActivitySnapshot: Decodable {
  let callId: String
  let sessionId: String
  let sessionLabel: String
  let startedAt: String
  let phase: String
  let activity: String
  let muted: Bool
}

@available(iOS 16.2, *)
@MainActor
final class PiwinLiveActivityManager {
  private var current: Activity<PiwinLiveAttributes>?
  private var controls: [[String: String]] = []
  private var failedCallId: String?
  var onControl: (() -> Void)?
  var onEnd: ((String) -> Void)?
  #if targetEnvironment(simulator)
  private var previewCallId: String?

  func simulatorPreview(_ url: URLComponents) async throws {
    let action = url.queryItems?.first(where: { $0.name == "action" })?.value ?? "start"
    if action == "clear" { previewCallId = nil; try await sync(nil); return }
    let callId = "piwin-simulator-preview"
    let activity = url.queryItems?.first(where: { $0.name == "activity" })?.value ?? "listening"
    let snapshot = LiveActivitySnapshot(callId: callId, sessionId: "simulator-preview", sessionLabel: "模拟器验收",
      startedAt: ISO8601DateFormatter().string(from: Date()), phase: "active", activity: activity, muted: false)
    previewCallId = callId
    try await sync(snapshot)
  }
  #endif

  func mediaActivity(callId: String, activity: String) async {
    guard let current, current.attributes.callId == callId else { return }
    var state = current.content.state
    state.activity = activity
    await current.update(ActivityContent(state: state, staleDate: nil))
  }

  func mediaFailed(callId: String) async {
    guard let current, current.attributes.callId == callId else { return }
    await current.end(nil, dismissalPolicy: .immediate)
    self.current = nil
    failedCallId = callId
  }

  func install() async {
    // Media is process scoped. A card left by a terminated process is stale.
    for activity in Activity<PiwinLiveAttributes>.activities {
      await activity.end(nil, dismissalPolicy: .immediate)
    }

  }

  func sync(_ snapshot: LiveActivitySnapshot?) async throws {
    guard let snapshot, !["ended", "failed"].contains(snapshot.phase) else {
      let previous = current
      current = nil
      controls.removeAll()
      failedCallId = nil
      await previous?.end(nil, dismissalPolicy: .immediate)
      return
    }
    if failedCallId == snapshot.callId { return }
    guard snapshot.callId.count <= 256, !snapshot.callId.isEmpty else {
      throw NativeLiveActivityError.unavailable
    }
    let state = PiwinLiveAttributes.ContentState(
      sessionId: snapshot.sessionId,
      sessionLabel: String(snapshot.sessionLabel.prefix(80)),
      phase: snapshot.phase, activity: snapshot.activity, muted: snapshot.muted
    )
    let content = ActivityContent(state: state, staleDate: nil)
    if let current, current.attributes.callId == snapshot.callId {
      await current.update(content)
      return
    }
    await current?.end(nil, dismissalPolicy: .immediate)
    controls.removeAll()
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let startedAt = formatter.date(from: snapshot.startedAt)
      ?? ISO8601DateFormatter().date(from: snapshot.startedAt) ?? Date()
    current = try Activity.request(
      attributes: PiwinLiveAttributes(callId: snapshot.callId, startedAt: startedAt),
      content: content, pushType: nil
    )
  }

  func control(callId: String, action: String) async throws {
    guard let current, current.attributes.callId == callId,
      ["toggle-muted", "end", "open-session"].contains(action) else {
      throw NativeLiveActivityError.unavailable
    }
    #if targetEnvironment(simulator)
    if previewCallId == callId {
      if action == "end" { previewCallId = nil; try await sync(nil) }
      if action == "toggle-muted" {
        var state = current.content.state
        state.muted.toggle()
        await current.update(ActivityContent(state: state, staleDate: nil))
      }
      return
    }
    #endif
    if controls.contains(where: { $0["callId"] == callId && $0["action"] == action }) { return }
    if controls.count >= 8 { throw NativeLiveActivityError.unavailable }
    controls.append(["callId": callId, "action": action])
    // Stop the microphone immediately; Host still owns the terminal transition.
    if action == "end" { onEnd?(callId) }
    if action != "open-session" {
      var state = current.content.state
      state.pendingControl = true
      await current.update(ActivityContent(state: state, staleDate: nil))
    }
    onControl?()
  }

  func takeControls() -> [[String: String]] {
    let result = controls
    controls.removeAll()
    return result
  }
}

enum NativeLiveActivityError: Error { case unavailable }
