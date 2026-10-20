import Darwin
import Foundation
/// Métricas locais do MacBook (mesmos painéis da web, sem homelab-app).
@MainActor
@Observable
final class LocalMacMonitor {
    var agentsMeter: HomelabMeter = .emptyAgents
    var resourceMeters: [HomelabMeter] = []
    var containers: [ContainerRow] = []

    private var pollTask: Task<Void, Never>?

    func startPolling() {
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            await self?.refresh()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                if Task.isCancelled { break }
                await self?.refresh()
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    func refresh() async {
        let snapshot = await Task.detached(priority: .utility) {
            LocalMacSampler.capture()
        }.value

        agentsMeter = snapshot.agentsMeter
        resourceMeters = snapshot.resourceMeters
        containers = snapshot.containers
    }
}

// MARK: - Sampling (off main thread)

private struct LocalMacSnapshot {
    var agentsMeter: HomelabMeter
    var resourceMeters: [HomelabMeter]
    var containers: [ContainerRow]
}

private enum LocalMacSampler {
    private static var lastCPUTicks: (user: UInt32, system: UInt32, idle: UInt32, nice: UInt32)?

    static func capture() -> LocalMacSnapshot {
        let cpuPct = sampleCPUPercent()
        let (ramPct, ramSub) = memorySnapshot()
        let storage = storageSnapshot()

        let meters: [HomelabMeter] = [
            meter(label: "CPU", display: "\(cpuPct)%", pct: cpuPct, chartKey: "cpu", sub: "\(ProcessInfo.processInfo.processorCount) cores"),
            meter(label: "RAM", display: "\(ramPct)%", pct: ramPct, chartKey: "ram", sub: ramSub),
            storage,
        ]

        let sessions = LocalAgentScanner.sessions()
        return LocalMacSnapshot(
            agentsMeter: LocalAgentScanner.agentsMeter(sessions: sessions),
            resourceMeters: meters,
            containers: LocalDockerScanner.runningContainers()
        )
    }

    private static func meter(label: String, display: String, pct: Int, chartKey: String, sub: String) -> HomelabMeter {
        let color = pct > 90 ? "#f85149" : pct > 75 ? "#d29922" : "#3fb950"
        return HomelabMeter(
            label: label,
            display: display,
            pct: pct,
            chartKey: chartKey,
            detailKey: chartKey,
            type: nil,
            color: color,
            sub: sub,
            barWidth: "\(pct)%",
            sessions: nil,
            main: nil,
            mounts: nil
        )
    }

    private static func storageSnapshot() -> HomelabMeter {
        let path = "/System/Volumes/Data"
        let url = URL(fileURLWithPath: path)
        let total = (try? url.resourceValues(forKeys: [.volumeTotalCapacityKey]).volumeTotalCapacity) ?? 0
        let free = (try? url.resourceValues(forKeys: [.volumeAvailableCapacityKey]).volumeAvailableCapacity) ?? 0
        let used = max(0, total - free)
        let pct = total > 0 ? Int((Double(used) / Double(total)) * 100) : 0
        let usedGB = Double(used) / 1_073_741_824
        let totalGB = Double(total) / 1_073_741_824
        let row = StorageMountRow(
            label: "Macintosh HD",
            pct: pct,
            used_gb: usedGB,
            total_gb: totalGB,
            color: pct > 90 ? "#f85149" : "#3fb950",
            path: path
        )
        return HomelabMeter(
            label: "Armazenamento",
            display: "\(pct)%",
            pct: pct,
            chartKey: nil,
            detailKey: "storage",
            type: "storage",
            color: row.color,
            sub: String(format: "%.1f / %.0f GB", usedGB, totalGB),
            barWidth: "\(pct)%",
            sessions: nil,
            main: row,
            mounts: []
        )
    }

    private static func memorySnapshot() -> (Int, String) {
        let total = ProcessInfo.processInfo.physicalMemory
        var stats = vm_statistics64()
        var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64>.size / MemoryLayout<integer_t>.size)
        let result = withUnsafeMutablePointer(to: &stats) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                host_statistics64(mach_host_self(), HOST_VM_INFO64, $0, &count)
            }
        }
        guard result == KERN_SUCCESS else { return (0, "—") }
        let page = UInt64(vm_page_size)
        let used = (UInt64(stats.active_count) + UInt64(stats.wire_count)) * page
        let pct = total > 0 ? Int((Double(used) / Double(total)) * 100) : 0
        let sub = String(format: "%.1f / %.1f GB", Double(used) / 1_073_741_824, Double(total) / 1_073_741_824)
        return (pct, sub)
    }

    private static func sampleCPUPercent() -> Int {
        var load = host_cpu_load_info()
        var count = mach_msg_type_number_t(MemoryLayout<host_cpu_load_info>.size / MemoryLayout<integer_t>.size)
        let kr = withUnsafeMutablePointer(to: &load) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                host_statistics(mach_host_self(), HOST_CPU_LOAD_INFO, $0, &count)
            }
        }
        guard kr == KERN_SUCCESS else { return 0 }

        let ticks = load.cpu_ticks
        let user = UInt32(ticks.0)
        let system = UInt32(ticks.1)
        let idle = UInt32(ticks.2)
        let nice = UInt32(ticks.3)

        defer { lastCPUTicks = (user, system, idle, nice) }

        guard let prev = lastCPUTicks else { return 0 }
        let dUser = Double(user &- prev.user)
        let dSys = Double(system &- prev.system)
        let dIdle = Double(idle &- prev.idle)
        let dNice = Double(nice &- prev.nice)
        let total = dUser + dSys + dIdle + dNice
        guard total > 0 else { return 0 }
        return min(100, Int(((dUser + dSys + dNice) / total) * 100))
    }
}

