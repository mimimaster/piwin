import AVFoundation
import ActivityKit
import Foundation
import Tauri
import WebKit

private struct SyncArgs: Decodable { let activity: LiveActivitySnapshot? }
private struct OpenArgs: Decodable { let url: String }

final class PiwinLivePlugin: Plugin {
  var activityManager: AnyObject?
  var audioConnection: LiveAudioConnection?
  var preparedConnectionId: String?
  private var controlObserver: NSObjectProtocol?

  #if targetEnvironment(simulator)
  @objc func live_activity_preview(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(OpenArgs.self)
    guard let url = URLComponents(string: args.url), url.host == "simulator-preview" else {
      invoke.reject("invalid-preview"); return
    }
    if #available(iOS 17.0, *) {
      Task { @MainActor in
        guard let manager = self.activityManager as? PiwinLiveActivityManager else { invoke.reject("unavailable"); return }
        do { try await manager.simulatorPreview(url); invoke.resolve(["ok": true]) }
        catch { invoke.reject("preview-failed") }
      }
    } else { invoke.reject("unsupported") }
  }
  #endif

  @objc override func load(webview: WKWebView) {
    controlObserver = NotificationCenter.default.addObserver(
      forName: Notification.Name("piwin.live.control"), object: nil, queue: .main
    ) { [weak self] notification in
      let completion = notification.userInfo?["completion"] as? (Bool) -> Void
      guard let callId = notification.userInfo?["callId"] as? String,
        let action = notification.userInfo?["action"] as? String else { completion?(false); return }
      if #available(iOS 17.0, *) {
        Task { @MainActor in
          guard let manager = self?.activityManager as? PiwinLiveActivityManager else { completion?(false); return }
          do { try await manager.control(callId: callId, action: action); completion?(true) }
          catch { completion?(false) }
        }
      } else { completion?(false) }
    }
    if #available(iOS 17.0, *) {
      Task { @MainActor in
        let manager = PiwinLiveActivityManager()
        self.activityManager = manager
        manager.onEnd = { [weak self] callId in
          guard self?.audioConnection?.options.callId == callId else { return }
          self?.audioConnection?.close()
        }
        manager.onControl = { [weak self] in self?.trigger("control", data: [:]) }
        await manager.install()
      }
    }
  }

  @objc func live_activity_status(_ invoke: Invoke) {
    if #available(iOS 17.0, *) {
      // False when the build does not declare Live Activities (1.0); the
      // front end then never syncs a card and Live voice works without one.
      invoke.resolve(["enabled": liveActivitiesDeclaredInInfoPlist() && ActivityAuthorizationInfo().areActivitiesEnabled])
    } else { invoke.resolve(["enabled": false]) }
  }

  @objc func live_activity_sync(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SyncArgs.self)
    if #available(iOS 17.0, *) {
      Task { @MainActor in
        guard let manager = self.activityManager as? PiwinLiveActivityManager else {
          invoke.reject("live-activity-unavailable"); return
        }
        do { try await manager.sync(args.activity); invoke.resolve(["ok": true]) }
        catch { invoke.reject("live-activity-update-failed") }
      }
    } else { invoke.resolve(["enabled": false]) }
  }

  @objc func live_activity_take_controls(_ invoke: Invoke) {
    if #available(iOS 17.0, *) {
      Task { @MainActor in
        let manager = self.activityManager as? PiwinLiveActivityManager
        invoke.resolve(manager?.takeControls() ?? [])
      }
    } else { invoke.resolve([String]()) }
  }

  @objc func live_activity_open(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(OpenArgs.self)
    guard let url = URLComponents(string: args.url), url.scheme == "piwin-live",
      url.host == "call", let callId = url.queryItems?.first(where: { $0.name == "callId" })?.value else {
      invoke.reject("live-activity-invalid-url"); return
    }
    if #available(iOS 17.0, *) {
      Task { @MainActor in
        guard let manager = self.activityManager as? PiwinLiveActivityManager else {
          invoke.reject("live-activity-unavailable"); return
        }
        do { try await manager.control(callId: callId, action: "open-session"); invoke.resolve(["ok": true]) }
        catch { invoke.reject("live-activity-stale-call") }
      }
    } else { invoke.resolve(["enabled": false]) }
  }
}

@_cdecl("init_plugin_piwin_live")
func initPlugin() -> Plugin { PiwinLivePlugin() }
