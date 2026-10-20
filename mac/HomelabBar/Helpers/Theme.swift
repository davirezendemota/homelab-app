import SwiftUI

enum Theme {
    static let background = Color(red: 0.07, green: 0.08, blue: 0.09)
    static let card = Color(red: 0.11, green: 0.12, blue: 0.14)
    static let border = Color.white.opacity(0.08)
    static let muted = Color.white.opacity(0.55)
    static let accent = Color(red: 0.25, green: 0.73, blue: 0.32)

    static func color(hex: String?) -> Color {
        guard let hex, hex.hasPrefix("#"), hex.count >= 7 else { return accent }
        let start = hex.index(hex.startIndex, offsetBy: 1)
        let r = Int(hex[start ..< hex.index(start, offsetBy: 2)], radix: 16) ?? 0
        let g = Int(hex[hex.index(start, offsetBy: 2) ..< hex.index(start, offsetBy: 4)], radix: 16) ?? 0
        let b = Int(hex[hex.index(start, offsetBy: 4) ..< hex.index(start, offsetBy: 6)], radix: 16) ?? 0
        return Color(red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255)
    }
}
