import Citadel
import Crypto
import Foundation
import NIO
import NIOSSH
import os

/// SSH + local TCP tunnel to reach homelab-app on the server loopback (e.g. :80).
/// Tunnel bridge adapted from Deskmon (MIT).
@Observable
final class SSHManager {

    private(set) var phase: SSHPhase = .disconnected
    private(set) var tunnelPort: Int = 0

    private var sshClient: SSHClient?
    private var localServer: Channel?
    private let group = MultiThreadedEventLoopGroup.singleton
    private var disconnectCallbacks: [@Sendable () -> Void] = []

    private static let log = Logger(subsystem: "com.davirezendemota.homelab-bar", category: "SSH")

    enum SSHPhase: Sendable {
        case disconnected
        case connecting
        case connected
        case tunnelOpen
    }

    var tunnelBaseURL: String? {
        guard tunnelPort > 0, phase == .tunnelOpen else { return nil }
        return "http://127.0.0.1:\(tunnelPort)"
    }

    var isConnected: Bool {
        sshClient?.isConnected ?? false
    }

    func connect(host: String, port: Int = 22, username: String, password: String) async throws {
        phase = .connecting
        do {
            let client = try await SSHClient.connect(
                host: host,
                port: port,
                authenticationMethod: .passwordBased(username: username, password: password),
                hostKeyValidator: .acceptAnything(),
                reconnect: .never
            )
            sshClient = client
            phase = .connected
            wireDisconnectHandler()
        } catch {
            phase = .disconnected
            throw error
        }
    }

    func openTunnel(remoteHost: String = "127.0.0.1", remotePort: Int) async throws {
        guard let client = sshClient, client.isConnected else {
            throw SSHTunnelError.notConnected
        }

        closeTunnel()

        let bootstrap = ServerBootstrap(group: group)
            .serverChannelOption(.backlog, value: 8)
            .childChannelOption(.allowRemoteHalfClosure, value: true)
            .childChannelInitializer { [client] localChannel in
                localChannel.pipeline.addHandler(
                    TunnelBridgeHandler(sshClient: client, remoteHost: remoteHost, remotePort: remotePort)
                )
            }

        let serverChannel = try await bootstrap.bind(host: "127.0.0.1", port: 0).get()
        guard let port = serverChannel.localAddress?.port else {
            try await serverChannel.close()
            throw SSHTunnelError.bindFailed
        }

        localServer = serverChannel
        tunnelPort = port
        phase = .tunnelOpen
        Self.log.info("Tunnel 127.0.0.1:\(port) → \(remoteHost):\(remotePort)")
    }

    func disconnect() {
        closeTunnel()
        if let client = sshClient {
            Task.detached { [client] in try? await client.close() }
        }
        sshClient = nil
        phase = .disconnected
    }

    func onDisconnect(_ callback: @escaping @Sendable () -> Void) {
        disconnectCallbacks.append(callback)
    }

    private func closeTunnel() {
        if let server = localServer {
            try? server.close().wait()
            localServer = nil
        }
        tunnelPort = 0
        if phase == .tunnelOpen {
            phase = sshClient?.isConnected == true ? .connected : .disconnected
        }
    }

    private func wireDisconnectHandler() {
        sshClient?.onDisconnect { [weak self] in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.localServer = nil
                self.tunnelPort = 0
                self.sshClient = nil
                self.phase = .disconnected
                for callback in self.disconnectCallbacks { callback() }
            }
        }
    }
}

enum SSHTunnelError: LocalizedError {
    case notConnected
    case bindFailed

    var errorDescription: String? {
        switch self {
        case .notConnected: "SSH não conectado"
        case .bindFailed: "Falha ao abrir túnel local"
        }
    }
}

private final class TunnelBridgeHandler: ChannelInboundHandler, @unchecked Sendable {
    typealias InboundIn = ByteBuffer
    typealias OutboundOut = ByteBuffer

    private let sshClient: SSHClient
    private let remoteHost: String
    private let remotePort: Int
    private var sshChannel: Channel?
    private var pendingWrites: [ByteBuffer] = []
    private var localChannel: Channel?

    init(sshClient: SSHClient, remoteHost: String, remotePort: Int) {
        self.sshClient = sshClient
        self.remoteHost = remoteHost
        self.remotePort = remotePort
    }

    func channelActive(context: ChannelHandlerContext) {
        localChannel = context.channel
        let localChan = context.channel
        let host = remoteHost
        let port = remotePort

        Task {
            do {
                let sshChan = try await sshClient.createDirectTCPIPChannel(
                    using: .init(
                        targetHost: host,
                        targetPort: port,
                        originatorAddress: try .init(ipAddress: "127.0.0.1", port: 0)
                    )
                ) { channel in
                    channel.pipeline.addHandler(ReverseBridgeHandler(peerChannel: localChan))
                }
                self.sshChannel = sshChan
                for buffer in self.pendingWrites {
                    sshChan.writeAndFlush(NIOAny(buffer), promise: nil)
                }
                self.pendingWrites.removeAll()
            } catch {
                localChan.close(promise: nil)
            }
        }
    }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        let buffer = unwrapInboundIn(data)
        if let sshChan = sshChannel {
            sshChan.writeAndFlush(NIOAny(buffer), promise: nil)
        } else {
            pendingWrites.append(buffer)
        }
    }

    func channelInactive(context: ChannelHandlerContext) {
        sshChannel?.close(promise: nil)
        sshChannel = nil
        pendingWrites.removeAll()
    }

    func errorCaught(context: ChannelHandlerContext, error: Error) {
        context.close(promise: nil)
    }
}

private final class ReverseBridgeHandler: ChannelInboundHandler, @unchecked Sendable {
    typealias InboundIn = ByteBuffer
    typealias OutboundOut = ByteBuffer

    private let peerChannel: Channel

    init(peerChannel: Channel) { self.peerChannel = peerChannel }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        peerChannel.writeAndFlush(NIOAny(unwrapInboundIn(data)), promise: nil)
    }

    func channelInactive(context: ChannelHandlerContext) {
        peerChannel.close(promise: nil)
    }

    func errorCaught(context: ChannelHandlerContext, error: Error) {
        context.close(promise: nil)
    }
}
