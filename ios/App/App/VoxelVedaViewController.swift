import UIKit
import WebKit
import Capacitor

/// Keep Capacitor's authentication, bridge and WebKit delegates; intercept only navigation policy and new windows.
@objc class VoxelVedaViewController: CAPBridgeViewController {
    private var windowDelegate: VoxelWindowDelegate?
    private var pendingWindows: [ObjectIdentifier: VoxelPopupDelegate] = [:]
    private var pendingApplicationLink: URL?

    override func capacitorDidLoad() {
        guard let web = webView else { return }
        let forwarding = VoxelWindowDelegate(controller: self, original: web.uiDelegate)
        windowDelegate = forwarding
        web.uiDelegate = forwarding
        bridge?.registerPluginInstance(VoxelNavigationPlugin(controller: self))
        bridge?.registerPluginInstance(VoxelAppPlugin(controller: self))
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        openPendingApplicationLink()
    }

    func acceptApplicationLink(_ url: URL) -> Bool {
        guard let canonical = VoxelNavigationPolicy.canonical(url) else { return false }
        pendingApplicationLink = canonical
        if viewIfLoaded?.window != nil { openPendingApplicationLink() }
        return true
    }

    private func openPendingApplicationLink() {
        guard let url = pendingApplicationLink, let web = webView else { return }
        pendingApplicationLink = nil
        if web.url != url { web.load(URLRequest(url: url)) }
    }

    fileprivate func navigate(_ action: WKNavigationAction, fromPopup: Bool = false) -> NSNumber? {
        guard action.targetFrame == nil || action.targetFrame?.isMainFrame == true else { return nil }
        guard let url = action.request.url else {
            return NSNumber(value: action.targetFrame != nil && !fromPopup)
        }
        if VoxelNavigationPolicy.isApplication(url) {
            if fromPopup || action.targetFrame == nil {
                // Same-origin requests retain method/body and the existing WebKit cookie store.
                webView?.load(action.request)
                return NSNumber(value: true)
            }
            return NSNumber(value: false)
        }
        if let canonical = VoxelNavigationPolicy.canonical(url) {
            // A legacy write must not be replayed or silently converted to GET.
            if VoxelNavigationPolicy.isReadOnly(action.request.httpMethod) {
                webView?.load(URLRequest(url: canonical))
            } else {
                showBlockedLink("Open the current Voxel Veda record before submitting this action. Nothing was resubmitted.")
            }
            return NSNumber(value: true)
        }
        if VoxelNavigationPolicy.isPopupPlaceholder(url), action.targetFrame == nil || fromPopup {
            return NSNumber(value: false)
        }
        if VoxelPdfPolicy.isApplicationBlob(url) {
            showBlockedLink("Use this record’s Preview or Download PDF action inside Voxel Veda. No file was opened.")
            return NSNumber(value: true)
        }
        if action.navigationType == .linkActivated, VoxelNavigationPolicy.isSupportedExternal(url) {
            confirmExternal(url)
        } else {
            showBlockedLink("This address cannot open automatically. Return to your Voxel Veda account and use the intended link.")
        }
        return NSNumber(value: true)
    }

    fileprivate func newWindow(configuration: WKWebViewConfiguration, action: WKNavigationAction) -> WKWebView? {
        guard VoxelNavigationPolicy.isPopupPlaceholder(action.request.url) else {
            _ = navigate(action, fromPopup: true)
            return nil
        }
        // A blank window can be assigned a destination later. It must never receive the application bridge.
        configuration.userContentController = WKUserContentController()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        let popup = WKWebView(frame: .zero, configuration: configuration)
        let handler = VoxelPopupDelegate(controller: self, webView: popup)
        pendingWindows[ObjectIdentifier(handler)] = handler
        popup.navigationDelegate = handler
        handler.expireAfterDelay()
        return popup
    }

    fileprivate func releaseWindow(_ handler: VoxelPopupDelegate) {
        pendingWindows.removeValue(forKey: ObjectIdentifier(handler))
    }

    private func showBlockedLink(_ message: String) {
        guard viewIfLoaded?.window != nil, presentedViewController == nil else { return }
        let alert = UIAlertController(title: "Link unavailable", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Close", style: .cancel))
        present(alert, animated: true)
    }

    private func confirmExternal(_ url: URL) {
        guard viewIfLoaded?.window != nil, presentedViewController == nil else { return }
        let destination = url.host.map { " for \($0)" } ?? ""
        let alert = UIAlertController(title: "Open another app?", message: "This link leaves Voxel Veda\(destination).", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Open", style: .default) { _ in
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        })
        present(alert, animated: true)
    }
}

@objc(VoxelNavigationPlugin)
private final class VoxelNavigationPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "VoxelNavigationPlugin"
    let jsName = "VoxelVedaNavigation"
    let pluginMethods: [CAPPluginMethod] = []
    private weak var controller: VoxelVedaViewController?

    init(controller: VoxelVedaViewController) { self.controller = controller; super.init() }

    override func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        return controller?.navigate(navigationAction)
    }
}

/// Forward every other optional WKUIDelegate method, including dialogs and file/camera pickers.
private final class VoxelWindowDelegate: NSObject, WKUIDelegate {
    private weak var controller: VoxelVedaViewController?
    private weak var original: WKUIDelegate?
    init(controller: VoxelVedaViewController, original: WKUIDelegate?) {
        self.controller = controller; self.original = original; super.init()
    }
    override func responds(to selector: Selector!) -> Bool {
        return super.responds(to: selector) || original?.responds(to: selector) == true
    }
    override func forwardingTarget(for selector: Selector!) -> Any? {
        return original?.responds(to: selector) == true ? original : super.forwardingTarget(for: selector)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        return controller?.newWindow(configuration: configuration, action: navigationAction)
    }
}

private final class VoxelPopupDelegate: NSObject, WKNavigationDelegate {
    private weak var controller: VoxelVedaViewController?
    private let webView: WKWebView
    private var closed = false
    private var expiry: DispatchWorkItem?
    init(controller: VoxelVedaViewController, webView: WKWebView) {
        self.controller = controller; self.webView = webView; super.init()
    }
    func expireAfterDelay() {
        let work = DispatchWorkItem { [weak self] in self?.close() }
        expiry = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 25, execute: work)
    }
    private func close() {
        guard !closed else { return }
        closed = true; expiry?.cancel(); webView.stopLoading(); webView.navigationDelegate = nil
        controller?.releaseWindow(self)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if !closed, VoxelNavigationPolicy.isPopupPlaceholder(navigationAction.request.url) {
            decisionHandler(.allow)
            return
        }
        if !closed, navigationAction.targetFrame == nil || navigationAction.targetFrame?.isMainFrame == true {
            _ = controller?.navigate(navigationAction, fromPopup: true)
        }
        decisionHandler(.cancel)
        close()
    }
}
