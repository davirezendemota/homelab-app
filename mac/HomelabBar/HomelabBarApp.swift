import SwiftUI

@main
struct HomelabBarApp: App {
    @State private var session = HomelabSession()

    var body: some Scene {
        MenuBarExtra {
            PopoverView()
                .environment(session)
        } label: {
            MenuBarLabel(session: session)
        }
        .menuBarExtraStyle(.window)

        Settings {
            SettingsView()
                .environment(session)
        }
    }
}
