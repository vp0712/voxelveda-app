package com.voxelveda.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.Settings;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "VoxelVedaApp")
public class VoxelVedaAppPlugin extends Plugin {
    private File pendingPdf;

    private boolean authorised(PluginCall call) {
        if (getActivity() instanceof MainActivity && ((MainActivity) getActivity()).isTrustedApplicationOrigin()) return true;
        call.reject("This action requires the secure Voxel Veda application."); return false;
    }

    @PluginMethod public void getAppInfo(PluginCall call) {
        if (!authorised(call)) return;
        JSObject result = new JSObject();
        result.put("packageId", getContext().getPackageName()); result.put("versionName", BuildConfig.VERSION_NAME);
        result.put("versionCode", BuildConfig.VERSION_CODE); result.put("sourceCommit", BuildConfig.SOURCE_COMMIT);
        result.put("buildType", BuildConfig.BUILD_TYPE); result.put("platform", "Android");
        call.resolve(result);
    }

    @PluginMethod public void openCameraSettings(PluginCall call) {
        if (!authorised(call)) return;
        getActivity().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName())));
        call.resolve();
    }

    @PluginMethod public void setAppearance(PluginCall call) {
        if (!authorised(call)) return;
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        getActivity().runOnUiThread(() -> {
            android.view.Window window = getActivity().getWindow();
            int background = Color.parseColor(dark ? "#101a2a" : "#f7f8fa");
            window.setStatusBarColor(background); window.setNavigationBarColor(background);
            window.getDecorView().setBackgroundColor(background);
            WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(window, window.getDecorView());
            controller.setAppearanceLightStatusBars(!dark); controller.setAppearanceLightNavigationBars(!dark);
            call.resolve();
        });
    }

    static String safeFilename(String name) throws IOException {
        if (name == null || !name.matches("[A-Za-z0-9][A-Za-z0-9._ -]{0,179}\\.pdf")) throw new IOException("The PDF filename is invalid.");
        return name;
    }

    private File verifiedPdf(PluginCall call) throws IOException {
        safeFilename(call.getString("filename"));
        String encoded = call.getString("base64", "");
        if (encoded.length() < 140 || encoded.length() > 28 * 1024 * 1024) throw new IOException("The PDF is empty or exceeds the supported size.");
        byte[] bytes;
        try { bytes = Base64.decode(encoded, Base64.DEFAULT); } catch (IllegalArgumentException error) { throw new IOException("Invalid PDF data."); }
        if (bytes.length < 100 || !new String(bytes, 0, 5, StandardCharsets.US_ASCII).equals("%PDF-")) throw new IOException("This response is not a PDF.");
        File file = File.createTempFile("vv-document-", ".pdf", getContext().getCacheDir());
        try {
            try (FileOutputStream stream = new FileOutputStream(file)) { stream.write(bytes); }
            try (ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY); PdfRenderer renderer = new PdfRenderer(descriptor)) {
                if (renderer.getPageCount() < 1) throw new IOException("The PDF contains no readable pages.");
            }
            return file;
        } catch (Exception error) { file.delete(); throw new IOException("The PDF could not be validated. No file was saved."); }
    }

    @PluginMethod public void presentPdf(PluginCall call) {
        if (!authorised(call)) return;
        try {
            File file = verifiedPdf(call);
            getActivity().startActivity(new Intent(getContext(), PdfActivity.class).putExtra("file", file.getName()).putExtra("filename", call.getString("filename")));
            call.resolve();
        } catch (Exception error) { call.reject(error.getMessage()); }
    }

    @PluginMethod public void savePdf(PluginCall call) {
        if (!authorised(call)) return;
        if (pendingPdf != null) { call.reject("A PDF save is already open. Finish or cancel it first."); return; }
        try {
            pendingPdf = verifiedPdf(call);
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/pdf").putExtra(Intent.EXTRA_TITLE, safeFilename(call.getString("filename")));
            startActivityForResult(call, intent, "pdfSaveResult");
        } catch (Exception error) { if (pendingPdf != null) pendingPdf.delete(); pendingPdf = null; call.reject(error.getMessage()); }
    }

    @ActivityCallback private void pdfSaveResult(PluginCall call, ActivityResult result) {
        File file = pendingPdf; pendingPdf = null;
        if (file == null || call == null) return;
        try {
            if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
                JSObject cancelled = new JSObject(); cancelled.put("saved", false); call.resolve(cancelled); return;
            }
            try (InputStream source = new FileInputStream(file); OutputStream destination = getContext().getContentResolver().openOutputStream(result.getData().getData(), "wt")) {
                if (destination == null) throw new IOException("The selected destination could not be opened.");
                byte[] block = new byte[16384]; int count;
                while ((count = source.read(block)) != -1) destination.write(block, 0, count);
                destination.flush();
            }
            JSObject saved = new JSObject(); saved.put("saved", true); call.resolve(saved);
        } catch (Exception error) { call.reject("The PDF was not saved. Choose a writable destination and try again."); }
        finally { file.delete(); }
    }
}
