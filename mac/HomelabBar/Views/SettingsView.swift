import SwiftUI

struct SettingsView: View {
    @Environment(HomelabSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var sshPassword = ""
    @State private var showAdd = false

    var body: some View {
        Form {
            Section {
                Text("Hosts homelab-app na rede Tailscale (HTTP). O app não precisa de Xcode no Mac — builds vêm do GitHub Actions.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Servidores Tailscale") {
                ForEach(session.profiles) { profile in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(profile.name).font(.headline)
                        Text(profile.host).font(.caption.monospaced()).foregroundStyle(.secondary)
                    }
                }

                Button("Adicionar host…") { showAdd = true }
                if session.selectedProfile != nil {
                    Button("Remover host selecionado", role: .destructive) {
                        if let p = session.selectedProfile { session.removeProfile(p) }
                    }
                }
            }

            Section("Conexão do host ativo") {
                Button("Conectar agora") {
                    Task {
                        if case .server = session.selectedTab {
                            await session.connect(password: sshPassword.isEmpty ? nil : sshPassword)
                        } else if let id = session.selectedProfileID {
                            await session.selectTab(.server(id))
                        }
                    }
                }
                .disabled(session.selectedProfile == nil)

                Button("Desconectar") { session.userDisconnect() }
            }

            Section {
                Button("Fechar") { dismiss() }
            }
        }
        .formStyle(.grouped)
        .frame(width: 440, height: 400)
        .sheet(isPresented: $showAdd) {
            AddHostSheet()
                .environment(session)
        }
    }
}
