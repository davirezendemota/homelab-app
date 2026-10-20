import SwiftUI

struct PopoverView: View {
    @Environment(HomelabSession.self) private var session

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().opacity(0.3)
            content
            Divider().opacity(0.3)
            footer
        }
        .frame(width: 360, height: 520)
        .background(Theme.background)
        .preferredColorScheme(.dark)
        .task {
            if case .disconnected = session.phase {
                await session.reconnectIfNeeded()
            }
        }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(session.payload?.host ?? session.selectedProfile?.name ?? "Homelab")
                    .font(.headline)
                Text(phaseLabel)
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
            }
            Spacer()
            if let url = session.selectedProfile?.dashboardURL {
                Button {
                    NSWorkspace.shared.open(url)
                } label: {
                    Image(systemName: "safari")
                }
                .buttonStyle(.plain)
                .help("Abrir dashboard no navegador")
            }
        }
        .padding(12)
    }

    private var phaseLabel: String {
        switch session.phase {
        case .disconnected: "Desconectado"
        case .connecting: "Conectando…"
        case .live: "Ao vivo"
        case .error(let msg): msg
        }
    }

    @ViewBuilder
    private var content: some View {
        switch session.phase {
        case .disconnected:
            emptyState("Nenhum servidor configurado", "Abra Ajustes e adicione o homelab.")
        case .connecting:
            ProgressView("Conectando ao homelab-app…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .error(let message):
            emptyState("Erro de conexão", message)
        case .live:
            if let payload = session.payload {
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        metersSection(payload.meters)
                        containersSection(payload.containers)
                    }
                    .padding(12)
                }
            }
        }
    }

    private func metersSection(_ meters: [HomelabMeter]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Host")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.muted)
            ForEach(meters.filter { $0.chartKey != nil }.prefix(4)) { meter in
                HStack {
                    Text(meter.label ?? "—")
                        .frame(width: 88, alignment: .leading)
                    ProgressView(value: Double(meter.pct ?? 0), total: 100)
                        .tint(Theme.accent)
                    Text(meter.display ?? "")
                        .font(.caption.monospacedDigit())
                        .frame(width: 52, alignment: .trailing)
                }
            }
        }
        .padding(10)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func containersSection(_ containers: [ContainerRow]) -> some View {
        let running = containers.filter(\.isRunning)
        let stopped = containers.filter { !$0.isRunning }

        return VStack(alignment: .leading, spacing: 8) {
            Text("Containers (\(running.count) ativos)")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.muted)

            ForEach(running.prefix(12)) { row in
                ContainerRowView(row: row) { action in
                    Task { await session.performAction(on: row, action: action) }
                }
            }

            if !stopped.isEmpty {
                Text("\(stopped.count) parados")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                    .padding(.top, 4)
            }
        }
    }

    private var footer: some View {
        HStack {
            Button("Ajustes…") {
                NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
            }
            Spacer()
            if case .live = session.phase {
                Button("Atualizar") {
                    Task { await session.connect() }
                }
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
            if let cpu = row.cpuPct {
                Text(String(format: "%.0f%%", cpu))
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(Theme.muted)
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
