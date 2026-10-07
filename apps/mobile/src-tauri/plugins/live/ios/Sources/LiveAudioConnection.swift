import AVFoundation
import Foundation

struct LiveAudioConnectOptions: Decodable {
  let connectionId: String
  let callId: String
  let endpoint: String
  let bearerToken: String
  let initialMessage: String
  let inputFrameTemplate: String
  let inputSampleRateHz: Double
  let outputSampleRateHz: Double
  let readyEventTypes: [String]
  let audioEventTypes: [String]
  let interruptEventTypes: [String]
  let forwardEventTypes: [String]
  let activityByEventType: [String: String]
  let failureEventTypes: [String]
}

/// Vendor framing is supplied by the existing TypeScript wire adapter. Native
/// code only transports PCM and queues non-audio events for the Host owner.
@MainActor
final class LiveAudioConnection {
  let options: LiveAudioConnectOptions
  private var socket: URLSessionWebSocketTask?
  private var session: URLSession?
  private var audio: LivePcmAudio?
  private var events: [[String: String]] = []
  private var inFlightAudioFrames = 0
  private var closed = false
  private var muted = false
  private var interruption: NSObjectProtocol?
  private var setupTimeout: Task<Void, Never>?
  var onEvents: (() -> Void)?
  var onActivity: ((String) -> Void)?
  var onFailed: (() -> Void)?

  init(options: LiveAudioConnectOptions) { self.options = options }

  func connect() throws {
    guard let url = URL(string: options.endpoint), url.scheme == "wss",
      !options.bearerToken.isEmpty, options.inputSampleRateHz == 24000,
      options.outputSampleRateHz == 24000,
      options.inputFrameTemplate.contains("__PIWIN_PCM__") else {
      throw LiveAudioError.invalidConnection
    }
    var request = URLRequest(url: url)
    request.setValue("Bearer \(options.bearerToken)", forHTTPHeaderField: "Authorization")
    let session = URLSession(configuration: .ephemeral)
    self.session = session
    let socket = session.webSocketTask(with: request)
    self.socket = socket
    socket.resume()
    send(options.initialMessage)
    receive()
    setupTimeout = Task { [weak self] in
      do { try await Task.sleep(nanoseconds: 10_000_000_000) }
      catch { return }
      self?.fail()
    }
    interruption = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
    ) { [weak self] notification in
      guard let type = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
        type == AVAudioSession.InterruptionType.began.rawValue else { return }
      Task { @MainActor in self?.fail() }
    }
  }

  func setMuted(_ muted: Bool) { self.muted = muted; audio?.setMuted(muted) }

  func send(_ message: String) {
    guard !closed, let socket else { return }
    socket.send(.string(message)) { [weak self] error in
      if error != nil { Task { @MainActor in self?.fail() } }
    }
  }

  private func receive() {
    guard !closed, let socket else { return }
    socket.receive { [weak self] result in
      Task { @MainActor in
        guard let self, !self.closed else { return }
        switch result {
        case .failure: self.fail()
        case .success(let message):
          switch message {
          case .string(let text): self.accept(text)
          case .data(let data): if let text = String(data: data, encoding: .utf8) { self.accept(text) }
          @unknown default: break
          }
          self.receive()
        }
      }
    }
  }

  private func accept(_ message: String) {
    guard let data = message.data(using: .utf8),
      let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let type = payload["type"] as? String else { return }
    if options.failureEventTypes.contains(type) { fail(); return }
    if options.readyEventTypes.contains(type), audio == nil {
      do {
        let engine = LivePcmAudio()
        engine.onFailure = { [weak self] in Task { @MainActor in self?.fail() } }
        audio = engine
        engine.setMuted(muted)
        try engine.start(inputRate: options.inputSampleRateHz, outputRate: options.outputSampleRateHz) { [weak self] data in
          Task { @MainActor in self?.sendSamples(data) }
        }
        setupTimeout?.cancel(); setupTimeout = nil
      } catch { fail(); return }
    }
    if options.interruptEventTypes.contains(type) { audio?.interruptPlayback() }
    if options.audioEventTypes.contains(type) {
      guard let encoded = payload["delta"] as? String, let pcm = Data(base64Encoded: encoded),
        audio?.play(pcm) == true else { fail(); return }
      onActivity?("assistant-speaking")
      return
    }
    if let activity = options.activityByEventType[type] { onActivity?(activity) }
    guard options.forwardEventTypes.contains(type) else { return }
    // Only the latest activity of each kind is needed after WebKit resumes.
    // Delegations and errors remain ordered and are never silently dropped.
    if options.activityByEventType[type] != nil { events.removeAll { $0["eventType"] == type } }
    if events.count >= 128 { fail(); return }
    events.append(["connectionId": options.connectionId, "type": "message", "message": message, "eventType": type])
    onEvents?()
  }

  private func sendSamples(_ data: Data) {
    guard !closed, let socket else { return }
    // Backpressure must fail visibly rather than accumulate private audio.
    if inFlightAudioFrames >= 8 { fail(); return }
    inFlightAudioFrames += 1
    let message = options.inputFrameTemplate.replacingOccurrences(of: "__PIWIN_PCM__", with: data.base64EncodedString())
    socket.send(.string(message)) { [weak self] error in
      Task { @MainActor in
        guard let self else { return }
        self.inFlightAudioFrames = max(0, self.inFlightAudioFrames - 1)
        if error != nil { self.fail() }
      }
    }
  }

  func takeEvents() -> [[String: String]] {
    let result = events
    events.removeAll()
    return result
  }

  private func fail() {
    guard !closed else { return }
    close()
    events = [["connectionId": options.connectionId, "type": "failed"]]
    onFailed?()
    onEvents?()
  }

  func close() {
    guard !closed else { return }
    closed = true
    setupTimeout?.cancel(); setupTimeout = nil
    audio?.stop()
    audio = nil
    socket?.cancel(with: .normalClosure, reason: nil)
    socket = nil
    session?.invalidateAndCancel()
    session = nil
    events.removeAll()
    if let interruption { NotificationCenter.default.removeObserver(interruption) }
    interruption = nil
  }
}
