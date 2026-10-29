import Foundation

/// Exact native navigation boundary. URL queries, fragments and credentials are never logged.
enum VoxelNavigationPolicy {
    static let origin = "https://app.voxelveda.com"
    static let host = "app.voxelveda.com"
    static let legacyHost = "voxelveda-app-production.up.railway.app"

    private static func components(_ url: URL) -> URLComponents? {
        guard !url.absoluteString.unicodeScalars.contains(where: { $0.value <= 32 || $0.value == 92 }),
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme?.lowercased() == "https", parts.user == nil, parts.password == nil,
              parts.port == nil || parts.port == 443 else { return nil }
        return parts
    }

    static func isApplication(_ url: URL) -> Bool {
        guard let parts = components(url) else { return false }
        return parts.host?.lowercased() == host
    }

    static func canonical(_ url: URL) -> URL? {
        guard var parts = components(url), let target = parts.host?.lowercased(),
              target == host || target == legacyHost,
              !parts.percentEncodedPath.hasPrefix("//"), !parts.path.hasPrefix("//"),
              !parts.path.contains("\\") else { return nil }
        parts.scheme = "https"
        parts.host = host
        parts.port = nil
        if parts.percentEncodedPath.isEmpty { parts.percentEncodedPath = "/" }
        return parts.url
    }

    static func isPopupPlaceholder(_ url: URL?) -> Bool {
        guard let url = url else { return true }
        if url.absoluteString.isEmpty { return true }
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        // Foundation can canonicalise the opaque about URL differently from a
        // literal string. Compare parsed URI fields without decoding a new
        // scheme/path or giving the placeholder any application privilege.
        return parts.scheme?.lowercased() == "about" && parts.host == nil &&
            parts.user == nil && parts.password == nil && parts.port == nil &&
            parts.percentEncodedPath == "blank" && parts.query == nil
    }

    static func isSupportedExternal(_ url: URL) -> Bool {
        if let parts = components(url), parts.host?.isEmpty == false { return true }
        return ["mailto", "tel"].contains(url.scheme?.lowercased() ?? "")
    }

    static func isReadOnly(_ method: String?) -> Bool {
        return method == nil || method?.uppercased() == "GET"
    }
}
