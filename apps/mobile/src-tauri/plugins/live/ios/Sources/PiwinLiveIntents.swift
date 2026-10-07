import AppIntents
import Foundation

/// LiveActivityIntent runs in the app process. Controls wake the existing owner
/// and are acknowledged only when the normal Live controller updates the card.
@available(iOS 17.0, *)
struct PiwinLiveMuteIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "切换 Live 麦克风静音"
  static var openAppWhenRun = true
  static var isDiscoverable = false
  @Parameter(title: "通话") var callId: String
  init() {}
  init(callId: String) { self.callId = callId }
  func perform() async throws -> some IntentResult {
    try await sendPiwinLiveControl(callId: callId, action: "toggle-muted")
    return .result()
  }
}

@available(iOS 17.0, *)
struct PiwinLiveEndIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "结束 Live 通话"
  static var openAppWhenRun = true
  static var isDiscoverable = false
  @Parameter(title: "通话") var callId: String
  init() {}
  init(callId: String) { self.callId = callId }
  func perform() async throws -> some IntentResult {
    try await sendPiwinLiveControl(callId: callId, action: "end")
    return .result()
  }
}

enum PiwinLiveIntentError: Error { case unavailable }

@available(iOS 17.0, *)
struct PiwinLiveIntentsPackage: AppIntentsPackage {}

// This source is compiled into the app and widget targets, so each bundle
// publishes its own intent metadata. The native plugin is the sole owner.
private func sendPiwinLiveControl(callId: String, action: String) async throws {
  try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
    let completion = PiwinLiveIntentCompletion(continuation)
    NotificationCenter.default.post(name: Notification.Name("piwin.live.control"), object: nil,
      userInfo: ["callId": callId, "action": action, "completion": { (ok: Bool) in completion.finish(ok) }])
    Task {
      do { try await Task.sleep(nanoseconds: 5_000_000_000) }
      catch { completion.finish(false); return }
      completion.finish(false)
    }
  }
}

private final class PiwinLiveIntentCompletion: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<Void, Error>?
  init(_ continuation: CheckedContinuation<Void, Error>) { self.continuation = continuation }
  func finish(_ ok: Bool) {
    lock.lock()
    let current = continuation
    continuation = nil
    lock.unlock()
    if ok { current?.resume() }
    else { current?.resume(throwing: PiwinLiveIntentError.unavailable) }
  }
}