// MARK: - Agentes (Cursor / Claude)

enum LocalAgentScanner {
    static func sessions() -> [AgentSession] {
        let output = Shell.run("/bin/ps", arguments: ["-ax", "-o", "pid=,ppid=,rss=,etime=,command="]) ?? ""
        var sessions: [AgentSession] = []
        for line in output.split(separator: "\n") {
            guard let row = parsePSLine(String(line)),
                  let kind = agentKind(cmd: row.cmd)
            else { continue }
            let memBytes = UInt64(max(0, row.rss)) * 1024
            let cwd = ProcessCwd.abbreviatedPath(forPID: row.pid)
            sessions.append(AgentSession(
                id: "\(kind)-\(row.pid)",
                parent: "",
                kind: kind,
                label: kind == "cursor" ? "Cursor Agent" : "Claude Code",
                pid: row.pid,
                cwd: cwd,
                folder: AgentSession.folderLabel(from: cwd),
                startedAt: 0,
                uptime: row.etime,
                procs: 1,
                cpuPct: 0,
                cpuDisplay: "—",
                memBytes: memBytes,
                memDisplay: formatBytes(memBytes),
                color: "#3fb950"
            ))
        }
        return sessions.sorted { $0.pid < $1.pid }
    }

    private static func parsePSLine(_ line: String) -> (pid: Int, ppid: Int, rss: Int, etime: String, cmd: String)? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard let firstSpace = trimmed.firstIndex(where: { $0.isWhitespace }) else { return nil }
        guard let pid = Int(trimmed[..<firstSpace]) else { return nil }
        var rest = trimmed[firstSpace...].trimmingCharacters(in: .whitespaces)
        guard let sp2 = rest.firstIndex(where: { $0.isWhitespace }),
              let ppid = Int(rest[..<sp2])
        else { return nil }
        rest = rest[sp2...].trimmingCharacters(in: .whitespaces)
        guard let sp3 = rest.firstIndex(where: { $0.isWhitespace }),
              let rss = Int(rest[..<sp3])
        else { return nil }
        rest = rest[sp3...].trimmingCharacters(in: .whitespaces)
        guard let sp4 = rest.firstIndex(where: { $0.isWhitespace }) else { return nil }
        let etime = String(rest[..<sp4])
        let cmd = String(rest[sp4...].trimmingCharacters(in: .whitespaces))
        guard !cmd.isEmpty else { return nil }
        return (pid, ppid, rss, etime, cmd)
    }

    static func agentsMeter(sessions: [AgentSession]) -> HomelabMeter {
        var mem: UInt64 = 0
        for s in sessions { mem += s.memBytes }
        let sub = sessions.isEmpty
            ? "nenhuma"
            : "\(sessions.count) sessões · \(formatBytes(mem))"
        return HomelabMeter(
            label: "Agent Sessions",
            display: "\(sessions.count)",
            pct: nil,
            chartKey: nil,
            detailKey: nil,
            type: "agents",
            color: nil,
            sub: sub,
            barWidth: nil,
            sessions: sessions,
            main: nil,
            mounts: nil
        )
    }

    private static func agentKind(cmd: String) -> String? {
        if cmd.contains("/cursor-agent/") && !cmd.contains("worker-server") { return "cursor" }
        if cmd.contains(".local/bin/agent") && cmd.contains("/cursor-agent/") { return "cursor" }
        if cmd.contains("@anthropic-ai/claude-code/cli.js") { return "claude" }
        if cmd == "claude" || cmd.hasPrefix("claude ") || cmd.contains("/claude ") { return "claude" }
        return nil
    }

    private static func formatBytes(_ bytes: UInt64) -> String {
        let mb = Double(bytes) / 1_048_576
        if mb >= 1024 { return String(format: "%.1f GB", mb / 1024) }
        return String(format: "%.1f MB", mb)
    }
}

// MARK: - Docker local (Docker Desktop)

enum LocalDockerScanner {
    static func runningContainers() -> [ContainerRow] {
        for path in ["/usr/local/bin/docker", "/opt/homebrew/bin/docker"] {
            guard FileManager.default.isExecutableFile(atPath: path) else { continue }
            if let rows = parseDockerPS(Shell.run(path, arguments: ["ps", "--format", "{{json .}}"]) ?? "") {
                return rows
            }
        }
        return []
    }

    private static func parseDockerPS(_ jsonLines: String) -> [ContainerRow]? {
        guard !jsonLines.isEmpty else { return nil }
        var rows: [ContainerRow] = []
        for line in jsonLines.split(separator: "\n") {
            guard let data = String(line).data(using: .utf8),
                  let obj = try? JSONDecoder().decode(DockerPS.self, from: data)
            else { continue }
            let state = (obj.State ?? obj.Status ?? "").lowercased()
            guard state.contains("running") || state.hasPrefix("up") else { continue }
            let id = obj.ID ?? obj.ID2 ?? ""
            guard !id.isEmpty else { continue }
            rows.append(ContainerRow(
                id: String(id.prefix(12)),
                name: obj.Names ?? id,
                image: obj.Image ?? "",
                status: "Up",
                ports: [],
                stack: "local",
                health: nil,
                cpuPct: nil,
                memPct: nil
            ))
        }
        return rows
    }

    private struct DockerPS: Decodable {
        let ID: String?
        let ID2: String?
        let Names: String?
        let Image: String?
        let State: String?
        let Status: String?

        enum CodingKeys: String, CodingKey {
            case ID, Names, Image, State, Status
            case ID2 = "Id"
        }
    }
}
