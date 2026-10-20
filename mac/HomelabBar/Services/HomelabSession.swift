import Foundation
import os
import SwiftUI

@MainActor
@Observable
final class HomelabSession {
    var profiles: [HomelabProfile] = []
    var selectedProfileID: UUID?
    var selectedTab: PopoverTab = .thisMac
    var payload: PagePayload?
    var phase: HomelabConnectionPhase = .disconnected

    /// Último estado conhecido por servidor (para badges nas abas).
    private(set) var profilePhases: [UUID: HomelabConnectionPhase] = [:]

    let localMac = LocalMacMonitor()

    private let api = HomelabAPIClient.shared
    private var ssh = SSHManager()
    private var streamTask: Task<Void, Never>?
    private static let log = Logger(subsystem: "com.davirezendemota.homelab-bar", category: "Session")

    private static let profilesKey = "homelab.bar.profiles"
    private static let selectedKey = "homelab.bar.selected"
    private static let tabKey = "homelab.bar.tab"

    var localMacName: String {
        Host.current().localizedName ?? Host.current().name ?? "Mac"
    }

    var localMacShortName: String {
        let full = localMacName
        if full.count <= 14 { return full }
        return String(full.prefix(12)) + "…"
    }

    var selectedProfile: HomelabProfile? {
        profiles.first { $0.id == selectedProfileID }
    }

    var menuBarTint: Color {
        switch selectedTab {
        case .thisMac:
            let ram = localMac.resourceMeters.first { $0.chartKey == "ram" }?.pct ?? 0
            let cpu = localMac.resourceMeters.first { $0.chartKey == "cpu" }?.pct ?? 0
            if cpu > 90 || ram > 95 { return .red }
            if cpu > 75 || ram > 85 { return .orange }
            if cpu > 0 || ram > 0 { return .green }
            return .secondary
        case .server:
            return tint(for: phase, payload: payload)
        }
    }

    init() {
        loadProfiles()
        loadSelectedTab()
        if profiles.isEmpty {
            let defaultProfile = HomelabProfile(
                name: "homelab01",
                host: "homelab01",
                httpPort: 80,
                mode: .tailscale
            )
            profiles = [defaultProfile]
            selectedProfileID = defaultProfile.id
            saveProfiles()
        }
        if selectedProfileID == nil {
            selectedProfileID = profiles.first?.id
        }
    }

    func badgeStatus(for profileID: UUID) -> HostBadgeStatus {
        if case .server(let id) = selectedTab, id == profileID {
            return mapPhase(phase)
        }
        if let cached = profilePhases[profileID] {
            return mapPhase(cached)
        }
        return .offline
    }

    func selectTab(_ tab: PopoverTab) async {
        selectedTab = tab
        saveSelectedTab()

        switch tab {
        case .thisMac:
            persistPhaseForActiveProfile()
            disconnect(clearPayload: false)
            phase = .disconnected

        case .server(let id):
            guard profiles.contains(where: { $0.id == id }) else { return }
            if selectedProfileID != id {
                persistPhaseForActiveProfile()
                disconnect(clearPayload: true)
            }
            selectedProfileID = id
            saveProfiles()
            if let cached = profilePhases[id], case .live = cached {
                // reconecta em background; mantém UI até novo payload
            }
            await connect()
        }
    }

    func loadProfiles() {
        if let data = UserDefaults.standard.data(forKey: Self.profilesKey),
           let decoded = try? JSONDecoder().decode([HomelabProfile].self, from: data) {
            profiles = decoded
        }
        if let idString = UserDefaults.standard.string(forKey: Self.selectedKey),
           let id = UUID(uuidString: idString) {
            selectedProfileID = id
        }
    }

    private func loadSelectedTab() {
        if let data = UserDefaults.standard.data(forKey: Self.tabKey),
           let tab = try? JSONDecoder().decode(PopoverTab.self, from: data) {
            selectedTab = tab
        }
    }

    private func saveSelectedTab() {
        if let data = try? JSONEncoder().encode(selectedTab) {
            UserDefaults.standard.set(data, forKey: Self.tabKey)
        }
    }

    func saveProfiles() {
        if let data = try? JSONEncoder().encode(profiles) {
            UserDefaults.standard.set(data, forKey: Self.profilesKey)
        }
        UserDefaults.standard.set(selectedProfileID?.uuidString, forKey: Self.selectedKey)
    }

    func addProfile(_ profile: HomelabProfile) {
        profiles.append(profile)
        selectedProfileID = profile.id
        saveProfiles()
    }

    func removeProfile(_ profile: HomelabProfile) {
        profiles.removeAll { $0.id == profile.id }
        profilePhases.removeValue(forKey: profile.id)
        if selectedProfileID == profile.id {
            selectedProfileID = profiles.first?.id
            if case .server(profile.id) = selectedTab {
                selectedTab = profiles.first.map { .server($0.id) } ?? .thisMac
                saveSelectedTab()
            }
        }
        saveProfiles()
        if case .server(let id) = selectedTab, id == profile.id {
            Task { await selectTab(.thisMac) }
        } else {
            disconnect(clearPayload: true)
        }
    }

