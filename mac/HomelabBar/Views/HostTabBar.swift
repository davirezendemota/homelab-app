import SwiftUI

struct HostTabBar: View {
    @Environment(HomelabSession.self) private var session
    var onAddHost: () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                tabBadge(
                    title: session.localMacShortName,
                    systemImage: "laptopcomputer",
                    isSelected: session.selectedTab == .thisMac,
                    status: .local
                ) {
                    Task { await session.selectTab(.thisMac) }
                }

                ForEach(session.profiles) { profile in
                    tabBadge(
                        title: profile.name,
                        systemImage: "server.rack",
                        isSelected: session.selectedTab == .server(profile.id),
                        status: session.badgeStatus(for: profile.id)
                    ) {
                        Task { await session.selectTab(.server(profile.id)) }
                    }
                }

                Button(action: onAddHost) {
                    Image(systemName: "plus")
                        .font(.caption.weight(.semibold))
                        .frame(width: 28, height: 28)
                        .background(Theme.card)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(Theme.border, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .help("Adicionar host Tailscale")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
    }

    private func tabBadge(
        title: String,
        systemImage: String,
        isSelected: Bool,
        status: HostBadgeStatus,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Circle()
                    .fill(statusColor(status))
                    .frame(width: 6, height: 6)
                Image(systemName: systemImage)
                    .font(.caption2)
                Text(title)
                    .font(.caption.weight(isSelected ? .semibold : .medium))
                    .lineLimit(1)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(isSelected ? Theme.accent.opacity(0.18) : Theme.card)
            .clipShape(Capsule())
            .overlay(
                Capsule().stroke(isSelected ? Theme.accent.opacity(0.5) : Theme.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func statusColor(_ status: HostBadgeStatus) -> Color {
        switch status {
        case .local: .blue
        case .live: Theme.accent
        case .connecting: .orange
        case .error: .red
        case .offline: Theme.muted
        }
    }
}
