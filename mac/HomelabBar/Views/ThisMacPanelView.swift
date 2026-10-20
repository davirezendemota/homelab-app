import SwiftUI

struct ThisMacPanelView: View {
    @Environment(HomelabSession.self) private var session

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Este Mac")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.muted)
                    Text(session.localMacName)
                        .font(.title3.weight(.semibold))
                    Text("Cliente Homelab Bar — use as abas acima para monitorar hosts remotos via Tailscale.")
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.card)
                .clipShape(RoundedRectangle(cornerRadius: 8))

                if session.profiles.isEmpty {
                    Text("Nenhum servidor configurado. Toque em + para adicionar um host Tailscale com homelab-app.")
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                } else {
                    Text("Servidores")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.muted)
                    ForEach(session.profiles) { profile in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(profile.name)
                                    .font(.caption.weight(.medium))
                                Text(profile.host)
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            statusLabel(for: profile.id)
                            Button("Abrir") {
                                Task { await session.selectTab(.server(profile.id)) }
                            }
                            .font(.caption)
                        }
                        .padding(10)
                        .background(Theme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
            .padding(12)
        }
    }

    @ViewBuilder
    private func statusLabel(for profileID: UUID) -> some View {
        switch session.badgeStatus(for: profileID) {
        case .live:
            Text("Ao vivo").font(.caption2).foregroundStyle(Theme.accent)
        case .connecting:
            Text("…").font(.caption2).foregroundStyle(.orange)
        case .error:
            Text("Erro").font(.caption2).foregroundStyle(.red)
        case .offline, .local:
            Text("—").font(.caption2).foregroundStyle(Theme.muted)
        }
    }
}
