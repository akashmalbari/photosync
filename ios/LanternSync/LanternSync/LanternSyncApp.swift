import SwiftUI

@main
struct LanternSyncApp: App {
    @StateObject private var model = SyncViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .preferredColorScheme(.light)
        }
    }
}
