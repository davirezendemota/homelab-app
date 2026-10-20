import Foundation

/// Executa um binário e devolve stdout. Lê o pipe enquanto o processo roda (evita deadlock com `ps -ax`).
enum Shell {
    static func run(_ executable: String, arguments: [String] = []) -> String? {
        guard FileManager.default.isExecutableFile(atPath: executable) else { return nil }

        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice

        let handle = pipe.fileHandleForReading
        var data = Data()
        let lock = NSLock()

        handle.readabilityHandler = { h in
            let chunk = h.availableData
            guard !chunk.isEmpty else { return }
            lock.lock()
            data.append(chunk)
            lock.unlock()
        }

        do {
            try process.run()
        } catch {
            handle.readabilityHandler = nil
            return nil
        }

        process.waitUntilExit()
        handle.readabilityHandler = nil
        lock.lock()
        data.append(handle.availableData)
        lock.unlock()

        guard process.terminationStatus == 0 else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
