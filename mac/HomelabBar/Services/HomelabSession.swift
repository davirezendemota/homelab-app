import Foundation
import os
import SwiftUI

@MainActor
@Observable
final class HomelabSession {
    var profiles: [HomelabProfile] = []
    var selectedProfileID: UUID?
    var payload: PagePayload?
    var phase: HomelabConnectionPhase = .disconnected

    private let api = HomelabAPIClient.shared
    private var ssh = SSHManager()
    private var streamTask: Task<Void, Never>?
    private static let log = Logger(subsystem: "com.davirezendemota.homelab-bar", category: "Session")

    private static let profilesKey = "homelab.bar.profiles"
    private static let selectedKey = "homelab.bar.selected"

    var selectedProfile: HomelabProfile? {
        profiles.first { $0.id == selectedProfileID }
    }

    var menuBarTint: Color {
        guard let payload else { return .secondary }
        if let err = payload.error, !err.isEmpty { return .red }
        let cpu = payload.meters.first { $0.chartKey == "cpu" }?.pct ?? 0
        let ram = payload.meters.first { $0.chartKey == "ram" }?.pct ?? 0
        if cpu > 90 || ram > 95 { return .red }
        if cpu > 75 || ram > 85 { return .orange }
        return .green
    }

    init() {
        loadProfiles()
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
        if selectedProfileID == profile.id {
            selectedProfileID = profiles.first?.id
        }
        saveProfiles()
        disconnect()
    }

    func connect(password: String? = nil) async {
        guard let profile = selectedProfile else { return }
        disconnect()
        phase = .connecting

        do {
            let base = try await resolveBaseURL(profile: profile, password: password)
            try await api.health(baseURL: base)
            payload = try await api.fetchStatus(baseURL: base)
            phase = .live
            startStream(baseURL: base, profile: profile, password: password)
        } catch {
            phase = .error(connectionErrorMessage(error, profile: profile))
            ssh.disconnect()
        }
    }

    private func connectionErrorMessage(_ error: Error, profile: HomelabProfile) -> String {
        if profile.mode == .tailscale {
            return HomelabAPIError.tailscaleUnreachable(host: profile.host).localizedDescription
        }
        return error.localizedDescription
    }

    func disconnect() {
        streamTask?.cancel()
        streamTask = nil
        ssh.disconnect()
        phase = .disconnected
    }

    func reconnectIfNeeded() async {
        guard case .disconnected = phase, selectedProfile != nil else { return }
        await connect()
    }

    func performAction(on container: ContainerRow, action: String) async {
        guard let profile = selectedProfile else { return }
        do {
            let base = try await resolveBaseURL(profile: profile, password: nil)
            try await api.containerAction(baseURL: base, ref: container.id, action: action)
        } catch {
            phase = .error(error.localizedDescription)
        }
    }

    private func resolveBaseURL(profile: HomelabProfile, password: String?) async throws -> String {
        switch profile.mode {
        case .tailscale:
            guard let base = profile.httpBaseURLString else { throw HomelabAPIError.invalidURL }
            return base

        case .sshTunnel:
            let pwd = password ?? KeychainStore.loadPassword(for: profile.id)
            guard let pwd else {
                throw HomelabAPIError.unreachable
            }
            if !ssh.isConnected {
                try await ssh.connect(host: profile.host, port: profile.sshPort, username: profile.username, password: pwd)
                if password != nil {
                    try? KeychainStore.savePassword(pwd, for: profile.id)
                }
                ssh.onDisconnect { [weak self] in
                    Task { @MainActor [weak self] in
                        self?.phase = .disconnected
                        self?.streamTask?.cancel()
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
                        case .history:
                            break
                        case .ping:
                            break
                        }
                    }
                } catch {
                    if Task.isCancelled { return }
                    phase = .error("Stream perdido")
                }

                try? await Task.sleep(nanoseconds: backoff)
                backoff = min(backoff * 2, 30_000_000_000)

                do {
                    let base = try await resolveBaseURL(profile: profile, password: password)
                    _ = try await api.health(baseURL: base)
                } catch {
                    phase = .disconnected
                    return
                }
            }
        }
    }
}
