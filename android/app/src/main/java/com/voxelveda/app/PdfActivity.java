package com.voxelveda.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.*;
import android.graphics.pdf.PdfRenderer;
import android.os.*;
import android.view.Gravity;
import android.widget.*;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import java.io.*;

/** Internal, non-exported read-only viewer. Its preview and save share one validated file. */
public class PdfActivity extends AppCompatActivity {
    private File file;
    private String filename;
    private ParcelFileDescriptor descriptor;
    private PdfRenderer document;
    private ImageView image;
    private TextView status;
    private Button previous, next;
    private int page;
    private float zoom = 1;
    private Bitmap bitmap;
    private final ActivityResultLauncher<Intent> save = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) return;
        try (InputStream input = new FileInputStream(file); OutputStream output = getContentResolver().openOutputStream(result.getData().getData(), "wt")) {
            if (output == null) throw new IOException();
            byte[] bytes = new byte[16384]; int count;
            while ((count = input.read(bytes)) != -1) output.write(bytes, 0, count);
            output.flush(); status.setText("PDF saved");
        } catch (Exception error) { status.setText("PDF was not saved. Choose another destination and retry."); }
    });

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); boolean dark=(getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK)==android.content.res.Configuration.UI_MODE_NIGHT_YES; root.setBackgroundColor(Color.parseColor(dark?"#101a2a":"#f7f8fa"));
        LinearLayout toolbar = new LinearLayout(this); toolbar.setGravity(Gravity.CENTER_VERTICAL);
        Button back = button("Back", () -> finish()); toolbar.addView(back);
        Button download = button("Save PDF", () -> save.launch(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/pdf").putExtra(Intent.EXTRA_TITLE, filename))); toolbar.addView(download);
        root.addView(toolbar); status = new TextView(this); status.setTextColor(Color.parseColor(dark?"#eaf0fa":"#142641")); status.setPadding(16,8,16,8); root.addView(status);
        LinearLayout controls = new LinearLayout(this);
        previous = button("Previous", () -> { page--; render(); }); next = button("Next", () -> { page++; render(); });
        controls.addView(previous,new LinearLayout.LayoutParams(0,-2,1)); controls.addView(next,new LinearLayout.LayoutParams(0,-2,1)); root.addView(controls);
        LinearLayout zoomControls=new LinearLayout(this);
        zoomControls.addView(button("−", () -> { zoom = Math.max(.5f, zoom-.25f); render(); }),new LinearLayout.LayoutParams(0,-2,1)); zoomControls.addView(button("+", () -> { zoom = Math.min(3, zoom+.25f); render(); }),new LinearLayout.LayoutParams(0,-2,1)); zoomControls.addView(button("Fit", () -> { zoom=1; render(); }),new LinearLayout.LayoutParams(0,-2,1)); root.addView(zoomControls);
        ScrollView scroller = new ScrollView(this); HorizontalScrollView horizontal = new HorizontalScrollView(this); image = new ImageView(this); image.setAdjustViewBounds(true); image.setContentDescription("Invoice or document PDF page"); horizontal.addView(image); scroller.addView(horizontal); root.addView(scroller,new LinearLayout.LayoutParams(-1,0,1)); setContentView(root);
        ViewCompat.setOnApplyWindowInsetsListener(root,(view,insets)->{androidx.core.graphics.Insets bars=insets.getInsets(WindowInsetsCompat.Type.systemBars()|WindowInsetsCompat.Type.displayCutout());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);return insets;});
        try {
            filename = VoxelVedaAppPlugin.safeFilename(getIntent().getStringExtra("filename"));
            String name = getIntent().getStringExtra("file");
            if (name == null || !name.matches("vv-document-[A-Za-z0-9-]+\\.pdf")) throw new IOException();
            file = new File(getCacheDir(), name);
            descriptor = ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY); document = new PdfRenderer(descriptor);
            if (document.getPageCount()<1) throw new IOException();
            image.post(this::render);
        } catch (Exception error) { status.setText("This PDF could not be opened. Return to the record and retry."); download.setEnabled(false); controls.setVisibility(android.view.View.GONE); zoomControls.setVisibility(android.view.View.GONE); }
    }
    private Button button(String label,Runnable action) { Button button=new Button(this);button.setText(label);button.setMinWidth(0);button.setMinHeight(Math.round(48*getResources().getDisplayMetrics().density));button.setOnClickListener(v->action.run());return button; }
    private void render() {
        if (document==null) return;
        try (PdfRenderer.Page source=document.openPage(page)) {
            float scale=(getResources().getDisplayMetrics().widthPixels-24f)/source.getWidth()*zoom;
            float maxScale=(float)Math.sqrt(8_000_000d/(source.getWidth()*(double)source.getHeight())); scale=Math.min(scale,maxScale);
            Bitmap nextBitmap=Bitmap.createBitmap(Math.max(1,Math.round(source.getWidth()*scale)),Math.max(1,Math.round(source.getHeight()*scale)),Bitmap.Config.ARGB_8888);nextBitmap.eraseColor(Color.WHITE);Matrix matrix=new Matrix();matrix.setScale(scale,scale);source.render(nextBitmap,null,matrix,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);image.setImageBitmap(nextBitmap);if(bitmap!=null)bitmap.recycle();bitmap=nextBitmap;
            status.setText(filename+" · Page "+(page+1)+" of "+document.getPageCount());previous.setEnabled(page>0);next.setEnabled(page+1<document.getPageCount());
        } catch(Exception error){status.setText("This page could not be displayed. Use Back to return to the record.");}
    }
    @Override protected void onDestroy(){if(document!=null)document.close();if(descriptor!=null)try{descriptor.close();}catch(IOException ignored){}if(bitmap!=null)bitmap.recycle();if(file!=null&&!isChangingConfigurations())file.delete();super.onDestroy();}
}
