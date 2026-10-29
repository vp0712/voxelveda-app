import Foundation
import CoreGraphics

@main
struct VoxelPdfPolicyTests {
    struct Failure: Error, CustomStringConvertible { let description: String }
    private static var checks = 0

    private static func require(_ value: @autoclosure () throws -> Bool, _ message: String) throws {
        checks += 1
        if !(try value()) { throw Failure(description: message) }
    }

    private static func rejects(_ message: String, _ action: () throws -> Void) throws {
        var rejected = false
        do { try action() } catch { rejected = true }
        try require(rejected, message)
    }

    private static func url(_ value: String) throws -> URL {
        guard let result = URL(string: value) else { throw Failure(description: "The controlled blob fixture is not a URL") }
        return result
    }

    private static func pdf(pages: Int) throws -> Data {
        let bytes = NSMutableData()
        guard let consumer = CGDataConsumer(data: bytes as CFMutableData) else {
            throw Failure(description: "Could not create the fixture PDF consumer")
        }
        var page = CGRect(x: 0, y: 0, width: 320, height: 480)
        guard let context = CGContext(consumer: consumer, mediaBox: &page, nil) else {
            throw Failure(description: "Could not create the fixture PDF renderer")
        }
        for index in 0..<pages {
            context.beginPDFPage(nil)
            // Actual drawn content on every page prevents a blank header-only
            // fixture from standing in for a complete generated PDF document.
            context.setFillColor(CGColor(gray: CGFloat(index % 2) / 2, alpha: 1))
            context.fill(CGRect(x: 24, y: 24, width: 60, height: 24))
            context.endPDFPage()
        }
        context.closePDF()
        return bytes as Data
    }

    static func main() throws {
        let identifier = "673c8c77-cab4-4602-a655-459be2f749da"
        try require(VoxelPdfPolicy.isApplicationBlob(try url("blob:https://app.voxelveda.com/" + identifier)), "A browser-generated PDF blob has the exact owned origin; classification does not grant navigation privilege")
        try require(VoxelPdfPolicy.isApplicationBlob(try url("blob:https://app.voxelveda.com/" + identifier.uppercased())), "UUID hexadecimal case does not change blob ownership")
        for value in [
            "https://app.voxelveda.com/" + identifier,
            "blob:http://app.voxelveda.com/" + identifier,
            "blob:https://app.voxelveda.com.evil.invalid/" + identifier,
            "blob:https://fixture@app.voxelveda.com/" + identifier,
            "blob:https://fixture:secret@app.voxelveda.com/" + identifier,
            "blob:https://app.voxelveda.com:443/" + identifier,
            "blob:https://app.voxelveda.com:444/" + identifier,
            "blob:https://voxelveda-app-production.up.railway.app/" + identifier,
            "blob:https://app.voxelveda.com/" + identifier + "?download=1",
            "blob:https://app.voxelveda.com/" + identifier + "#document",
            "blob:https://app.voxelveda.com/path/" + identifier,
            "blob:https://app.voxelveda.com/not-a-uuid",
            "blob:null/" + identifier,
            "file:///tmp/document.pdf", "data:application/pdf;base64,JVBERi0=", "javascript:alert(1)"
        ] {
            try require(!VoxelPdfPolicy.isApplicationBlob(try url(value)), "An unrelated or ambiguous blob cannot receive private application download privileges")
        }

        for name in ["Timesheet.pdf", "Timesheet 2026-10-19_v2.pdf", "A.pdf", String(repeating: "A", count: 180) + ".pdf"] {
            try VoxelPdfPolicy.validateMetadata(mime: "application/pdf", filename: name)
            checks += 1
        }
        try VoxelPdfPolicy.validateMetadata(mime: "Application/PDF; charset=binary", filename: "Timesheet.pdf")
        checks += 1
        for name in [
            "document.tmp", "document.html", "document.zip", "document.PDF", ".pdf",
            "../Timesheet.pdf", "folder/Timesheet.pdf", "folder\\Timesheet.pdf",
            "Timesheet.pdf\n", "Timesheet\r.pdf", "Tïmesheet.pdf", "Timesheet.pdf.html",
            String(repeating: "A", count: 181) + ".pdf"
        ] {
            try rejects("The recipient-visible PDF name rejects unsafe paths and alternative formats") {
                try VoxelPdfPolicy.validateMetadata(mime: "application/pdf", filename: name)
            }
        }
        let invalidMimeTypes: [String?] = [nil, "", "text/html", "application/zip", "application/octet-stream", ";application/pdf"]
        for mime in invalidMimeTypes {
            try rejects("A safe filename cannot substitute for PDF MIME metadata") {
                try VoxelPdfPolicy.validateMetadata(mime: mime, filename: "Timesheet.pdf")
            }
        }

        for pages in [1, 2] {
            let data = try pdf(pages: pages)
            let original = Data(data)
            try require(try VoxelPdfPolicy.validate(data: data) == pages, "The parser must read every actual rendered PDF page")
            try require(data == original, "Validation preserves the original PDF bytes for saving and sharing")
        }
        for data in [
            Data(), Data("<html><body>PDF generation failed</body></html>".utf8),
            Data("{\"error\":\"generation failed\"}".utf8),
            Data("PK\u{03}\u{04}".utf8) + Data(repeating: 0, count: 200),
            Data("%PDF-1.7\n".utf8) + Data(repeating: 0, count: 200),
            Data("%PDF-1.7\n".utf8) + Data(repeating: 0, count: 50)
        ] {
            try rejects("Empty, corrupt and disguised non-PDF data cannot be saved as a PDF") {
                _ = try VoxelPdfPolicy.validate(data: data)
            }
        }
        let valid = try pdf(pages: 1)
        let oversized = valid + Data(repeating: 0, count: VoxelPdfPolicy.maximumBytes + 1)
        try rejects("PDF size limits are enforced before parser processing") { _ = try VoxelPdfPolicy.validate(data: oversized) }
        let tooManyPages = try pdf(pages: VoxelPdfPolicy.maximumPages + 1)
        try rejects("A generated PDF beyond the page limit is rejected") { _ = try VoxelPdfPolicy.validate(data: tooManyPages) }
        print("iOS PDF policy passed \(checks) behavioural checks: exact application blob ownership, safe PDF MIME/filename metadata, actual one/two-page parser validation, unchanged bytes and corrupt/size/page rejection. This is not installed-device download/share or distribution evidence.")
    }
}
