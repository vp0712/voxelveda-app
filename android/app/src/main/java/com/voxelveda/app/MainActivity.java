package com.voxelveda.app;

import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.view.Gravity;
import android.view.View;
import android.webkit.*;
import android.widget.*;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

/** The existing app identity and secure cookie store are retained across upgrades. */
public class MainActivity extends BridgeActivity {
    private final Handler timer = new Handler(Looper.getMainLooper());
    private LinearLayout recovery;
    private TextView connectionMessage;
    private Button retry;
    private String lastGet = NavigationPolicy.ORIGIN + "/";
    private boolean failed;
    private boolean loaded;
    private volatile String currentDocument = NavigationPolicy.ORIGIN + "/";
    private final Runnable timeout = () -> showConnectionError("The connection is taking too long. Check your network, then retry.");

    @Override public void onCreate(Bundle state) {
        registerPlugin(VoxelVedaAppPlugin.class);
        super.onCreate(state);
        if (getBridge() == null) return;
        WebView web = getBridge().getWebView();
        getBridge().setWebViewClient(new ApplicationWebViewClient(getBridge(), this));
        web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.getSettings().setAllowFileAccess(false);
        // Keep user-selected photo/document chooser URIs working; main-frame content/file URLs remain blocked.
        web.getSettings().setAllowContentAccess(true);
        web.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        web.getSettings().setSupportMultipleWindows(true);
        web.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override public boolean onJsConfirm(WebView source, String url, String message, JsResult result) {
                if (!"Discard your unsaved changes?".equals(message)) return super.onJsConfirm(source, url, message, result);
                new AlertDialog.Builder(MainActivity.this).setTitle("Unsaved changes").setMessage(message)
                    .setNegativeButton("Keep editing", (dialog, which) -> result.cancel())
                    .setPositiveButton("Discard", (dialog, which) -> result.confirm()).setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }
            @Override public void onPermissionRequest(PermissionRequest request) {
                if (!NavigationPolicy.isApplication(request.getOrigin().toString())) { request.deny(); return; }
                super.onPermissionRequest(request);
            }
            @Override public boolean onCreateWindow(WebView source, boolean dialog, boolean gesture, Message message) {
                WebView popup = new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    private boolean handled;
                    private void navigate(String url) {
                        if (handled) return;
                        handled = true;
                        popup.stopLoading();
                        String canonical = NavigationPolicy.canonical(url);
                        if (canonical != null) web.loadUrl(canonical);
                        else handleExternalNavigation(Uri.parse(url), gesture);
                        timer.post(popup::destroy);
                    }
                    @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) { navigate(request.getUrl().toString()); return true; }
                    @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) { navigate(url); }
                });
                ((WebView.WebViewTransport) message.obj).setWebView(popup);
                message.sendToTarget();
                return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> showConnectionError("Use the document's Download PDF action to save a verified PDF securely."));
        createRecovery();
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            int keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard));
            return insets;
        });
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (failed) { finish(); return; }
                web.evaluateJavascript("window.VoxelNativeApp ? window.VoxelNativeApp.handleBack() : false", result -> {
                    if ("true".equals(result)) return;
                    if (web.canGoBack()) web.goBack(); else finish();
                });
            }
        });
        if (!NavigationPolicy.isApplication(getBridge().getAppUrl())) {
            web.stopLoading();
            web.loadUrl(lastGet);
        }
        String launch = getIntent() == null ? null : getIntent().getDataString();
        if (launch != null) receiveApplicationLink(launch);
        if (!loaded) pageStarted(lastGet);
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void createRecovery() {
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        recovery = new LinearLayout(this);
        recovery.setOrientation(LinearLayout.VERTICAL);
        recovery.setGravity(Gravity.CENTER);
        recovery.setPadding(dp(24), dp(24), dp(24), dp(24));
        recovery.setBackgroundColor(Color.parseColor(dark ? "#101a2a" : "#f7f8fa"));
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.company_logo);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        logo.setContentDescription("Voxel Veda");
        recovery.addView(logo, new LinearLayout.LayoutParams(dp(112), dp(112)));
        TextView title = new TextView(this);
        title.setText("Voxel Veda"); title.setTextSize(26); title.setGravity(Gravity.CENTER);
        title.setTextColor(Color.parseColor(dark ? "#eaf0fa" : "#142641"));
        recovery.addView(title);
        connectionMessage = new TextView(this);
        connectionMessage.setTextSize(16); connectionMessage.setGravity(Gravity.CENTER);
        connectionMessage.setTextColor(Color.parseColor(dark ? "#eaf0fa" : "#142641"));
        connectionMessage.setPadding(0, dp(20), 0, dp(20));
        recovery.addView(connectionMessage);
        retry = new Button(this); retry.setText("Retry connection"); retry.setMinHeight(dp(48));
        retry.setOnClickListener(v -> { failed = false; pageStarted(lastGet); getBridge().getWebView().loadUrl(lastGet); });
        recovery.addView(retry);
        Button close = new Button(this); close.setText("Close app"); close.setMinHeight(dp(48)); close.setOnClickListener(v -> finish());
        recovery.addView(close);
        addContentView(recovery, new android.view.ViewGroup.LayoutParams(-1, -1));
        recovery.setVisibility(View.GONE);
    }

    public void pageStarted(String url) {
        currentDocument = url;
        if (NavigationPolicy.isApplication(url)) lastGet = NavigationPolicy.canonical(url);
        failed = false;
        timer.removeCallbacks(timeout); timer.postDelayed(timeout, 25000);
        if (!loaded && recovery != null) {
            connectionMessage.setText("Opening your secure account…"); retry.setVisibility(View.GONE); recovery.setVisibility(View.VISIBLE);
        }
    }

    public boolean isTrustedApplicationOrigin() { return NavigationPolicy.isApplication(currentDocument); }

    public void pageReady() {
        timer.removeCallbacks(timeout);
        if (failed) return;
        loaded = true;
        if (recovery != null) recovery.setVisibility(View.GONE);
    }

    public void showConnectionError(String message) {
        runOnUiThread(() -> {
            failed = true; timer.removeCallbacks(timeout);
            if (recovery != null) { connectionMessage.setText(message); retry.setVisibility(View.VISIBLE); recovery.setVisibility(View.VISIBLE); }
        });
    }

    public void handleExternalNavigation(Uri uri, boolean gesture) {
        String scheme = uri.getScheme();
        if (!gesture || !("https".equalsIgnoreCase(scheme) || "mailto".equalsIgnoreCase(scheme) || "tel".equalsIgnoreCase(scheme))) {
            new AlertDialog.Builder(this).setTitle("Link could not be opened").setMessage("Return to your Voxel Veda account and try the intended action.").setPositiveButton("Close", null).show();
            return;
        }
        new AlertDialog.Builder(this).setTitle("Open another app?").setMessage("This link leaves Voxel Veda" + (uri.getHost() == null ? "." : " for " + uri.getHost() + "."))
            .setNegativeButton("Cancel", null).setPositiveButton("Open", (dialog, which) -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
                catch (ActivityNotFoundException error) { showConnectionError("No app is available for this link. Return to Voxel Veda and try another action."); }
            }).show();
    }

    private void receiveApplicationLink(String value) {
        String canonical = NavigationPolicy.canonical(value);
        if (canonical == null) { showConnectionError("This app link is not a trusted Voxel Veda address."); return; }
        if (!canonical.equals(getBridge().getWebView().getUrl())) getBridge().getWebView().loadUrl(canonical);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (getBridge() != null && recovery != null && intent != null && intent.getDataString() != null) receiveApplicationLink(intent.getDataString());
    }

    @Override public void onPause() { super.onPause(); CookieManager.getInstance().flush(); }
    @Override public void onDestroy() { timer.removeCallbacksAndMessages(null); super.onDestroy(); }
}
