import SwiftUI

struct MenuBarLabel: View {
    @Bindable var session: HomelabSession

    var body: some View {
        Image(systemName: "server.rack")
            .symbolRenderingMode(.palette)
            .foregroundStyle(session.menuBarTint, .primary)
    }
}
