import SwiftUI

struct AddHostSheet: View {
    @Environment(HomelabSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var draft = HomelabProfile(name: "", host: "", mode: .tailscale)
    @State private var sshPassword = ""

    var body: some View {
        Form {
            TextField("Nome (ex.: homelab02)", text: $draft.name)
            TextField("Host Tailscale (MagicDNS)", text: $draft.host)
            TextField("Porta HTTP", value: $draft.httpPort, format: .number)

            Text("Host na rede Tailscale onde o homelab-app responde (geralmente porta 80).")
                .font(.caption)
                .foregroundStyle(.secondary)

            Picker("Modo", selection: $draft.mode) {
                ForEach(ConnectionMode.allCases, id: \.self) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            if draft.mode == .sshTunnel {
                TextField("Usuário SSH", text: $draft.username)
                TextField("Porta SSH", value: $draft.sshPort, format: .number)
                SecureField("Senha SSH", text: $sshPassword)
            }

            HStack {
                Button("Cancelar") { dismiss() }
                Spacer()
                Button("Adicionar") {
                    guard !draft.name.isEmpty, !draft.host.isEmpty else { return }
                    session.addProfile(draft)
                    dismiss()
                    Task { await session.selectTab(.server(draft.id)) }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(draft.name.isEmpty || draft.host.isEmpty)
            }
        }
        .padding()
        .frame(width: 400)
    }
}
