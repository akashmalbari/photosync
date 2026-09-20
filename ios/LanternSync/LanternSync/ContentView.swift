import Photos
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: SyncViewModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    header
                    connectionCard
                    photosAccessCard
                    syncCard
                    privacyNote
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 32)
            }
            .background(Color.lanternPaper.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $model.isShowingSettings) {
                SettingsView()
                    .environmentObject(model)
            }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 13).fill(Color.lanternForest)
                Image(systemName: "light.beacon.max.fill").foregroundStyle(Color.lanternGlow)
            }
            .frame(width: 48, height: 48)
            VStack(alignment: .leading, spacing: 2) {
                Text("Lantern Sync").font(.system(size: 27, weight: .bold, design: .rounded))
                Text("IPHONE → MAC MINI").font(.caption2.weight(.bold)).tracking(1.7).foregroundStyle(.secondary)
            }
            Spacer()
            Button { model.isShowingSettings = true } label: {
                Image(systemName: "gearshape.fill").frame(width: 40, height: 40).background(.white.opacity(0.8), in: Circle())
            }
            .foregroundStyle(Color.lanternForest)
        }
        .padding(.top, 20)
    }

    private var connectionCard: some View {
        card {
            HStack(spacing: 12) {
                statusIcon(name: model.serverStatus == nil ? "macmini" : "checkmark", ready: model.serverStatus != nil)
                VStack(alignment: .leading, spacing: 4) {
                    Text(model.serverStatus == nil ? "Mac Mini" : "Mac Mini connected").font(.headline)
                    Text(model.serverAddress.isEmpty ? "Add the address shown by Lantern Photos" : model.serverAddress)
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Button(model.serverStatus == nil ? "Connect" : "Test") {
                    model.serverAddress.isEmpty ? (model.isShowingSettings = true) : model.testConnection()
                }
                .buttonStyle(.bordered)
                .tint(Color.lanternForest)
            }
        }
    }

    private var photosAccessCard: some View {
        card {
            HStack(spacing: 12) {
                statusIcon(name: "photo.on.rectangle.angled", ready: model.permissionStatus == .authorized)
                VStack(alignment: .leading, spacing: 4) {
                    Text(model.permissionStatus == .authorized ? "Full Photos access" : "Photos permission").font(.headline)
                    Text(permissionDetail).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if model.permissionStatus != .authorized {
                    Button(model.permissionStatus == .notDetermined ? "Allow" : "Settings") {
                        model.permissionStatus == .notDetermined ? model.requestPhotosAccess() : model.openSystemSettings()
                    }
                    .buttonStyle(.bordered)
                    .tint(Color.lanternForest)
                }
            }
        }
    }

    private var syncCard: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    Text(model.stage.label).font(.title3.bold())
                    Text(model.message).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
            }

            if model.isSyncing || model.stage == .finished {
                VStack(spacing: 8) {
                    ProgressView(value: model.overallProgress).tint(Color.lanternTerracotta)
                    HStack {
                        Text(model.currentPhotoName.isEmpty ? "Differential sync" : model.currentPhotoName).lineLimit(1)
                        Spacer()
                        if model.photosToSync > 0 { Text("\(model.completedPhotos) of \(model.photosToSync)") }
                    }
                    .font(.caption).foregroundStyle(.secondary)
                }
            }

            if model.totalPhotos > 0 {
                HStack(spacing: 0) {
                    metric(value: model.totalPhotos, label: "Photos")
                    Divider().frame(height: 34)
                    metric(value: model.uploadedPhotos, label: "Added")
                    Divider().frame(height: 34)
                    metric(value: model.existingPhotos, label: "Current")
                }
            }

            Button {
                model.isSyncing ? model.cancelSync() : model.startSync()
            } label: {
                HStack {
                    Image(systemName: model.isSyncing ? "pause.fill" : "arrow.triangle.2.circlepath")
                    Text(model.isSyncing ? "Pause sync" : "Sync new photos")
                }
                .frame(maxWidth: .infinity).frame(height: 52)
            }
            .buttonStyle(.plain)
            .font(.headline)
            .foregroundStyle(.white)
            .background(model.isSyncing ? Color.gray : Color.lanternTerracotta, in: RoundedRectangle(cornerRadius: 14))

            if let lastSync = model.lastSyncDate {
                Text("Last completed \(lastSync.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity)
            }
        }
        .padding(22)
        .background(.white, in: RoundedRectangle(cornerRadius: 20))
        .shadow(color: Color.black.opacity(0.06), radius: 18, y: 8)
    }

    private var privacyNote: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "lock.shield.fill").foregroundStyle(Color.lanternForest)
            Text("Originals travel directly over your local Wi-Fi to the Mac Mini. Nothing is sent to Lantern or another cloud service.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 6)
    }

    private var permissionDetail: String {
        switch model.permissionStatus {
        case .authorized: return "Lantern can find new and edited photos."
        case .limited: return "Full Access is needed for a complete differential sync."
        case .denied, .restricted: return "Enable Full Access in iPhone Settings."
        case .notDetermined: return "You’ll approve access once on this iPhone."
        @unknown default: return "Review Photos access in Settings."
        }
    }

    private func card<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content().padding(16).background(.white.opacity(0.78), in: RoundedRectangle(cornerRadius: 16))
    }

    private func statusIcon(name: String, ready: Bool) -> some View {
        Image(systemName: ready ? "checkmark" : name)
            .font(.system(size: 17, weight: .semibold)).foregroundStyle(ready ? .white : Color.lanternForest)
            .frame(width: 40, height: 40).background(ready ? Color.lanternForest : Color.lanternSage, in: RoundedRectangle(cornerRadius: 11))
    }

    private func metric(value: Int, label: String) -> some View {
        VStack(spacing: 2) {
            Text(value.formatted()).font(.headline)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

extension Color {
    static let lanternPaper = Color(red: 0.965, green: 0.949, blue: 0.91)
    static let lanternForest = Color(red: 0.09, green: 0.24, blue: 0.20)
    static let lanternTerracotta = Color(red: 0.82, green: 0.40, blue: 0.27)
    static let lanternSage = Color(red: 0.88, green: 0.92, blue: 0.89)
    static let lanternGlow = Color(red: 1.0, green: 0.72, blue: 0.44)
}
