import Darwin
import Foundation
import SwiftUI

/// Métricas locais do MacBook (mesmos painéis da web, sem homelab-app).
@MainActor
@Observable
final class LocalMacMonitor {
    var agentsMeter: HomelabMeter = .emptyAgents
    var resourceMeters: [HomelabMeter] = []
    var containers: [ContainerRow] = []

    private var pollTask: Task<Void, Never>?
    private var lastCPUTicks: (user: UInt32, system: UInt32, idle: UInt32, nice: UInt32)?
    func startPolling() {
        guard pollTask == nil else { return }
        pollTask = Task {
            while !Task.isCancelled {
                refresh()
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    func refresh() {
        let cpuPct = sampleCPUPercent()
        let (ramPct, ramSub) = memorySnapshot()
        let storage = storageSnapshot()

        resourceMeters = [
            meter(label: "CPU", display: "\(cpuPct)%", pct: cpuPct, chartKey: "cpu", sub: "\(ProcessInfo.processInfo.processorCount) cores"),
            meter(label: "RAM", display: "\(ramPct)%", pct: ramPct, chartKey: "ram", sub: ramSub),
            storage,
        ]

        let sessions = LocalAgentScanner.sessions()
        agentsMeter = LocalAgentScanner.agentsMeter(sessions: sessions)
        containers = LocalDockerScanner.runningContainers()
    }

    private func meter(label: String, display: String, pct: Int, chartKey: String, sub: String) -> HomelabMeter {
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

    private func storageSnapshot() -> HomelabMeter {
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

    private func memorySnapshot() -> (Int, String) {
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

    private func sampleCPUPercent() -> Int {
        var load = host_cpu_load_info()
        var count = mach_msg_type_number_t(MemoryLayout<host_cpu_load_info>.size / MemoryLayout<integer_t>.size)
        let kr = withUnsafeMutablePointer(to: &load) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                host_statistics(mach_host_self(), HOST_CPU_LOAD_INFO, $0, &count)
            }
        }
        guard kr == KERN_SUCCESS else { return 0 }

        let user = load.cpu_ticks.0
        let system = load.cpu_ticks.1
        let idle = load.cpu_ticks.2
        let nice = load.cpu_ticks.3

        defer { lastCPUTicks = (user, system, idle, nice) }

        guard let prev = lastCPUTicks else { return 0 }
        let dUser = Double(user - prev.user)
        let dSys = Double(system - prev.system)
        let dIdle = Double(idle - prev.idle)
        let dNice = Double(nice - prev.nice)
        let total = dUser + dSys + dIdle + dNice
        guard total > 0 else { return 0 }
        return min(100, Int(((dUser + dSys + dNice) / total) * 100))
    }
}

// MARK: - Agentes (Cursor / Claude)

enum LocalAgentScanner {
    static func sessions() -> [AgentSession] {
        let output = shell("/bin/ps", ["-ax", "-o", "pid=,ppid=,rss=,etime=,command="]) ?? ""
        var lines: [(pid: Int, ppid: Int, rss: Int, etime: String, cmd: String)] = []
        for line in output.split(separator: "\n") {
            let parts = String(line).split(separator: " ", maxSplits: 4, omittingEmptySubsequences: true)
            guard parts.count >= 5,
                  let pid = Int(parts[0]),
                  let ppid = Int(parts[1]),
                  let rss = Int(parts[2])
            else { continue }
            let etime = String(parts[3])
            let cmd = String(parts[4])
            lines.append((pid, ppid, rss, etime, cmd))
        }

        var sessions: [AgentSession] = []
        for row in lines {
            guard let kind = agentKind(cmd: row.cmd) else { continue }
            let memBytes = UInt64(row.rss) * 1024
            sessions.append(AgentSession(
                id: "\(kind)-\(row.pid)",
                parent: "",
                kind: kind,
                label: kind == "cursor" ? "Cursor Agent" : "Claude Code",
                pid: row.pid,
                cwd: folderFromCommand(row.cmd),
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
        if cmd.contains("@anthropic-ai/claude-code/cli.js") { return "claude" }
        if cmd.hasPrefix("claude ") || cmd.contains("/claude ") { return "claude" }
        return nil
    }

    private static func folderFromCommand(_ cmd: String) -> String {
        if let range = cmd.range(of: #"(\S+homelab\S*)"#, options: .regularExpression) {
            let path = String(cmd[range])
            return (path as NSString).lastPathComponent
        }
        return "~"
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
        let jsonLines = shell("/usr/local/bin/docker", ["ps", "--format", "{{json .}}"])
            ?? shell("/opt/homebrew/bin/docker", ["ps", "--format", "{{json .}}"])
            ?? ""
        if jsonLines.isEmpty { return [] }

        var rows: [ContainerRow] = []
        for line in jsonLines.split(separator: "\n") {
            guard let data = String(line).data(using: .utf8),
                  let obj = try? JSONDecoder().decode(DockerPS.self, from: data)
            else { continue }
            guard obj.State.lowercased() == "running" else { continue }
            rows.append(ContainerRow(
                id: String(obj.ID.prefix(12)),
                name: obj.Names,
                image: obj.Image,
                status: "Up",
                ports: [],
                stack: obj.Labels?.components(separatedBy: ",").first { $0.contains("com.docker.compose.project") }?
                    .split(separator: "=").last.map(String.init) ?? "local",
                health: nil,
                cpuPct: nil,
                memPct: nil
            ))
        }
        return rows
    }

    private struct DockerPS: Decodable {
        let ID: String
        let Names: String
        let Image: String
        let State: String
        let Labels: String?

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            ID = try c.decode(String.self, forKey: .ID)
            Names = try c.decode(String.self, forKey: .Names)
            Image = try c.decode(String.self, forKey: .Image)
            State = try c.decode(String.self, forKey: .State)
            Labels = try c.decodeIfPresent(String.self, forKey: .Labels)
        }

        enum CodingKeys: String, CodingKey { case ID, Names, Image, State, Labels }
    }
}

private func shell(_ launch: String, _ args: [String]) -> String? {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: launch)
    process.arguments = args
    process.standardOutput = pipe
    process.standardError = Pipe()
    do {
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { return nil }
        return String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)
    } catch {
        return nil
    }
}
