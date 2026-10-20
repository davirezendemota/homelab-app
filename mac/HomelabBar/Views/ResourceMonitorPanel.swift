import SwiftUI

struct ResourceMonitorPanel: View {
    let meters: [HomelabMeter]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Monitor de recursos")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.muted)

            if meters.isEmpty {
                Text("Sem métricas do host")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
            } else {
                ForEach(meters) { meter in
                    if meter.type == "storage" {
                        storageMeter(meter)
                    } else {
                        barMeter(meter)
                    }
                }
            }
        }
        .padding(10)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func barMeter(_ meter: HomelabMeter) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(meter.label ?? "—")
                    .font(.caption.weight(.medium))
                Spacer()
                Text(meter.display ?? "")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Theme.color(hex: meter.color))
            }
            if let pct = meter.pct, meter.chartKey != nil {
                ProgressView(value: Double(pct), total: 100)
                    .tint(Theme.color(hex: meter.color))
            }
            if let sub = meter.sub, !sub.isEmpty {
                Text(sub)
                    .font(.caption2)
                    .foregroundStyle(Theme.muted)
            }
        }
    }

    private func storageMeter(_ meter: HomelabMeter) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(meter.label ?? "Armazenamento")
                    .font(.caption.weight(.medium))
                Spacer()
                Text(meter.display ?? "")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Theme.color(hex: meter.color))
            }
            if let sub = meter.sub, !sub.isEmpty {
                Text(sub)
                    .font(.caption2)
                    .foregroundStyle(Theme.muted)
            }
            if let main = meter.main {
                storageRow(main)
            }
            ForEach(meter.mounts ?? []) { mount in
                storageRow(mount)
            }
        }
    }

    private func storageRow(_ row: StorageMountRow) -> some View {
        HStack(spacing: 8) {
            Text(row.label)
                .font(.caption2)
                .lineLimit(1)
                .frame(width: 72, alignment: .leading)
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.border)
                Capsule()
                    .fill(Theme.color(hex: row.color))
                    .scaleEffect(x: max(0.02, CGFloat(row.pct) / 100), y: 1, anchor: .leading)
            }
            .frame(height: 6)
            .frame(maxWidth: .infinity)
            Text("\(row.pct)%")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(Theme.muted)
                .frame(width: 32, alignment: .trailing)
        }
    }
}
