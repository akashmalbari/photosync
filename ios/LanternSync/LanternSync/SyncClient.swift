import Foundation

enum SyncClientError: LocalizedError {
    case invalidAddress
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidAddress: return "Enter the Lantern Photos address shown on your Mac Mini."
        case .invalidResponse: return "The Mac Mini returned an unexpected response."
        case .server(let message): return message
        }
    }
}

struct SyncClient {
    let baseURL: URL
    let password: String
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(address: String, password: String) throws {
        var normalized = address.trimmingCharacters(in: .whitespacesAndNewlines)
        if !normalized.contains("://") { normalized = "http://" + normalized }
        while normalized.hasSuffix("/") { normalized.removeLast() }
        guard let url = URL(string: normalized), let scheme = url.scheme, ["http", "https"].contains(scheme) else {
            throw SyncClientError.invalidAddress
        }
        self.baseURL = url
        self.password = password
    }

    func status() async throws -> ServerStatus {
        var request = try makeRequest(path: "/api/sync/status", method: "GET")
        request.timeoutInterval = 12
        return try await send(request, as: ServerStatus.self)
    }

    func missingAssets(deviceId: String, descriptors: [AssetDescriptor]) async throws -> Set<String> {
        var missing = Set<String>()
        for start in stride(from: 0, to: descriptors.count, by: 300) {
            try Task.checkCancellation()
            let end = min(start + 300, descriptors.count)
            var request = try makeRequest(path: "/api/sync/check", method: "POST")
            request.httpBody = try encoder.encode(SyncCheckRequest(deviceId: deviceId, assets: Array(descriptors[start..<end])))
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let response = try await send(request, as: SyncCheckResponse.self)
            missing.formUnion(response.missing)
        }
        return missing
    }

    func needsUpload(deviceId: String, photo: ExportedPhoto) async throws -> Bool {
        var request = try makeRequest(path: "/api/sync/content-check", method: "POST")
        request.httpBody = try encoder.encode(ContentCheckRequest(
            deviceId: deviceId,
            assetId: photo.assetId,
            assetVersion: photo.assetVersion,
            hash: photo.sha256,
            size: photo.data.count,
            fileName: photo.fileName,
            createdAt: photo.createdAt
        ))
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return try await send(request, as: ContentCheckResponse.self).needed
    }

    func upload(deviceId: String, photo: ExportedPhoto) async throws -> UploadResponse {
        var request = try makeRequest(path: "/api/sync/upload", method: "POST")
        request.setValue(photo.contentType, forHTTPHeaderField: "Content-Type")
        request.setValue(deviceId, forHTTPHeaderField: "X-Device-ID")
        request.setValue(percentEncode(photo.assetId), forHTTPHeaderField: "X-Asset-ID")
        request.setValue(photo.assetVersion, forHTTPHeaderField: "X-Asset-Version")
        request.setValue(percentEncode(photo.fileName), forHTTPHeaderField: "X-File-Name")
        request.setValue(photo.sha256, forHTTPHeaderField: "X-Photo-SHA256")
        if let createdAt = photo.createdAt { request.setValue(createdAt, forHTTPHeaderField: "X-Created-At") }
        request.timeoutInterval = 600
        let (data, response) = try await URLSession.shared.upload(for: request, from: photo.data)
        return try decodeResponse(data: data, response: response, as: UploadResponse.self)
    }

    private func makeRequest(path: String, method: String) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: baseURL) else { throw SyncClientError.invalidAddress }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !password.isEmpty { request.setValue(password, forHTTPHeaderField: "X-Library-Password") }
        return request
    }

    private func send<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: request)
        return try decodeResponse(data: data, response: response, as: type)
    }

    private func decodeResponse<T: Decodable>(data: Data, response: URLResponse, as type: T.Type) throws -> T {
        guard let http = response as? HTTPURLResponse else { throw SyncClientError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? decoder.decode(ServerError.self, from: data).error) ?? "The Mac Mini rejected this request."
            throw SyncClientError.server(message)
        }
        do { return try decoder.decode(type, from: data) }
        catch { throw SyncClientError.invalidResponse }
    }

    private func percentEncode(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? value
    }
}
