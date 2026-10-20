import Foundation
import os

enum HomelabStreamEvent: Sendable {
    case status(PagePayload)
    case history([ContainerLifecycleEvent])
    case ping
}

enum HomelabAPIError: LocalizedError, Sendable {
    case invalidURL
    case http(Int)
    case unreachable
    case tailscaleUnreachable(host: String)

    var errorDescription: String? {
        switch self {
        case .invalidURL: "URL inválida"
        case .http(let code): "HTTP \(code)"
        case .unreachable: "Servidor inacessível"
        case .tailscaleUnreachable(let host):
            "Não foi possível alcançar \(host). Confira se o Tailscale está conectado no Mac e se o MagicDNS resolve o host."
        }
    }
}

/// Client for homelab-app HTTP + SSE (`/api/status`, `/api/stream`).
final class HomelabAPIClient: Sendable {
    static let shared = HomelabAPIClient()
    private static let log = Logger(subsystem: "com.davirezendemota.homelab-bar", category: "API")

    private let sseSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 300
        config.timeoutIntervalForResource = 0
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        return URLSession(configuration: config)
    }()

    func health(baseURL: String) async throws {
        guard let url = URL(string: "\(baseURL)/healthz") else { throw HomelabAPIError.invalidURL }
        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw HomelabAPIError.unreachable
        }
    }

    func fetchStatus(baseURL: String) async throws -> PagePayload {
        guard let url = URL(string: "\(baseURL)/api/status") else { throw HomelabAPIError.invalidURL }
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw HomelabAPIError.http(0) }
        guard http.statusCode == 200 else { throw HomelabAPIError.http(http.statusCode) }
        return try JSONDecoder().decode(PagePayload.self, from: data)
    }

    func containerAction(baseURL: String, ref: String, action: String) async throws {
        guard let url = URL(string: "\(baseURL)/api/containers/\(ref)/\(action)") else {
            throw HomelabAPIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 60
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw HomelabAPIError.http((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
    }

    func stream(baseURL: String) -> AsyncThrowingStream<HomelabStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                guard let url = URL(string: "\(baseURL)/api/stream") else {
                    continuation.finish(throwing: HomelabAPIError.invalidURL)
                    return
                }
                var request = URLRequest(url: url)
                request.setValue("text/event-stream", forHTTPHeaderField: "Accept")

                do {
                    let (bytes, response) = try await sseSession.bytes(for: request)
                    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                        continuation.finish(throwing: HomelabAPIError.http((response as? HTTPURLResponse)?.statusCode ?? 0))
                        return
                    }

                    var currentEvent = ""
                    var dataBuffer = ""
                    var lineBuffer = Data()

                    for try await byte in bytes {
                        if Task.isCancelled { break }
                        if byte == UInt8(ascii: "\n") {
                            let line = String(data: lineBuffer, encoding: .utf8) ?? ""
                            lineBuffer.removeAll(keepingCapacity: true)
                            if line.hasPrefix("event: ") {
                                currentEvent = String(line.dropFirst(7))
                            } else if line.hasPrefix("data: ") {
                                dataBuffer = String(line.dropFirst(6))
                            } else if line.hasPrefix(":") {
                                continuation.yield(.ping)
                            } else if line.isEmpty, !currentEvent.isEmpty {
                                if let event = Self.decode(event: currentEvent, data: dataBuffer) {
                                    continuation.yield(event)
                                }
                                currentEvent = ""
                                dataBuffer = ""
                            }
                        } else if byte != UInt8(ascii: "\r") {
                            lineBuffer.append(byte)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: HomelabAPIError.unreachable)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private static func decode(event: String, data: String) -> HomelabStreamEvent? {
        guard let jsonData = data.data(using: .utf8) else { return nil }
        let decoder = JSONDecoder()
        switch event {
        case "status":
            return (try? decoder.decode(PagePayload.self, from: jsonData)).map { .status($0) }
        case "history":
            return (try? decoder.decode([ContainerLifecycleEvent].self, from: jsonData)).map { .history($0) }
        default:
            return nil
        }
    }
}