    func connect(password: String? = nil) async {
        guard case .server = selectedTab else { return }
        guard let profile = selectedProfile else { return }

        disconnect(clearPayload: true)
        phase = .connecting
        profilePhases[profile.id] = .connecting

        do {
            let base = try await resolveBaseURL(profile: profile, password: password)
            try await api.health(baseURL: base)
            payload = try await api.fetchStatus(baseURL: base)
            phase = .live
            profilePhases[profile.id] = .live
            startStream(baseURL: base, profile: profile, password: password)
        } catch {
            let msg = connectionErrorMessage(error, profile: profile)
            phase = .error(msg)
            profilePhases[profile.id] = .error(msg)
            ssh.disconnect()
        }
    }

    private func connectionErrorMessage(_ error: Error, profile: HomelabProfile) -> String {
        if profile.mode == .tailscale {
            return HomelabAPIError.tailscaleUnreachable(host: profile.host).localizedDescription
        }
        return error.localizedDescription
    }

    func disconnect(clearPayload: Bool = true) {
        streamTask?.cancel()
        streamTask = nil
        ssh.disconnect()
        if clearPayload {
            payload = nil
        }
    }

    func userDisconnect() {
        disconnect(clearPayload: true)
        phase = .disconnected
        if let id = selectedProfileID {
            profilePhases[id] = .disconnected
        }
    }

    func reconnectIfNeeded() async {
        guard case .server = selectedTab else { return }
        guard case .disconnected = phase, selectedProfile != nil else { return }
        await connect()
    }

    func performAction(on container: ContainerRow, action: String) async {
        guard let profile = selectedProfile else { return }
        do {
            let base = try await resolveBaseURL(profile: profile, password: nil)
            try await api.containerAction(baseURL: base, ref: container.id, action: action)
        } catch {
            let msg = error.localizedDescription
            phase = .error(msg)
            profilePhases[profile.id] = .error(msg)
        }
    }

    private func persistPhaseForActiveProfile() {
        guard let id = selectedProfileID else { return }
        profilePhases[id] = phase
    }

    private func resolveBaseURL(profile: HomelabProfile, password: String?) async throws -> String {
        switch profile.mode {
        case .tailscale:
            guard let base = profile.httpBaseURLString else { throw HomelabAPIError.invalidURL }
            return base

        case .sshTunnel:
            let pwd = password ?? KeychainStore.loadPassword(for: profile.id)
            guard let pwd else { throw HomelabAPIError.unreachable }
            if !ssh.isConnected {
                try await ssh.connect(host: profile.host, port: profile.sshPort, username: profile.username, password: pwd)
                if password != nil {
                    try? KeychainStore.savePassword(pwd, for: profile.id)
                }
                ssh.onDisconnect { [weak self] in
                    Task { @MainActor [weak self] in
                        self?.handleStreamDrop()
                    }
                }
            }
            if ssh.tunnelBaseURL == nil {
                try await ssh.openTunnel(remotePort: profile.httpPort)
            }
            guard let tunnel = ssh.tunnelBaseURL else { throw SSHTunnelError.notConnected }
            return tunnel
        }
    }

    private func handleStreamDrop() {
        phase = .disconnected
        if let id = selectedProfileID {
            profilePhases[id] = .disconnected
        }
        streamTask?.cancel()
    }

    private func startStream(baseURL: String, profile: HomelabProfile, password: String?) {
        streamTask = Task {
            var backoff: UInt64 = 2_000_000_000
            while !Task.isCancelled {
                do {
                    for try await event in api.stream(baseURL: baseURL) {
                        if Task.isCancelled { return }
                        switch event {
                        case .status(let page):
                            payload = page
                            phase = .live
                            profilePhases[profile.id] = .live
                        case .history, .ping:
                            break
                        }
                    }
                } catch {
                    if Task.isCancelled { return }
                    phase = .error("Stream perdido")
                    profilePhases[profile.id] = .error("Stream perdido")
                }

                try? await Task.sleep(nanoseconds: backoff)
                backoff = min(backoff * 2, 30_000_000_000)

                do {
                    let base = try await resolveBaseURL(profile: profile, password: password)
                    _ = try await api.health(baseURL: base)
                } catch {
                    phase = .disconnected
                    profilePhases[profile.id] = .disconnected
                    return
                }
            }
        }
    }

    private func mapPhase(_ phase: HomelabConnectionPhase) -> HostBadgeStatus {
        switch phase {
        case .disconnected: .offline
        case .connecting: .connecting
        case .live: .live
        case .error: .error
        }
    }

    private func tint(for phase: HomelabConnectionPhase, payload: PagePayload?) -> Color {
        if case .error = phase { return .red }
        if case .connecting = phase { return .orange }
        if case .disconnected = phase { return .secondary }
        guard let payload else { return .secondary }
        if let err = payload.error, !err.isEmpty { return .red }
        let cpu = payload.meters.first { $0.chartKey == "cpu" }?.pct ?? 0
        let ram = payload.meters.first { $0.chartKey == "ram" }?.pct ?? 0
        if cpu > 90 || ram > 95 { return .red }
        if cpu > 75 || ram > 85 { return .orange }
        return .green
    }
}

// MARK: - PopoverTab persistence

extension PopoverTab: Codable {
    private enum CodingKeys: String, CodingKey {
        case kind, id
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(String.self, forKey: .kind)
        switch kind {
        case "thisMac":
            self = .thisMac
        case "server":
            self = .server(try container.decode(UUID.self, forKey: .id))
        default:
            self = .thisMac
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .thisMac:
            try container.encode("thisMac", forKey: .kind)
        case .server(let id):
            try container.encode("server", forKey: .kind)
            try container.encode(id, forKey: .id)
        }
    }
}
