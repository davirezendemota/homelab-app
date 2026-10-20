import Darwin
import Foundation

/// Diretório de trabalho de um processo (mesmo usuário). Usa libproc — funciona sem spawnar `lsof`.
enum ProcessCwd {
    static func abbreviatedPath(forPID pid: Int) -> String {
        if let raw = rawPathViaProc(pid: Int32(pid)), !raw.isEmpty {
            return abbreviateHome(raw)
        }
        if let raw = rawPathViaLsof(pid: pid), !raw.isEmpty {
            return abbreviateHome(raw)
        }
        return ""
    }

    private static func rawPathViaProc(pid: Int32) -> String? {
        var info = proc_vnodepathinfo()
        let buflen = Int32(MemoryLayout<proc_vnodepathinfo>.size)
        let got = proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0, &info, buflen)
        guard got == buflen else { return nil }
        return withUnsafeBytes(of: info.pvi_cdir.vip_path) { raw in
            guard let base = raw.bindMemory(to: CChar.self).baseAddress else { return nil }
            let s = String(cString: base)
            return s.isEmpty ? nil : s
        }
    }

    private static func rawPathViaLsof(pid: Int) -> String? {
        let output = Shell.run("/usr/sbin/lsof", arguments: ["-a", "-p", "\(pid)", "-d", "cwd", "-Fn"]) ?? ""
        for line in output.split(separator: "\n") {
            let s = String(line)
            guard s.hasPrefix("n"), s.count > 1 else { continue }
            return String(s.dropFirst())
        }
        return nil
    }

    private static func abbreviateHome(_ path: String) -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if path == home { return "~" }
        if path.hasPrefix(home + "/") {
            return "~" + String(path.dropFirst(home.count))
        }
        return path
    }
}
