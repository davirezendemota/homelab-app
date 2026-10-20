import SwiftUI

/// Card “Agent Sessions” — mesmo conteúdo do painel web (`type: agents` no payload).
struct AgentSessionsPanel: View {
    let meter: HomelabMeter

    private var sessions: [AgentSession] {
        meter.sessions ?? []
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("Agent Sessions")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.muted)
                Spacer(minLength: 8)
                if let sub = meter.sub, !sub.isEmpty {
                    Text(sub)
                        .font(.caption2.monospaced())
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
            }

            if sessions.isEmpty {
                Text("Nenhuma sessão ativa")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 4)
            } else {
                HStack(spacing: 10) {
                    Color.clear.frame(width: 18)
                    Text("Sessão")
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text("CPU")
                        .frame(width: 52, alignment: .trailing)
                    Text("RAM")
                        .frame(width: 56, alignment: .trailing)
                }
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Theme.muted)
                .textCase(.uppercase)
                .padding(.horizontal, 6)

                VStack(spacing: 2) {
                    ForEach(sessions) { session in
                        AgentSessionRow(session: session)
                    }
                }
            }
        }
        .padding(10)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct AgentSessionRow: View {
    let session: AgentSession

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: agentSymbol)
                .font(.system(size: 12))
                .foregroundStyle(agentTint)
                .frame(width: 18, height: 18)

            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(session.folderName)
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                    if session.isSubagent {
                        Text("subagent")
                            .font(.system(size: 10, weight: .medium))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .overlay(
                                Capsule().stroke(Theme.border, lineWidth: 1)
                            )
                            .foregroundStyle(Theme.muted)
                    }
                }
                Text(session.uptime)
                    .font(.caption2.monospaced())
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Text(session.cpuDisplay)
                .font(.caption2.monospacedDigit())
                .foregroundStyle(Theme.color(hex: session.color))
                .frame(width: 52, alignment: .trailing)

            Text(session.memDisplay)
                .font(.caption2.monospacedDigit())
                .foregroundStyle(Theme.muted)
                .frame(width: 56, alignment: .trailing)
        }
        .padding(.vertical, 5)
        .padding(.horizontal, 6)
        .padding(.leading, session.isSubagent ? 14 : 6)
        .background {
            if session.isSubagent {
                RoundedRectangle(cornerRadius: 6)
                    .strokeBorder(Theme.border, lineWidth: 1)
                    .padding(.leading, 9)
            }
        }
    }

    private var agentSymbol: String {
        switch session.kind {
        case "claude": "sparkle"
        case "cursor": "cursorarrow.rays"
        default: "terminal"
        }
    }

    private var agentTint: Color {
        switch session.kind {
        case "claude": Color(red: 0.85, green: 0.47, blue: 0.34)
        case "cursor": .primary
        default: Theme.muted
        }
    }
}
