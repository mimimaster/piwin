import ActivityKit
import Foundation

@available(iOS 16.2, *)
struct PiwinLiveAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var sessionId: String
    var sessionLabel: String
    var phase: String
    var activity: String
    var muted: Bool
    var pendingControl: Bool = false

    var statusLabel: String {
      if pendingControl { return "正在处理…" }
      if phase == "starting" { return "正在连接" }
      if phase == "reconnecting" { return "正在重连" }
      if phase == "ending" { return "正在结束" }
      if muted { return "麦克风已静音" }
      switch activity {
      case "user-speaking": return "正在聆听你说话"
      case "assistant-speaking": return "正在回答"
      case "agent-working": return "正在处理任务"
      case "waiting-for-permission": return "等待你的确认"
      default: return "正在倾听"
      }
    }

    var symbol: String {
      if pendingControl || phase == "starting" || phase == "reconnecting" { return "arrow.triangle.2.circlepath" }
      return muted ? "mic.slash.fill" : "waveform"
    }
  }

  let callId: String
  let startedAt: Date

  var url: URL? {
    var components = URLComponents()
    components.scheme = "piwin-live"
    components.host = "call"
    components.queryItems = [URLQueryItem(name: "callId", value: callId)]
    return components.url
  }
}
