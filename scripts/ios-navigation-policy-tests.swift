import Foundation

@main
struct VoxelNavigationPolicyTests {
    struct Failure: Error, CustomStringConvertible {
        let description: String
    }

    private static var checks = 0

    private static func require(_ value: @autoclosure () throws -> Bool, _ message: String) throws {
        checks += 1
        if !(try value()) { throw Failure(description: message) }
    }

    private static func url(_ value: String) throws -> URL {
        guard let result = URL(string: value) else {
            throw Failure(description: "The controlled navigation fixture is not a URL")
        }
        return result
    }

    static func main() throws {
        try require(VoxelNavigationPolicy.origin == "https://app.voxelveda.com", "The installed application keeps its canonical production origin")
        try require(VoxelNavigationPolicy.host == "app.voxelveda.com", "The application host is exact")
        try require(VoxelNavigationPolicy.legacyHost == "voxelveda-app-production.up.railway.app", "Only the established legacy application host can migrate")

        let suffix = "/portal/staff?returnTo=%2Ftimesheets%3Fweek%3D2026-10-19&tag=a%2Bb&space=a%20b#week%2F41"
        for host in [VoxelNavigationPolicy.host, VoxelNavigationPolicy.legacyHost] {
            let input = try url("https://" + host + ":443" + suffix)
            let output = VoxelNavigationPolicy.canonical(input)
            try require(output?.absoluteString == VoxelNavigationPolicy.origin + suffix, "Canonical migration preserves the exact encoded path, query and fragment")
            try require(output.map(VoxelNavigationPolicy.isApplication) == true, "A canonicalised destination remains inside the application")
        }
        try require(VoxelNavigationPolicy.canonical(try url(VoxelNavigationPolicy.origin))?.absoluteString == VoxelNavigationPolicy.origin + "/", "The root URL has a stable canonical path")
        try require(VoxelNavigationPolicy.isApplication(try url("https://APP.VOXELVEDA.COM/portal/staff")), "DNS host case does not send an internal page outside the app")
        try require(!VoxelNavigationPolicy.isApplication(try url("https://" + VoxelNavigationPolicy.legacyHost + "/login")), "A legacy URL must be explicitly canonicalised before application navigation")

        let untrusted = [
            "http://app.voxelveda.com/portal/staff",
            "http://voxelveda-app-production.up.railway.app/login",
            "https://app.voxelveda.com.evil.invalid/portal/staff",
            "https://evil-app.voxelveda.com/login",
            "https://app.voxelveda.com@evil.invalid/login",
            "https://fixture@app.voxelveda.com/login",
            "https://fixture:secret@app.voxelveda.com/login",
            "https://app.voxelveda.com:444/login",
            "https://voxelveda-app-production.up.railway.app:444/login",
            "https://app.voxelveda.com./login",
            "capacitor://app.voxelveda.com/login",
            "file:///portal/staff",
            "javascript:window.location='https://app.voxelveda.com'",
            "data:text/html,fixture",
            "https://example.invalid/login"
        ]
        for value in untrusted {
            let input = try url(value)
            try require(!VoxelNavigationPolicy.isApplication(input), "An untrusted origin cannot become an application page")
            try require(VoxelNavigationPolicy.canonical(input) == nil, "Canonical migration cannot forward credentials or adopt an untrusted origin")
        }
        for value in [
            "https://app.voxelveda.com//evil.invalid/path",
            "https://voxelveda-app-production.up.railway.app/%2F%2Fevil.invalid/path",
            "https://app.voxelveda.com/%5Cevil.invalid/path"
        ] {
            try require(VoxelNavigationPolicy.canonical(try url(value)) == nil, "Ambiguous slash or backslash paths cannot be canonical redirects")
        }

        try require(VoxelNavigationPolicy.isPopupPlaceholder(nil), "An initially empty popup can await its actual destination")
        for value in ["about:blank", "about:blank#pending", "about:blank%23pending"] {
            let input = try url(value)
            try require(VoxelNavigationPolicy.isPopupPlaceholder(input), "Only an inert popup placeholder receives placeholder treatment: fixture \(value), Foundation URL \(input.absoluteString), components \(URLComponents(url: input, resolvingAgainstBaseURL: false)?.string ?? "nil")")
            try require(!VoxelNavigationPolicy.isApplication(input), "A blank popup has no application privilege")
            try require(VoxelNavigationPolicy.canonical(input) == nil, "A blank popup cannot become a canonical application destination")
            try require(!VoxelNavigationPolicy.isSupportedExternal(input), "A blank popup cannot launch an external application")
        }
        for value in ["about:blank?redirect=fixture", "about:blank%3Fredirect=fixture", "about:srcdoc", "about:blank/fixture", "about://fixture/blank", "https://example.invalid/about:blank"] {
            try require(!VoxelNavigationPolicy.isPopupPlaceholder(try url(value)), "A real or unrelated destination is not an inert blank popup")
        }

        let safeMethods: [String?] = [nil, "GET", "get"]
        for method in safeMethods {
            try require(VoxelNavigationPolicy.isReadOnly(method), "Only safe GET navigation can migrate a legacy URL")
        }
        for method in ["POST", "post", "PUT", "PATCH", "DELETE", "HEAD", "", " GET "] {
            try require(!VoxelNavigationPolicy.isReadOnly(method), "Legacy writes or ambiguous methods must not be replayed at a new origin")
        }
        let legacyWrite = try url("https://" + VoxelNavigationPolicy.legacyHost + "/api/attendance/clock-out")
        try require(!VoxelNavigationPolicy.isApplication(legacyWrite) && !VoxelNavigationPolicy.isReadOnly("POST"), "A legacy POST is neither an internal destination nor a migratable read")

        for value in ["https://example.invalid/help", "https://example.invalid:443/help", "mailto:info@voxelveda.com", "tel:+61123456789"] {
            try require(VoxelNavigationPolicy.isSupportedExternal(try url(value)), "An intentional supported HTTPS, mail or telephone action remains available")
        }
        for value in [
            "http://example.invalid/help", "https://fixture:secret@example.invalid/help", "https://example.invalid:444/help",
            "ftp://example.invalid/file", "intent://fixture", "voxelveda://login", "javascript:alert(1)",
            "file:///tmp/fixture", "data:text/html,fixture", "about:blank"
        ] {
            try require(!VoxelNavigationPolicy.isSupportedExternal(try url(value)), "Unsupported schemes, credentials and ports cannot launch external navigation")
        }
        print("iOS Foundation navigation policy passed \(checks) behavioural checks: canonical and legacy destinations, encoded URL preservation, credential/origin rejection, non-privileged blank popups, safe-method migration and explicit external schemes. This is not installed-device or App Store distribution evidence.")
    }
}
