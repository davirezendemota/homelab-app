import SwiftUI

struct ThisMacPanelView: View {
    @Environment(HomelabSession.self) private var session

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                AgentSessionsPanel(meter: session.localMac.agentsMeter)
                ResourceMonitorPanel(meters: session.localMac.resourceMeters)
                ActiveContainersPanel(containers: session.localMac.containers) { _, _ in }
                if session.localMac.containers.isEmpty {
                    Text("Docker Desktop: containers locais aparecem aqui se o CLI `docker` estiver no PATH.")
                        .font(.caption2)
                        .foregroundStyle(Theme.muted)
                }
            }
            .padding(12)
        }
        .onAppear { session.localMac.startPolling() }
        .onDisappear { session.localMac.stopPolling() }
    }
}
