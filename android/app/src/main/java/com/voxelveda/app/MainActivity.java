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
    private boolean needsRecreate;
    private boolean checkingReadiness;
    private int navigationVersion;
    private final Runnable readinessProbe = () -> checkPageReadiness(navigationVersion);
    private volatile String currentDocument = NavigationPolicy.ORIGIN + "/";
    private final Runnable timeout = () -> showConnectionError("The connection is taking too long. Check your network, then retry.");

    @Override public void onCreate(Bundle state) {
        registerPlugin(VoxelVedaAppPlugin.class);
        try { super.onCreate(state); } catch (RuntimeException error) {
            if (recovery == null) createRecovery();
            needsRecreate = true; showConnectionError("The app could not initialise. Retry to restart securely."); return;
        }
        if (getBridge() == null) { needsRecreate=true; showConnectionError("Android WebView is unavailable. Update Android System WebView, then retry."); return; }
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
            @Override public boolean onJsBeforeUnload(WebView source, String url, String message, JsResult result) {
                if (!NavigationPolicy.isApplication(url)) { result.cancel(); return true; }
                new AlertDialog.Builder(MainActivity.this).setTitle("Unsaved changes").setMessage("Discard your unsaved changes?")
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
        web.setDownloadListener((url, agent, disposition, mime, length) -> {
            String trusted = NavigationPolicy.canonical(url);
            if (trusted == null || !isTrustedApplicationOrigin()) { handleExternalNavigation(Uri.parse(url), false); return; }
            if (!"application/pdf".equalsIgnoreCase(mime == null ? "" : mime.split(";")[0].trim())) {
                new AlertDialog.Builder(this).setTitle("Document unavailable").setMessage("This response is not a PDF. Return to the record and retry the intended action. No file was saved.").setPositiveButton("Close", null).show(); return;
            }
            boolean download = disposition != null && disposition.toLowerCase(java.util.Locale.ROOT).startsWith("attachment");
            String script = "if(window.VoxelNativeApp){VoxelNativeApp.openDocument(" + org.json.JSONObject.quote(trusted) + "," + download + ").catch(error=>window.alert(error.message));}else{window.alert('Return to the document record and use Download PDF.');}";
            web.evaluateJavascript(script, null);
        });
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            int keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
            // adjustResize can already remove the IME-covered area from this view.
            // Reserve only the remaining overlap, rather than subtracting the keyboard twice.
            android.graphics.Rect visible = new android.graphics.Rect();
            view.getWindowVisibleDisplayFrame(visible);
            int[] location = new int[2];
            view.getLocationOnScreen(location);
            int overlap = Math.max(0, location[1] + view.getHeight() - visible.bottom);
            int keyboardPadding = Math.min(keyboard, overlap);
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboardPadding));
            return insets;
        });
        content.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            if (bottom - top != oldBottom - oldTop) ViewCompat.requestApplyInsets(view);
        });
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (failed) { finish(); return; }
                int version = navigationVersion;
                String requestId = java.util.UUID.randomUUID().toString();
                web.evaluateJavascript("window.VoxelNativeApp ? window.VoxelNativeApp.handleBack({canGoBack:" + web.canGoBack() + ",requestId:" + org.json.JSONObject.quote(requestId) + "}) : false", result -> {
                    if (version != navigationVersion) return;
                    if ("true".equals(result)) { awaitManagedBack(web, requestId, version); return; }
                    if ("false".equals(result)) { if (web.canGoBack()) web.goBack(); else finish(); }
                });
            }
        });
        if (!NavigationPolicy.isApplication(getBridge().getAppUrl())) {
            web.stopLoading();
            web.loadUrl(lastGet);
        }
        String launch = getIntent() == null ? null : getIntent().getDataString();
        if (launch != null) receiveApplicationLink(launch);
        if (!loaded) { pageStarted(lastGet); inspectPageReadiness(); }
    }

    private void awaitManagedBack(WebView web, String requestId, int version) {
        if (version != navigationVersion || isFinishing() || isDestroyed() || !isTrustedApplicationOrigin()) return;
        web.evaluateJavascript("window.VoxelNativeApp?.takeBackDecision?.(" + org.json.JSONObject.quote(requestId) + ") ?? null", result -> {
            if (version != navigationVersion || isFinishing() || isDestroyed()) return;
            if ("\"pending\"".equals(result)) timer.postDelayed(() -> awaitManagedBack(web, requestId, version), 250);
            else if ("\"continue\"".equals(result)) { if (web.canGoBack()) web.goBack(); else finish(); }
            // Null/cancelled decisions consumed only the dismissed UI layer.
        });
    }

    @Override protected void load() {
        createRecovery();
        pageStarted(lastGet);
        super.load();
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void createRecovery() {
        if (recovery != null) return;
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
        retry.setOnClickListener(v -> { if (needsRecreate || getBridge()==null) { recreate(); return; } failed = false; pageStarted(lastGet); getBridge().getWebView().loadUrl(lastGet); });
        recovery.addView(retry);
        Button close = new Button(this); close.setText("Close app"); close.setMinHeight(dp(48)); close.setOnClickListener(v -> finish());
        recovery.addView(close);
        addContentView(recovery, new android.view.ViewGroup.LayoutParams(-1, -1));
        recovery.setVisibility(View.GONE);
    }

    public void pageStarted(String url) {
        currentDocument = url;
        if (NavigationPolicy.isApplication(url)) lastGet = NavigationPolicy.canonical(url);
        failed = false; loaded = false; navigationVersion++; checkingReadiness=false;
        timer.removeCallbacks(readinessProbe);
        timer.removeCallbacks(timeout); timer.postDelayed(timeout, 25000);
        if (!loaded && recovery != null) {
            connectionMessage.setText("Opening your secure account…"); retry.setVisibility(View.GONE); recovery.setVisibility(View.VISIBLE);
        }
    }

    public boolean isTrustedApplicationOrigin() { return NavigationPolicy.isApplication(currentDocument); }

    public void inspectPageReadiness() {
        if (failed || loaded) return;
        timer.removeCallbacks(readinessProbe); timer.post(readinessProbe);
    }

    private void checkPageReadiness(int version) {
        if (failed || loaded || checkingReadiness || getBridge()==null || version!=navigationVersion) return;
        checkingReadiness=true;
        String check="(()=>{const b=document.body;if(!b||document.readyState==='loading'||!window.VoxelNativeApp)return false;const visible=n=>{if(!n)return false;const r=n.getBoundingClientRect(),s=getComputedStyle(n);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity)!==0};const loader=document.getElementById('vvGlobalBrandLoader');if(loader?.classList.contains('is-visible'))return false;if(document.getElementById('staffHomeStatus')&&!window.VoxelStaffHome?.state&&document.getElementById('staffHomeError')?.hidden!==false)return false;const login=document.getElementById('loginForm');if(login&&document.getElementById('loginButton')?.disabled)return false;return b.innerText.trim().length>12&&[...document.querySelectorAll('h1,h2,main,form,[role=alert]')].some(visible)})()";
        getBridge().getWebView().evaluateJavascript(check,result->{
            if(version!=navigationVersion)return;
            checkingReadiness=false;
            if("true".equals(result))pageReady();else if(!failed)timer.postDelayed(readinessProbe,300);
        });
    }

    public void rendererFailed() {
        needsRecreate=true;
        showConnectionError("Android WebView stopped. Retry to restart this screen securely. Check pending actions before submitting again.");
    }

    public void pageReady() {
        timer.removeCallbacks(timeout);timer.removeCallbacks(readinessProbe);
        if (failed) return;
        loaded = true;
        if (recovery != null) recovery.setVisibility(View.GONE);
    }

    public void showConnectionError(String message) {
        runOnUiThread(() -> {
            failed = true; timer.removeCallbacks(timeout);timer.removeCallbacks(readinessProbe);
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
