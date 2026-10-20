import SwiftUI

struct ActiveContainersPanel: View {
    let containers: [ContainerRow]
    var onAction: (ContainerRow, String) -> Void

    private var running: [ContainerRow] {
        containers.filter(\.isRunning)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Containers ativos (\(running.count))")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.muted)

            if running.isEmpty {
                Text("Nenhum container em execução")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
            } else {
                ForEach(running) { row in
                    if row.cpuPct != nil || row.memPct != nil {
                        ContainerRowView(row: row) { action in onAction(row, action) }
                    } else {
                        LocalContainerRowView(row: row)
                    }
                }
            }
        }
        .padding(10)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
