import Photos
import SwiftUI

@MainActor
final class SyncViewModel: ObservableObject {
    @Published var serverAddress: String
    @Published var password: String
    @Published var permissionStatus: PHAuthorizationStatus
    @Published var serverStatus: ServerStatus?
    @Published var stage: SyncStage = .idle
    @Published var totalPhotos = 0
    @Published var photosToSync = 0
    @Published var completedPhotos = 0
    @Published var uploadedPhotos = 0
    @Published var existingPhotos = 0
    @Published var failedPhotos = 0
    @Published var currentPhotoName = ""
    @Published var currentPhotoProgress = 0.0
    @Published var message = "Connect to your Mac Mini, then sync whenever you want."
    @Published var isShowingSettings = false

    private let photoLibrary = PhotoLibraryService()
    private var task: Task<Void, Never>?
    private let deviceId: String

    var isSyncing: Bool { [.connecting, .scanning, .comparing, .transferring].contains(stage) }
    var overallProgress: Double {
        guard photosToSync > 0 else { return stage == .finished ? 1 : 0 }
        return min(1, (Double(completedPhotos) + currentPhotoProgress) / Double(photosToSync))
    }
    var lastSyncDate: Date? {
        let value = UserDefaults.standard.double(forKey: "lastSyncDate")
        return value > 0 ? Date(timeIntervalSince1970: value) : nil
    }

    init() {
        serverAddress = UserDefaults.standard.string(forKey: "serverAddress") ?? ""
        password = KeychainStore.value(for: "libraryPassword")
        permissionStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if let stored = UserDefaults.standard.string(forKey: "deviceId") {
            deviceId = stored
        } else {
            let created = UUID().uuidString.lowercased()
            UserDefaults.standard.set(created, forKey: "deviceId")
            deviceId = created
        }
    }

    func saveSettings(address: String, password: String) async -> Bool {
        serverAddress = normalizedAddress(address)
        self.password = password
        UserDefaults.standard.set(serverAddress, forKey: "serverAddress")
        KeychainStore.set(password, for: "libraryPassword")
        do {
            let client = try SyncClient(address: serverAddress, password: password)
            serverStatus = try await client.status()
            message = "Connected. Photos will go to \(serverStatus?.destination ?? "your library")."
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }

    func testConnection() {
        guard !serverAddress.isEmpty else { isShowingSettings = true; return }
        stage = .connecting
        task = Task {
            defer { if stage == .connecting { stage = .idle } }
            do {
                serverStatus = try await SyncClient(address: serverAddress, password: password).status()
                message = "Connected to Lantern Photos on your Mac Mini."
            } catch {
                stage = .failed
                message = error.localizedDescription
            }
        }
    }

    func requestPhotosAccess() {
        task = Task {
            permissionStatus = await photoLibrary.requestAuthorization()
            if permissionStatus == .authorized {
                message = "Full Photos access granted. You’re ready to sync."
            } else if permissionStatus == .limited {
                message = "Choose Full Access in Settings so Lantern can find every new photo."
            } else {
                message = "Photos access is required to sync your library."
            }
        }
    }

    func startSync() {
        guard !isSyncing else { return }
        guard !serverAddress.isEmpty else { isShowingSettings = true; return }
        guard permissionStatus == .authorized else { requestPhotosAccess(); return }
        resetCounters()
        UIApplication.shared.isIdleTimerDisabled = true
        task = Task {
            defer { UIApplication.shared.isIdleTimerDisabled = false }
            do {
                stage = .connecting
                let client = try SyncClient(address: serverAddress, password: password)
                serverStatus = try await client.status()
                try Task.checkCancellation()

                stage = .scanning
                message = "Reading your Photos library…"
                let assets = try photoLibrary.imageAssets()
                totalPhotos = assets.count
                let descriptors = assets.map(photoLibrary.descriptor(for:))
                try Task.checkCancellation()

                stage = .comparing
                message = "Comparing \(assets.count.formatted()) photos with your Mac…"
                let missing = try await client.missingAssets(deviceId: deviceId, descriptors: descriptors)
                let pending = assets.filter { missing.contains($0.localIdentifier) }
                photosToSync = pending.count
                existingPhotos = assets.count - pending.count

                if pending.isEmpty {
                    finishSync(message: "Everything is already up to date.")
                    return
                }

                stage = .transferring
                for asset in pending {
                    try Task.checkCancellation()
                    currentPhotoProgress = 0
                    currentPhotoName = PHAssetResource.assetResources(for: asset).first?.originalFilename ?? "Photo"
                    message = "Preparing \(currentPhotoName)…"
                    do {
                        let photo = try await photoLibrary.export(asset) { progress in
                            Task { @MainActor in self.currentPhotoProgress = progress * 0.35 }
                        }
                        currentPhotoName = photo.fileName
                        message = "Checking \(photo.fileName)…"
                        if try await client.needsUpload(deviceId: deviceId, photo: photo) {
                            currentPhotoProgress = 0.45
                            message = "Uploading \(photo.fileName)…"
                            _ = try await client.upload(deviceId: deviceId, photo: photo)
                            uploadedPhotos += 1
                        } else {
                            existingPhotos += 1
                        }
                    } catch is CancellationError {
                        throw CancellationError()
                    } catch {
                        failedPhotos += 1
                    }
                    completedPhotos += 1
                    currentPhotoProgress = 0
                }
                let suffix = failedPhotos > 0 ? " \(failedPhotos) could not be transferred; tap Sync to retry them." : ""
                finishSync(message: "Added \(uploadedPhotos) new photo\(uploadedPhotos == 1 ? "" : "s").\(suffix)")
            } catch is CancellationError {
                stage = .idle
                message = "Sync paused. Tap Sync to resume where you left off."
            } catch {
                stage = .failed
                message = error.localizedDescription
            }
        }
    }

    func cancelSync() {
        task?.cancel()
    }

    func openSystemSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    private func finishSync(message: String) {
        stage = .finished
        self.message = message
        currentPhotoName = ""
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "lastSyncDate")
        objectWillChange.send()
    }

    private func resetCounters() {
        totalPhotos = 0
        photosToSync = 0
        completedPhotos = 0
        uploadedPhotos = 0
        existingPhotos = 0
        failedPhotos = 0
        currentPhotoName = ""
        currentPhotoProgress = 0
    }

    private func normalizedAddress(_ value: String) -> String {
        var address = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if !address.isEmpty && !address.contains("://") { address = "http://" + address }
        while address.hasSuffix("/") { address.removeLast() }
        return address
    }
}
