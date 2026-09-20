import Foundation

struct AssetDescriptor: Codable, Hashable {
    let assetId: String
    let assetVersion: String
}

struct SyncCheckRequest: Codable {
    let deviceId: String
    let assets: [AssetDescriptor]
}

struct SyncCheckResponse: Codable {
    let missing: [String]
}

struct ContentCheckRequest: Codable {
    let deviceId: String
    let assetId: String
    let assetVersion: String
    let hash: String
    let size: Int
    let fileName: String
    let createdAt: String?
}

struct ContentCheckResponse: Codable {
    let needed: Bool
    let status: String?
}

struct UploadResponse: Codable {
    let status: String
}

struct ServerStatus: Codable {
    let ready: Bool
    let indexedAssets: Int
    let destination: String
    let maxUploadBytes: Int
}

struct ServerError: Codable {
    let error: String
}

struct ExportedPhoto {
    let assetId: String
    let assetVersion: String
    let fileName: String
    let createdAt: String?
    let contentType: String
    let data: Data
    let sha256: String
}

enum SyncStage: Equatable {
    case idle
    case connecting
    case scanning
    case comparing
    case transferring
    case finished
    case failed

    var label: String {
        switch self {
        case .idle: return "Ready to sync"
        case .connecting: return "Connecting to your Mac…"
        case .scanning: return "Scanning Photos…"
        case .comparing: return "Finding what’s new…"
        case .transferring: return "Sending originals…"
        case .finished: return "Sync complete"
        case .failed: return "Sync needs attention"
        }
    }
}
