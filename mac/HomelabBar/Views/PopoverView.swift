import SwiftUI

struct PopoverView: View {
    @Environment(HomelabSession.self) private var session
    @State private var showSettings = false
    @State private var showAddHost = false

    var body: some View {
        VStack(spacing: 0) {
            HostTabBar(onAddHost: { showAddHost = true })
            Divider().opacity(0.3)
            subheader
            Divider().opacity(0.3)
            content
            Divider().opacity(0.3)
            footer
        }
        .frame(width: 400, height: 620)
        .background(Theme.background)
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showSettings) {
            SettingsView()
                .environment(session)
        }
        .sheet(isPresented: $showAddHost) {
            AddHostSheet()
                .environment(session)
        }
        .task(id: session.selectedTab) {
            if case .server = session.selectedTab, case .disconnected = session.phase {
                await session.reconnectIfNeeded()
            }
        }
    }

    private var subheader: some View {
        HStack {
            Text(subheaderTitle)
                .font(.caption)
                .foregroundStyle(Theme.muted)
            Spacer()
            if case .server = session.selectedTab, let url = session.selectedProfile?.dashboardURL {
                Button {
                    NSWorkspace.shared.open(url)
                } label: {
                    Image(systemName: "safari")
                }
                .buttonStyle(.plain)
                .help("Abrir dashboard no navegador")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }

    private var subheaderTitle: String {
        switch session.selectedTab {
        case .thisMac:
            return "Este Mac · \(session.localMacName)"
        case .server:
            return phaseLabel
        }
    }

    private var phaseLabel: String {
        switch session.phase {
        case .disconnected: "Desconectado"
        case .connecting: "Conectando via Tailscale…"
        case .live: "Ao vivo · \(session.selectedProfile?.host ?? "")"
        case .error(let msg): msg
        }
    }

    @ViewBuilder
    private var content: some View {
        switch session.selectedTab {
        case .thisMac:
            ThisMacPanelView()
        case .server:
            serverContent
        }
    }

    @ViewBuilder
    private var serverContent: some View {
        switch session.phase {
        case .disconnected:
            emptyState("Desconectado", "Selecione o host ou toque em Atualizar.")
        case .connecting:
            ProgressView("Conectando ao homelab-app…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .error(let message):
            emptyState("Erro de conexão", message)
        case .live:
            if let payload = session.payload {
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        if let agents = payload.agentsMeter {
                            AgentSessionsPanel(meter: agents)
                        }
                        ResourceMonitorPanel(meters: payload.resourceMeters)
                        ActiveContainersPanel(containers: payload.containers) { row, action in
                            Task { await session.performAction(on: row, action: action) }
                        }
                    }
                    .padding(12)
                }
            }
        }
    }

    private var footer: some View {
        HStack {
            Button("Ajustes…") {
                showSettings = true
            }
            Spacer()
            switch session.selectedTab {
            case .thisMac:
                Button("Atualizar") { Task { await session.localMac.refresh() } }
            case .server:
                Button("Atualizar") { Task { await session.connect() } }
            }
        }
        .padding(10)
    }

    private func emptyState(_ title: String, _ subtitle: String) -> some View {
        VStack(spacing: 8) {
            Text(title).font(.headline)
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}

struct LocalContainerRowView: View {
    let row: ContainerRow

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(Theme.accent).frame(width: 6, height: 6)
            VStack(alignment: .leading, spacing: 1) {
                Text(row.name).font(.caption.weight(.medium)).lineLimit(1)
                Text(row.stack).font(.caption2).foregroundStyle(Theme.muted)
            }
            Spacer()
            Text(row.image.split(separator: ":").first.map(String.init) ?? row.image)
                .font(.caption2)
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
        }
        .padding(.vertical, 4)
    }
}

struct ContainerRowView: View {
    let row: ContainerRow
    let onAction: (String) -> Void

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(row.isRunning ? Theme.accent : Theme.muted)
                .frame(width: 6, height: 6)
            VStack(alignment: .leading, spacing: 1) {
                Text(row.name)
                    .font(.caption.weight(.medium))
                    .lineLimit(1)
                Text(row.stack)
                    .font(.caption2)
                    .foregroundStyle(Theme.muted)
            }
            Spacer()
            HStack(spacing: 6) {
                if let cpu = row.cpuPct {
                    Text(String(format: "%.0f%% CPU", cpu))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(Theme.muted)
                }
                if let mem = row.memPct {
                    Text(String(format: "%.0f%% RAM", mem))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(Theme.muted)
                }
            }
            Menu {
                Button("Reiniciar") { onAction("restart") }
                Button("Parar") { onAction("stop") }
                Button("Iniciar") { onAction("start") }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
        }
        .padding(.vertical, 4)
    }
}
