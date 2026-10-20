import SwiftUI

struct ResourceMonitorPanel: View {
    let meters: [HomelabMeter]

    private var compactMeters: [HomelabMeter] {
        Array(meters.filter { $0.pct != nil }.prefix(4))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Monitor de recursos")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.muted)

            if compactMeters.isEmpty {
                Text("Sem métricas do host")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
            } else {
                ForEach(compactMeters) { meter in
                    HStack(spacing: 8) {
                        Text(meter.label ?? "—")
                            .font(.caption)
                            .frame(width: 88, alignment: .leading)
                        ProgressView(value: Double(meter.pct ?? 0), total: 100)
                            .tint(Theme.accent)
                        Text(meter.display ?? "")
                            .font(.caption.monospacedDigit())
                            .frame(width: 52, alignment: .trailing)
                    }
                }
            }
        }
        .padding(10)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
