import CryptoKit
import Foundation
import Photos
import UniformTypeIdentifiers

enum PhotoLibraryError: LocalizedError {
    case fullAccessRequired
    case exportFailed

    var errorDescription: String? {
        switch self {
        case .fullAccessRequired:
            return "Full Photos access is required to find every new photo. You can enable it in Settings."
        case .exportFailed:
            return "This photo could not be read from the Photos library."
        }
    }
}

final class PhotoLibraryService {
    func authorizationStatus() -> PHAuthorizationStatus {
        PHPhotoLibrary.authorizationStatus(for: .readWrite)
    }

    func requestAuthorization() async -> PHAuthorizationStatus {
        await withCheckedContinuation { continuation in
            PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
                continuation.resume(returning: status)
            }
        }
    }

    func imageAssets() throws -> [PHAsset] {
        guard authorizationStatus() == .authorized else { throw PhotoLibraryError.fullAccessRequired }
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
        let result = PHAsset.fetchAssets(with: .image, options: options)
        var assets: [PHAsset] = []
        assets.reserveCapacity(result.count)
        result.enumerateObjects { asset, _, _ in assets.append(asset) }
        return assets
    }

    func descriptor(for asset: PHAsset) -> AssetDescriptor {
        AssetDescriptor(assetId: asset.localIdentifier, assetVersion: version(for: asset))
    }

    func export(_ asset: PHAsset, progress: @escaping @Sendable (Double) -> Void) async throws -> ExportedPhoto {
        let result = try await imageData(for: asset, progress: progress)
        let resources = PHAssetResource.assetResources(for: asset)
        let originalName = resources.first(where: { $0.type == .fullSizePhoto || $0.type == .photo })?.originalFilename
            ?? "Photo-\(asset.localIdentifier.prefix(8)).jpg"
        let fileName = adjustedFileName(originalName, uniformTypeIdentifier: result.1)
        let digest = SHA256.hash(data: result.0).map { String(format: "%02x", $0) }.joined()
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return ExportedPhoto(
            assetId: asset.localIdentifier,
            assetVersion: version(for: asset),
            fileName: fileName,
            createdAt: asset.creationDate.map(formatter.string(from:)),
            contentType: UTType(result.1)?.preferredMIMEType ?? "application/octet-stream",
            data: result.0,
            sha256: digest
        )
    }

    private func version(for asset: PHAsset) -> String {
        let date = asset.modificationDate ?? asset.creationDate ?? .distantPast
        let milliseconds = Int64(date.timeIntervalSince1970 * 1_000)
        return "\(milliseconds)-\(asset.pixelWidth)x\(asset.pixelHeight)"
    }

    private func adjustedFileName(_ originalName: String, uniformTypeIdentifier: String) -> String {
        guard let preferredExtension = UTType(uniformTypeIdentifier)?.preferredFilenameExtension else { return originalName }
        let url = URL(fileURLWithPath: originalName)
        if url.pathExtension.caseInsensitiveCompare(preferredExtension) == .orderedSame { return originalName }
        return url.deletingPathExtension().lastPathComponent + "." + preferredExtension
    }

    private func imageData(for asset: PHAsset, progress: @escaping @Sendable (Double) -> Void) async throws -> (Data, String) {
        try await withCheckedThrowingContinuation { continuation in
            let options = PHImageRequestOptions()
            options.deliveryMode = .highQualityFormat
            options.resizeMode = .none
            options.version = .current
            options.isNetworkAccessAllowed = true
            options.progressHandler = { value, _, _, _ in progress(value) }
            let lock = NSLock()
            var finished = false
            PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) { data, typeIdentifier, _, info in
                let degraded = (info?[PHImageResultIsDegradedKey] as? Bool) ?? false
                if degraded { return }
                lock.lock()
                defer { lock.unlock() }
                guard !finished else { return }
                finished = true
                if let cancelled = info?[PHImageCancelledKey] as? Bool, cancelled {
                    continuation.resume(throwing: CancellationError())
                } else if let error = info?[PHImageErrorKey] as? Error {
                    continuation.resume(throwing: error)
                } else if let data, let typeIdentifier {
                    continuation.resume(returning: (data, typeIdentifier))
                } else {
                    continuation.resume(throwing: PhotoLibraryError.exportFailed)
                }
            }
        }
    }
}
