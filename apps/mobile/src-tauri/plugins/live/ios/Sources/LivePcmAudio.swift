import AVFoundation
import Foundation

/// Audio stays native while WebKit is suspended. PCM is transient and never
/// written to disk; the media connection applies a bounded send queue.
final class LivePcmAudio {
  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private let stateLock = NSLock()
  private var muted = false
  private var converter: AVAudioConverter?
  private var inputTarget: AVAudioFormat?
  private var playbackFormat: AVAudioFormat?
  private var hasTap = false
  private var queuedSeconds: Double = 0
  var onFailure: (() -> Void)?

  func start(inputRate: Double, outputRate: Double, onSamples: @escaping (Data) -> Void) throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
    try session.setActive(true)
    let input = engine.inputNode
    #if !targetEnvironment(simulator)
    try input.setVoiceProcessingEnabled(true)
    #endif
    let hardware = input.outputFormat(forBus: 0)
    guard hardware.sampleRate > 0, hardware.channelCount > 0,
      let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: inputRate, channels: 1, interleaved: false),
      let output = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: outputRate, channels: 1, interleaved: false),
      let converter = AVAudioConverter(from: hardware, to: target) else {
      throw LiveAudioError.unavailable
    }
    self.converter = converter
    inputTarget = target
    playbackFormat = output
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: output)
    input.installTap(onBus: 0, bufferSize: 1024, format: hardware) { [weak self] buffer, _ in
      guard let self else { return }
      self.stateLock.lock()
      let isMuted = self.muted
      self.stateLock.unlock()
      guard !isMuted else { return }
      let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * inputRate / hardware.sampleRate) + 32)
      guard let converted = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
      var supplied = false
      var error: NSError?
      let status = converter.convert(to: converted, error: &error) { _, inputStatus in
        if supplied { inputStatus.pointee = .noDataNow; return nil }
        supplied = true
        inputStatus.pointee = .haveData
        return buffer
      }
      guard error == nil, status != .error else { self.onFailure?(); return }
      guard let samples = converted.int16ChannelData, converted.frameLength > 0 else { return }
      onSamples(Data(bytes: samples[0], count: Int(converted.frameLength) * MemoryLayout<Int16>.size))
    }
    hasTap = true
    engine.prepare()
    try engine.start()
    player.play()
  }

  func setMuted(_ value: Bool) {
    stateLock.lock()
    muted = value
    stateLock.unlock()
  }

  func play(_ data: Data) -> Bool {
    guard let format = playbackFormat, data.count > 1, data.count % 2 == 0,
      let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(data.count / 2)),
      let output = buffer.floatChannelData else { return false }
    let duration = Double(data.count / 2) / format.sampleRate
    stateLock.lock()
    if queuedSeconds + duration > 30 { stateLock.unlock(); return false }
    queuedSeconds += duration
    stateLock.unlock()
    buffer.frameLength = buffer.frameCapacity
    data.withUnsafeBytes { bytes in
      for index in 0..<Int(buffer.frameLength) {
        let sample = bytes.loadUnaligned(fromByteOffset: index * 2, as: Int16.self)
        output[0][index] = Float(Int16(littleEndian: sample)) / 32768
      }
    }
    player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      guard let self else { return }
      self.stateLock.lock()
      self.queuedSeconds = max(0, self.queuedSeconds - duration)
      self.stateLock.unlock()
    }
    return true
  }

  func interruptPlayback() {
    player.stop()
    stateLock.lock(); queuedSeconds = 0; stateLock.unlock()
    player.play()
  }

  func stop() {
    stateLock.lock()
    muted = true
    stateLock.unlock()
    if hasTap { engine.inputNode.removeTap(onBus: 0); hasTap = false }
    player.stop()
    engine.stop()
    converter = nil
    inputTarget = nil
    playbackFormat = nil
    do { try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    catch { NSLog("[piwin-live] could not release audio session") }
  }
}

enum LiveAudioError: Error { case unavailable, invalidConnection, overflow }
