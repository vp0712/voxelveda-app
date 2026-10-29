import Foundation
import PDFKit

/// Validation for an authenticated application's downloaded PDF. The caller must
/// retain/write the original Data; parser validation never rewrites a document.
enum VoxelPdfPolicy {
    static let maximumBytes = 20 * 1024 * 1024
    static let maximumPages = 500

    enum ValidationError: LocalizedError {
        case invalidMime, invalidFilename, invalidSize, invalidDocument, invalidPageCount, unreadablePage

        var errorDescription: String? {
            switch self {
            case .invalidMime: return "The download is not declared as a PDF."
            case .invalidFilename: return "The PDF filename is invalid."
            case .invalidSize: return "The PDF is empty or exceeds the supported size."
            case .invalidDocument: return "The downloaded file is not a readable PDF."
            case .invalidPageCount: return "The PDF has no pages or exceeds the supported page count."
            case .unreadablePage: return "A page in the PDF could not be read."
            }
        }
    }

    static func isApplicationBlob(_ url: URL) -> Bool {
        let value = url.absoluteString
        let prefix = "blob:https://app.voxelveda.com/"
        guard url.scheme == "blob", value.hasPrefix(prefix) else { return false }
        let identifier = String(value.dropFirst(prefix.count))
        guard identifier.count == 36, let uuid = UUID(uuidString: identifier),
              uuid.uuidString.lowercased() == identifier.lowercased(),
              let parts = URLComponents(string: String(value.dropFirst(5))),
              parts.scheme == "https", parts.host == "app.voxelveda.com",
              parts.user == nil, parts.password == nil, parts.port == nil,
              parts.query == nil, parts.fragment == nil,
              parts.percentEncodedPath == "/" + identifier else { return false }
        return true
    }

    static func validateMetadata(mime: String?, filename: String) throws {
        let mediaType = mime?.components(separatedBy: ";").first?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard mediaType == "application/pdf" else { throw ValidationError.invalidMime }
        // This is the existing Android safe-filename contract: one alphanumeric
        // leading character, up to 179 further safe ASCII characters, then .pdf.
        guard filename.count >= 5, filename.count <= 184, filename.hasSuffix(".pdf") else {
            throw ValidationError.invalidFilename
        }
        let stem = filename.dropLast(4)
        let alphanumeric = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")
        let safe = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._ -")
        guard let first = stem.unicodeScalars.first, alphanumeric.contains(first),
              stem.unicodeScalars.allSatisfy({ $0.isASCII && safe.contains($0) }) else {
            throw ValidationError.invalidFilename
        }
    }

    @discardableResult
    static func validate(data: Data) throws -> Int {
        guard data.count >= 100, data.count <= maximumBytes else { throw ValidationError.invalidSize }
        guard data.starts(with: Data("%PDF-".utf8)), let document = PDFDocument(data: data), !document.isLocked else {
            throw ValidationError.invalidDocument
        }
        let count = document.pageCount
        guard count >= 1, count <= maximumPages else { throw ValidationError.invalidPageCount }
        for index in 0..<count {
            guard document.page(at: index) != nil else { throw ValidationError.unreadablePage }
        }
        return count
    }
}
