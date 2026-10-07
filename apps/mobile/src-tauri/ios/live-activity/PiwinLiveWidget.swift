import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

private let liveAccent = Color(red: 0.89, green: 0.32, blue: 0.20)

@main
struct PiwinLiveWidgets: WidgetBundle {
  var body: some Widget { PiwinLiveWidget() }
}

struct PiwinLiveWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: PiwinLiveAttributes.self) { context in
      VStack(alignment: .leading, spacing: 14) {
        HStack {
          Label("piwin Live", systemImage: context.state.symbol).foregroundStyle(liveAccent)
          Spacer()
          LiveDuration(startedAt: context.attributes.startedAt)
        }
        // Session titles can contain private work. They belong in the expanded
        // Island while the lock-screen card shows only the call's safe state.
        Text(context.state.statusLabel).font(.subheadline)
        LiveControls(context: context)
      }
      .padding(18)
      .activityBackgroundTint(Color(red: 0.07, green: 0.065, blue: 0.06))
      .activitySystemActionForegroundColor(.white)
      .foregroundStyle(.white)
      .widgetURL(context.attributes.url)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label("piwin Live", systemImage: "mic.fill").foregroundStyle(liveAccent).font(.headline)
        }
        DynamicIslandExpandedRegion(.trailing) {
          LiveDuration(startedAt: context.attributes.startedAt)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(spacing: 5) {
            Text(context.state.statusLabel).font(.headline)
            Text(context.state.sessionLabel).font(.caption).foregroundStyle(.secondary)
              .lineLimit(1).privacySensitive()
          }.padding(.top, 8)
        }
        DynamicIslandExpandedRegion(.bottom) {
          LiveControls(context: context).padding(.top, 8)
        }
      } compactLeading: {
        Image(systemName: context.state.symbol).foregroundStyle(liveAccent)
          .accessibilityLabel(context.state.statusLabel)
      } compactTrailing: {
        LiveDuration(startedAt: context.attributes.startedAt, compact: true)
      } minimal: {
        Image(systemName: context.state.symbol).foregroundStyle(liveAccent)
          .accessibilityLabel("piwin Live，\(context.state.statusLabel)")
      }
      .widgetURL(context.attributes.url)
      .keylineTint(liveAccent)
    }
  }
}

private struct LiveDuration: View {
  let startedAt: Date
  var compact = false
  var body: some View {
    Text(timerInterval: startedAt...Date.distantFuture, countsDown: false)
      .monospacedDigit().font(.caption).lineLimit(1)
      .frame(width: compact ? 48 : 76, alignment: .trailing)
      .accessibilityLabel("通话时长")
  }
}

private struct LiveControls: View {
  let context: ActivityViewContext<PiwinLiveAttributes>
  var body: some View {
    HStack(spacing: 10) {
      Button(intent: PiwinLiveMuteIntent(callId: context.attributes.callId)) {
        Label(context.state.muted ? "取消静音" : "静音", systemImage: context.state.muted ? "mic.fill" : "mic.slash.fill")
      }.tint(.gray)
      if let url = context.attributes.url {
        Link(destination: url) { Label("回到会话", systemImage: "arrow.up.forward.app") }.tint(.gray)
      }
      Button(intent: PiwinLiveEndIntent(callId: context.attributes.callId)) {
        Label("结束", systemImage: "phone.down.fill")
      }.tint(liveAccent)
    }
    .font(.caption.weight(.medium)).buttonStyle(.borderedProminent)
    .disabled(context.state.pendingControl || context.state.phase == "ending")
  }
}
