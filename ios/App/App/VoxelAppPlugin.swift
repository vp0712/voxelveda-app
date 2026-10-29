import Foundation
import UIKit
import WebKit
import PDFKit
import CryptoKit
import Capacitor

/// The same document API used by the existing web adapter on Android. No cookie
/// copying, alternate download endpoint or unvalidated Blob navigation is used.
@objc(VoxelAppPlugin)
final class VoxelAppPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    let identifier = "VoxelAppPlugin"
    let jsName = "VoxelVedaApp"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getAppInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAppearance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openCameraSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "presentPdf", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "savePdf", returnType: CAPPluginReturnPromise)
    ]
    private weak var controller: VoxelVedaViewController?
    private var preparingPdf = false
    private var pendingExport: Export?

    private struct Export {
        let call: CAPPluginCall
        let directory: URL
        let filename: String
        let sourceHash: Data
        let owner: String
    }

    init(controller: VoxelVedaViewController) { self.controller = controller; super.init() }

    private func authorised(_ call: CAPPluginCall) -> Bool {
        guard let url = controller?.webView?.url, VoxelNavigationPolicy.isApplication(url) else {
            call.reject("This action requires the secure Voxel Veda application.", "NATIVE_ORIGIN_REQUIRED")
            return false
        }
        return true
    }

    @objc func getAppInfo(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.authorised(call) else { return }
            let info = Bundle.main.infoDictionary ?? [:]
            call.resolve(["packageId": Bundle.main.bundleIdentifier ?? "Unavailable",
                          "versionName": info["CFBundleShortVersionString"] as? String ?? "Unavailable",
                          "versionCode": info["CFBundleVersion"] as? String ?? "Unavailable",
                          "sourceCommit": info["VoxelVedaNativeSourceCommit"] as? String ?? "Unavailable",
                          "platform": "iOS"])
        }
    }

    @objc func setAppearance(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.authorised(call), let controller = self.controller else { return }
            let dark = call.getBool("dark") ?? false
            controller.overrideUserInterfaceStyle = dark ? .dark : .light
            controller.statusBarStyle = dark ? .lightContent : .darkContent
            controller.setNeedsStatusBarAppearanceUpdate()
            call.resolve()
        }
    }

    @objc func openCameraSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.authorised(call), let url = URL(string: UIApplication.openSettingsURLString) else { return }
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened { call.resolve() }
                else { call.reject("Application settings could not be opened. Use iOS Settings to review camera permission.", "NATIVE_SETTINGS_UNAVAILABLE") }
            }
        }
    }

    @objc func presentPdf(_ call: CAPPluginCall) { preparePdf(call, export: false) }
    @objc func savePdf(_ call: CAPPluginCall) { preparePdf(call, export: true) }

    private func currentOwner(_ completion: @escaping (String?) -> Void) {
        guard let web = controller?.webView, let url = web.url, VoxelNavigationPolicy.isApplication(url) else {
            completion(nil); return
        }
        // Only an account identifier is used as a stale-result guard. Credentials
        // and the document body are never copied into diagnostics or URLs.
        web.evaluateJavaScript("(()=>{try{return String(JSON.parse(localStorage.getItem('user')||'{}').id||'')}catch{return ''}})()") { value, error in
            completion(error == nil ? value as? String : nil)
        }
    }

    private func preparePdf(_ call: CAPPluginCall, export: Bool) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.authorised(call), let controller = self.controller else { return }
            guard !self.preparingPdf, self.pendingExport == nil, controller.presentedViewController == nil else {
                call.reject("Another document action is open. Finish or cancel it first.", "NATIVE_DOCUMENT_BUSY"); return
            }
            guard let filename = call.getString("filename"), let encoded = call.getString("base64"),
                  encoded.utf8.count >= 136, encoded.utf8.count <= 28 * 1024 * 1024 else {
                call.reject("The PDF is empty or exceeds the supported size. No file was saved.", "NATIVE_PDF_INVALID"); return
            }
            self.preparingPdf = true
            self.currentOwner { owner in
                guard let owner = owner, !owner.isEmpty else {
                    self.preparingPdf = false; call.reject("The current account could not be verified. Return to the record and retry.", "NATIVE_ACCOUNT_CHANGED"); return
                }
                DispatchQueue.global(qos: .userInitiated).async {
                    var directory: URL?
                    do {
                        try VoxelPdfPolicy.validateMetadata(mime: "application/pdf", filename: filename)
                        guard let bytes = Data(base64Encoded: encoded) else { throw VoxelPdfPolicy.ValidationError.invalidDocument }
                        let pages = try VoxelPdfPolicy.validate(data: bytes)
                        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("voxel-pdf-" + UUID().uuidString, isDirectory: true)
                        directory = folder
                        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
                        let file = folder.appendingPathComponent(filename)
                        try bytes.write(to: file, options: .atomic)
                        let hash = Data(SHA256.hash(data: bytes))
                        DispatchQueue.main.async {
                            self.currentOwner { current in
                                self.preparingPdf = false
                                guard current == owner, controller.viewIfLoaded?.window != nil, controller.presentedViewController == nil else {
                                    try? FileManager.default.removeItem(at: folder)
                                    call.reject("The account or active document action changed. No new document was presented.", "NATIVE_ACCOUNT_CHANGED"); return
                                }
                                if export {
                                    self.pendingExport = Export(call: call, directory: folder, filename: filename, sourceHash: hash, owner: owner)
                                    let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: true)
                                    picker.delegate = self
                                    controller.present(picker, animated: true)
                                } else {
                                    let reader = VoxelPdfPreviewController(file: file, cleanup: { try? FileManager.default.removeItem(at: folder) })
                                    let navigation = UINavigationController(rootViewController: reader)
                                    navigation.modalPresentationStyle = .fullScreen
                                    controller.present(navigation, animated: true) { call.resolve(["presented": true, "filename": filename, "pageCount": pages]) }
                                }
                            }
                        }
                    } catch {
                        if let folder = directory { try? FileManager.default.removeItem(at: folder) }
                        DispatchQueue.main.async {
                            self.preparingPdf = false
                            call.reject("The document could not be validated as a readable PDF. No file was saved.", "NATIVE_PDF_INVALID")
                        }
                    }
                }
            }
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let pending = pendingExport else { return }
        pendingExport = nil
        try? FileManager.default.removeItem(at: pending.directory)
        pending.call.resolve(["saved": false])
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let pending = pendingExport else { return }
        pendingExport = nil
        guard urls.count == 1, let destination = urls.first else {
            try? FileManager.default.removeItem(at: pending.directory)
            pending.call.reject("The selected PDF destination could not be verified. Check Files before retrying.", "NATIVE_PDF_SAVE_UNVERIFIED"); return
        }
        let scoped = destination.startAccessingSecurityScopedResource()
        preparingPdf = true
        DispatchQueue.global(qos: .userInitiated).async {
            let valid: Bool
            do {
                try VoxelPdfPolicy.validateMetadata(mime: "application/pdf", filename: destination.lastPathComponent)
                let bytes = try Data(contentsOf: destination, options: .mappedIfSafe)
                try VoxelPdfPolicy.validate(data: bytes)
                valid = Data(SHA256.hash(data: bytes)) == pending.sourceHash
            } catch { valid = false }
            if scoped { destination.stopAccessingSecurityScopedResource() }
            try? FileManager.default.removeItem(at: pending.directory)
            DispatchQueue.main.async {
                self.currentOwner { owner in
                    self.preparingPdf = false
                    if valid, owner == pending.owner { pending.call.resolve(["saved": true, "filename": pending.filename]) }
                    else { pending.call.reject("The destination or account changed before verification. Check Files before retrying; no successful save is claimed.", "NATIVE_PDF_SAVE_UNVERIFIED") }
                }
            }
        }
    }
}

private final class VoxelPdfPreviewController: UIViewController {
    private let file: URL
    private let cleanup: () -> Void
    private var closed = false
    init(file: URL, cleanup: @escaping () -> Void) {
        self.file = file; self.cleanup = cleanup; super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("Use the validated PDF initializer") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = file.lastPathComponent
        let pdf = PDFView(frame: .zero)
        pdf.translatesAutoresizingMaskIntoConstraints = false
        pdf.autoScales = true
        pdf.displayMode = .singlePageContinuous
        pdf.document = PDFDocument(url: file)
        view.backgroundColor = .systemBackground
        view.addSubview(pdf)
        NSLayoutConstraint.activate([pdf.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor), pdf.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor), pdf.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), pdf.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)])
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(close))
        navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .action, target: self, action: #selector(share))
    }
    @objc private func close() {
        guard !closed else { return }
        closed = true
        dismiss(animated: true, completion: cleanup)
    }
    @objc private func share() {
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        sheet.popoverPresentationController?.barButtonItem = navigationItem.rightBarButtonItem
        present(sheet, animated: true)
    }
    deinit { if !closed { cleanup() } }
}
