package com.voxelveda.app;

import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.webkit.*;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/** Keeps ordinary navigation in the app; the framework's external ACTION_VIEW fallback is not used. */
public class ApplicationWebViewClient extends BridgeWebViewClient {
    protected final MainActivity activity;

    public ApplicationWebViewClient(Bridge bridge, MainActivity activity) {
        super(bridge);
        this.activity = activity;
    }

    @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        String url = request.getUrl().toString();
        if (NavigationPolicy.isApplication(url)) return false;
        String canonical = NavigationPolicy.canonical(url);
        if (canonical != null && request.isForMainFrame() && "GET".equals(request.getMethod())) {
            view.loadUrl(canonical);
            return true;
        }
        if (request.isForMainFrame()) activity.handleExternalNavigation(request.getUrl(), request.hasGesture());
        return true;
    }

    @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
        if (NavigationPolicy.isApplication(url)) return false;
        String canonical = NavigationPolicy.canonical(url);
        if (canonical != null) view.loadUrl(canonical);
        else activity.showConnectionError("This address cannot be opened inside Voxel Veda.");
        return true;
    }

    @Override public void onPageStarted(WebView view, String url, Bitmap icon) {
        if (!NavigationPolicy.isApplication(url)) {
            view.stopLoading();
            String canonical = NavigationPolicy.canonical(url);
            if (canonical != null) view.loadUrl(canonical);
            else activity.showConnectionError("Navigation was blocked. Retry your secure Voxel Veda connection.");
            return;
        }
        super.onPageStarted(view, url, icon);
        activity.pageStarted(url);
    }

    @Override public void onPageCommitVisible(WebView view, String url) {
        super.onPageCommitVisible(view, url);
        if (NavigationPolicy.isApplication(url)) activity.pageReady();
    }

    @Override public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        if (NavigationPolicy.isApplication(url) && view.getProgress() == 100) activity.pageReady();
    }

    @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request.isForMainFrame()) activity.showConnectionError("Could not connect securely (" + error.getErrorCode() + "). Check your connection, then retry.");
        // Subresource/API failures remain in the page's own controlled error and reconciliation flow.
    }

    @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
        if (request.isForMainFrame() && response.getStatusCode() >= 500) activity.showConnectionError("The service is temporarily unavailable (" + response.getStatusCode() + "). Retry when ready.");
    }

    @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        handler.cancel();
        activity.showConnectionError("The secure connection could not be verified. Check your device date and connection, then retry.");
    }
}
