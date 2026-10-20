import Foundation

struct PagePayload: Codable, Sendable {
    let host: String
    let build: String
    let loadedBuild: String?
    let error: String?
    let containers: [ContainerRow]
    let meters: [HomelabMeter]
    let containerHistory: [ContainerLifecycleEvent]?

    enum CodingKeys: String, CodingKey {
        case host, build, error, containers, meters
        case loadedBuild = "loaded_build"
        case containerHistory
    }
}

struct ContainerRow: Codable, Sendable, Identifiable {
    let id: String
    let name: String
    let image: String
    let status: String
    let ports: [Int]
    let stack: String
    let health: String?
    let cpuPct: Double?
    let memPct: Double?

    var isRunning: Bool {
        status.lowercased().hasPrefix("up")
    }
}

struct ContainerLifecycleEvent: Codable, Sendable {
    let at: Int64
    let name: String
    let stack: String
    let kind: String
}

struct AgentSession: Codable, Sendable, Identifiable {
    let id: String
    let parent: String
    let kind: String
    let label: String
    let pid: Int
    let cwd: String
    let folder: String?
    let startedAt: Int64
    let uptime: String
    let procs: Int
    let cpuPct: Double
    let cpuDisplay: String
    let memBytes: UInt64
    let memDisplay: String
    let color: String

    var isSubagent: Bool { !parent.isEmpty }

    static func folderLabel(from cwd: String) -> String {
        let trimmed = cwd.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed == "~" { return "~" }
        guard !trimmed.isEmpty else { return "" }
        let parts = trimmed.split(separator: "/").filter { !$0.isEmpty && $0 != "~" }
        if let last = parts.last { return String(last) }
        return ""
    }

    /// Último componente do diretório de trabalho (ex. `homelab-app`), não o path completo.
    var folderName: String {
        if let folder, !folder.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return folder
        }
        let trimmed = cwd.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed == "~" { return "~" }
        guard !trimmed.isEmpty else { return "—" }
        let parts = trimmed.split(separator: "/").filter { !$0.isEmpty && $0 != "~" }
        if let last = parts.last { return String(last) }
        return "—"
    }
}

/// Mirrors `model.Meter` — UI-oriented host metrics from homelab-app.
struct HomelabMeter: Codable, Sendable, Identifiable {
    var id: String {
        if type == "agents" { return "agents" }
        return chartKey ?? detailKey ?? label ?? "meter"
    }

    let label: String?
    let display: String?
    let pct: Int?
    let chartKey: String?
    let detailKey: String?
    let type: String?
    let color: String?
    let sub: String?
    let barWidth: String?
    let sessions: [AgentSession]?
    let main: StorageMountRow?
    let mounts: [StorageMountRow]?

    static let emptyAgents = HomelabMeter(
        label: "Agent Sessions",
        display: "0",
        pct: nil,
        chartKey: nil,
        detailKey: nil,
        type: "agents",
        color: nil,
        sub: "nenhuma",
        barWidth: nil,
        sessions: [],
        main: nil,
        mounts: nil
    )
}

struct StorageMountRow: Codable, Sendable, Identifiable {
    var id: String { label }
    let label: String
    let pct: Int
    let used_gb: Double?
    let total_gb: Double?
    let color: String?
    let path: String?
}

extension PagePayload {
    var agentsMeter: HomelabMeter? {
        meters.first { $0.type == "agents" }
    }

    /// CPU, RAM, temperatura, armazenamento (igual à web, sem o card de agentes).
    var resourceMeters: [HomelabMeter] {
        meters.filter { $0.type != "agents" }
    }

    var runningContainers: [ContainerRow] {
        containers.filter(\.isRunning)
    }
}

/// HTTP direto ao homelab-app. O caminho previsto é pela rede Tailscale (MagicDNS ou IP 100.x).
enum ConnectionMode: String, Codable, CaseIterable, Sendable {
    case tailscale = "Tailscale"
    case sshTunnel = "SSH tunnel"

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        switch raw {
        case Self.tailscale.rawValue, "LAN (HTTP)", "direct":
            self = .tailscale
        case Self.sshTunnel.rawValue:
            self = .sshTunnel
        default:
            self = .tailscale
        }
    }
}

struct HomelabProfile: Codable, Identifiable, Sendable {
    var id: UUID
    var name: String
    var host: String
    var httpPort: Int
    var sshPort: Int
    var username: String
    var mode: ConnectionMode

    init(
        id: UUID = UUID(),
        name: String,
        host: String,
        httpPort: Int = 80,
        sshPort: Int = 22,
        username: String = "davi",
        mode: ConnectionMode = .tailscale
    ) {
        self.id = id
        self.name = name
        self.host = host
        self.httpPort = httpPort
        self.sshPort = sshPort
        self.username = username
        self.mode = mode
    }

    /// URL do homelab-app (HTTP sobre Tailscale ou túnel local).
    var dashboardURL: URL? { httpBaseURL }

    var httpBaseURL: URL? {
        var components = URLComponents()
        components.scheme = "http"
        components.host = host
        if httpPort != 80 {
            components.port = httpPort
        }
        return components.url
    }

    var httpBaseURLString: String? {
        httpBaseURL?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
}

enum HomelabConnectionPhase: Sendable, Equatable {
    case disconnected
    case connecting
    case live
    case error(String)
}

/// Aba do popover: Mac local ou um perfil de servidor remoto.
enum PopoverTab: Hashable {
    case thisMac
    case server(UUID)
}

enum HostBadgeStatus: Sendable {
    case local
    case live
    case connecting
    case offline
    case error
}
