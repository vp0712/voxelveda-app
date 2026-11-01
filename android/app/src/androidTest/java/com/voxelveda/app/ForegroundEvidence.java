package com.voxelveda.app;

import android.content.Context;
import android.content.pm.PackageInfo;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiSelector;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import static org.junit.Assert.*;

/** Instrumentation-only observations: no URL queries, credentials or raw dumpsys output. */
final class ForegroundEvidence {
    private final UiDevice device;
    private final File directory;
    private final String test;
    private final String suffix;
    private final JSONObject nativeIdentity;
    private int sequence;

    ForegroundEvidence(UiDevice device, File directory, Context context, String test, String upgrade) throws Exception {
        this.device = device;
        this.directory = directory;
        this.test = test;
        this.suffix = test + "-" + upgrade;
        assertTrue("Instrumentation evidence suffix is controlled", suffix.matches("[A-Za-z0-9_-]{1,160}"));
        PackageInfo installed = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
        nativeIdentity = new JSONObject();
        nativeIdentity.put("packageId", context.getPackageName());
        nativeIdentity.put("versionName", installed.versionName);
        nativeIdentity.put("versionCode", installed.getLongVersionCode());
        nativeIdentity.put("sourceCommit", BuildConfig.SOURCE_COMMIT);
        nativeIdentity.put("buildType", BuildConfig.BUILD_TYPE);
        nativeIdentity.put("signingScope", "Disposable verification fixture; not Play App Signing");
    }

    private String resumedActivity() throws Exception {
        String dump = device.executeShellCommand("dumpsys activity activities");
        Pattern component = Pattern.compile("([A-Za-z][A-Za-z0-9_.$]*/[A-Za-z0-9_.$]+)");
        for (String key : new String[]{"topResumedActivity", "mResumedActivity"}) {
            for (String line : dump.split("\\n")) {
                if (!line.contains(key)) continue;
                Matcher found = component.matcher(line);
                if (found.find()) return found.group(1);
            }
        }
        return "UNAVAILABLE";
    }

    private boolean browserChromeVisible() {
        return device.findObject(new UiSelector().resourceIdMatches(
            "(?:com\\.android\\.(?:chrome|browser)|org\\.chromium\\.[A-Za-z0-9_.]+|org\\.mozilla\\.[A-Za-z0-9_.]+|com\\.chrome\\.[A-Za-z0-9_.]+):id/(?:url_bar|location_bar|custom_tabs_toolbar|custom_tabs_close_button|mozac_browser_toolbar_url_view)"
        )).exists();
    }

    JSONObject capture(String stage, JSONObject safeUrl, long externalViews, String expectedActivity, String exception) throws Exception {
        assertTrue("Only bounded fixture stage identifiers become filenames", stage.matches("[a-z0-9-]{1,90}"));
        device.waitForIdle(1000);
        String foreground = device.getCurrentPackageName();
        String resumed = resumedActivity();
        String ownPackage = nativeIdentity.getString("packageId");
        if (exception == null) {
            long deadline = System.currentTimeMillis() + 8000;
            while (System.currentTimeMillis() < deadline &&
                (!ownPackage.equals(foreground) || !matchesActivity(resumed, ownPackage, expectedActivity))) {
                Thread.sleep(100);
                foreground = device.getCurrentPackageName();
                resumed = resumedActivity();
            }
        }
        String prefix = "foreground-" + suffix + "-" + String.format(java.util.Locale.ROOT, "%02d", ++sequence) + "-" + stage;
        String screenshot = prefix + ".png", hierarchy = prefix + ".xml";
        boolean screenshotWritten = device.takeScreenshot(new File(directory, screenshot));
        boolean hierarchyWritten = false;
        try { device.dumpWindowHierarchy(new File(directory, hierarchy)); hierarchyWritten = true; } catch (Exception ignored) {}
        boolean browserChrome = browserChromeVisible();
        JSONObject row = new JSONObject();
        row.put("schemaVersion", 1); row.put("fixtureOnly", true); row.put("physicalDevice", false);
        row.put("test", test); row.put("stage", stage); row.put("timestamp", new java.util.Date().toInstant().toString());
        row.put("foregroundPackage", foreground == null ? JSONObject.NULL : foreground);
        row.put("resumedActivity", resumed); row.put("safeUrl", safeUrl); row.put("native", nativeIdentity);
        row.put("externalViewIntentCount", externalViews); row.put("externalViewIntentsStubbed", false);
        row.put("browserChromeVisible", browserChrome); row.put("expectedNativeActivity", expectedActivity);
        row.put("flowKind", exception != null ? "explicit-os-action" : "PdfActivity".equals(expectedActivity) ? "document" : "normal");
        row.put("screenshot", screenshot); row.put("screenshotWritten", screenshotWritten);
        row.put("uiHierarchy", hierarchy); row.put("uiHierarchyWritten", hierarchyWritten);
        row.put("scope", "Installed synthetic WebView fixture; native foreground and safe URL observation, not a production account or Play release");
        if (exception != null) row.put("explicitOsAction", exception);
        String kind = exception != null ? "os-actions-" : "PdfActivity".equals(expectedActivity) ? "document-" : "foreground-";
        File log = new File(directory, kind + suffix + ".jsonl");
        try (FileOutputStream out = new FileOutputStream(log, true)) {
            out.write((row.toString() + "\n").getBytes(StandardCharsets.UTF_8));
        }
        assertTrue("Foreground screenshot persisted for " + stage, screenshotWritten);
        assertTrue("Foreground UI hierarchy persisted for " + stage, hierarchyWritten);
        assertFalse("Normal and explicit OS actions never display a browser/custom-tab toolbar at " + stage, browserChrome);
        if (exception == null) {
            assertEquals("The actual foreground package remains Voxel Veda at " + stage, ownPackage, foreground);
            assertTrue("The resumed native activity is " + expectedActivity + " at " + stage + ": " + resumed, matchesActivity(resumed, ownPackage, expectedActivity));
            assertEquals("The displayed WebView remains on the authorised origin at " + stage, NavigationPolicy.ORIGIN, safeUrl.getString("origin"));
            assertEquals("No external browser request was suppressed or emitted at " + stage, 0, externalViews);
        } else if ("CAMERA_PERMISSION".equals(exception)) {
            assertTrue("Only the explicit native permission prompt may take focus", "com.android.permissioncontroller".equals(foreground) || "com.google.android.permissioncontroller".equals(foreground));
        } else if ("PDF_SAVE_PICKER".equals(exception)) {
            assertTrue("Only the explicit native PDF destination picker may take focus", "com.android.documentsui".equals(foreground) || "com.google.android.documentsui".equals(foreground));
        } else fail("Unknown OS exception: " + exception);
        return row;
    }

    private static boolean matchesActivity(String component, String packageId, String activity) {
        return (packageId + "/." + activity).equals(component) || (packageId + "/" + packageId + "." + activity).equals(component);
    }
}
