import AVFoundation
import Foundation
import Tauri

private struct ConnectionArgs: Decodable { let connection: LiveAudioConnectOptions }
private struct AudioArgs: Decodable {
  let connectionId: String
  let message: String?
  let muted: Bool?
}

extension PiwinLivePlugin {
  @objc func live_audio_prepare(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AudioArgs.self)
    Task { @MainActor in
      guard self.audioConnection == nil, self.preparedConnectionId == nil else {
        invoke.reject("live-protocol-failed"); return
      }
      self.preparedConnectionId = args.connectionId
      AVAudioSession.sharedInstance().requestRecordPermission { granted in
        Task { @MainActor in
          guard self.preparedConnectionId == args.connectionId else {
            invoke.reject("live-start-cancelled"); return
          }
          if granted { invoke.resolve(["ok": true]) }
          else { self.preparedConnectionId = nil; invoke.reject("mic-denied") }
        }
      }
    }
  }

  @objc func live_audio_connect(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ConnectionArgs.self)
    Task { @MainActor in
      guard self.preparedConnectionId == args.connection.connectionId, self.audioConnection == nil else {
        invoke.reject("live-protocol-failed"); return
      }
      let connection = LiveAudioConnection(options: args.connection)
      self.audioConnection = connection
      connection.onEvents = { [weak self] in self?.trigger("audio", data: [:]) }
      connection.onActivity = { [weak self] activity in
        if #available(iOS 17.0, *) {
          Task { @MainActor in
            let manager = self?.activityManager as? PiwinLiveActivityManager
            await manager?.mediaActivity(callId: args.connection.callId, activity: activity)
          }
        }
      }
      connection.onFailed = { [weak self] in
        if #available(iOS 17.0, *) {
          Task { @MainActor in
            let manager = self?.activityManager as? PiwinLiveActivityManager
            await manager?.mediaFailed(callId: args.connection.callId)
          }
        }
      }
      do { try connection.connect(); invoke.resolve(["ok": true]) }
      catch { connection.close(); self.audioConnection = nil; invoke.reject("live-protocol-failed") }
    }
  }

  @objc func live_audio_send(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AudioArgs.self)
    Task { @MainActor in
      guard let connection = self.audioConnection, connection.options.connectionId == args.connectionId,
        let message = args.message else { invoke.reject("live-protocol-failed"); return }
      connection.send(message)
      invoke.resolve(["ok": true])
    }
  }

  @objc func live_audio_set_muted(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AudioArgs.self)
    Task { @MainActor in
      guard let connection = self.audioConnection, connection.options.connectionId == args.connectionId,
        let muted = args.muted else { invoke.reject("live-protocol-failed"); return }
      connection.setMuted(muted)
      invoke.resolve(["ok": true])
    }
  }

  @objc func live_audio_close(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AudioArgs.self)
    Task { @MainActor in
      if self.audioConnection?.options.connectionId == args.connectionId {
        self.audioConnection?.close(); self.audioConnection = nil
      }
      if self.preparedConnectionId == args.connectionId { self.preparedConnectionId = nil }
      invoke.resolve(["ok": true])
    }
  }

  @objc func live_audio_take_events(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AudioArgs.self)
    Task { @MainActor in
      let connection = self.audioConnection
      invoke.resolve(connection?.options.connectionId == args.connectionId ? connection?.takeEvents() ?? [] : [])
    }
  }
}
