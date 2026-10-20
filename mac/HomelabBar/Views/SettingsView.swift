import SwiftUI

struct SettingsView: View {
    @Environment(HomelabSession.self) private var session
    @State private var draft = HomelabProfile(name: "homelab01", host: "homelab01", mode: .tailscale)
    @State private var sshPassword = ""
    @State private var showAdd = false

    var body: some View {
        Form {
            Section {
                Text("O Homelab Bar fala com o homelab-app por HTTP na rede Tailscale (WireGuard). Não é preciso expor a API na internet pública.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Servidores") {
                Picker("Ativo", selection: Binding(
                    get: { session.selectedProfileID },
                    set: { session.selectedProfileID = $0; session.saveProfiles() }
                )) {
                    ForEach(session.profiles) { profile in
                        Text(profile.name).tag(profile.id as UUID?)
                    }
                }

                if let profile = session.selectedProfile {
                    LabeledContent("Host Tailscale", value: profile.host)
                    LabeledContent("API", value: profile.httpBaseURLString ?? "—")
                    LabeledContent("Modo", value: profile.mode.rawValue)
                }

                Button("Adicionar servidor…") { showAdd = true }
                if session.selectedProfile != nil {
                    Button("Remover servidor selecionado", role: .destructive) {
                        if let p = session.selectedProfile { session.removeProfile(p) }
                    }
                }
            }

            Section("Conexão") {
                Button("Conectar agora") {
                    Task { await session.connect(password: sshPassword.isEmpty ? nil : sshPassword) }
                }
                .disabled(session.selectedProfile == nil)

                Button("Desconectar") { session.disconnect() }
            }
        }
        .formStyle(.grouped)
        .frame(width: 440, height: 380)
        .sheet(isPresented: $showAdd) {
            addSheet
        }
    }

    private var addSheet: some View {
        Form {
            TextField("Nome", text: $draft.name)
            TextField("Host Tailscale (MagicDNS)", text: $draft.host)
                .textContentType(.URL)
            TextField("Porta HTTP do homelab-app", value: $draft.httpPort, format: .number)

            if draft.mode == .tailscale {
                Text("Ex.: `homelab01` ou `homelab01.seu-tailnet.ts.net`. O app Tailscale neste Mac precisa estar conectado.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Picker("Modo", selection: $draft.mode) {
                ForEach(ConnectionMode.allCases, id: \.self) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            if draft.mode == .sshTunnel {
                Text("SSH também pode usar o host Tailscale; o túnel encaminha para o homelab-app em localhost no servidor.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextField("Usuário SSH", text: $draft.username)
                TextField("Porta SSH", value: $draft.sshPort, format: .number)
                SecureField("Senha SSH", text: $sshPassword)
            }

            HStack {
                Button("Cancelar") { showAdd = false }
                Spacer()
                Button("Salvar e conectar") {
                    session.addProfile(draft)
                    showAdd = false
                    Task {
                        await session.connect(password: draft.mode == .sshTunnel ? sshPassword : nil)
                    }
                }
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding()
        .frame(width: 400)
    }
}
