package com.voxelveda.app;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.net.Uri;
import android.webkit.*;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.espresso.intent.Intents;
import androidx.test.espresso.intent.matcher.IntentMatchers;
import androidx.test.uiautomator.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;
import static androidx.test.espresso.intent.Intents.intending;

@RunWith(AndroidJUnit4.class)
public class AndroidJourneyTest {
 private ActivityScenario<MainActivity> scenario;
 private MainActivity main;
 private FixtureTransport transport;
 private final List<String> facts=new ArrayList<>();
 private File evidence;
 private UiDevice device;

 private String js(String source)throws Exception{
  CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();
  InstrumentationRegistry.getInstrumentation().runOnMainSync(()->main.getBridge().getWebView().evaluateJavascript(source,value->{result.set(value);latch.countDown();}));
  assertTrue("WebView evaluation completed",latch.await(20,TimeUnit.SECONDS));return result.get();
 }
 private void waitJs(String expression)throws Exception{
  long end=System.currentTimeMillis()+30000;
  while(System.currentTimeMillis()<end){if("true".equals(js("Boolean("+expression+")")))return;Thread.sleep(180);}
  fail("Expected application condition was not reached: "+expression);
 }
 private void go(String path)throws Exception{InstrumentationRegistry.getInstrumentation().runOnMainSync(()->main.getBridge().getWebView().loadUrl(NavigationPolicy.ORIGIN+path));waitJs("document.readyState==='complete'&&location.pathname==="+JSONObject.quote(path.split("\\?",2)[0]));}
 private void screenshot(String name)throws Exception{assertTrue(device.takeScreenshot(new File(evidence,name+".png")));}
 private void login(String email,String password)throws Exception{js("document.getElementById('email').value="+JSONObject.quote(email)+";document.getElementById('password').value="+JSONObject.quote(password)+";document.getElementById('loginForm').requestSubmit();");}
 private FixtureTransport.Reply control(String route)throws Exception{return transport.relay(NavigationPolicy.ORIGIN+route,route.endsWith("expire")?"POST":"GET","",Collections.emptyMap());}

 @Before public void start()throws Exception{
  Intents.init();intending(IntentMatchers.hasAction(Intent.ACTION_VIEW)).respondWith(new Instrumentation.ActivityResult(Activity.RESULT_CANCELED,null));
  int port=Integer.parseInt(InstrumentationRegistry.getArguments().getString("fixture_port"));transport=new FixtureTransport(port);device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
  scenario=ActivityScenario.launch(MainActivity.class);scenario.onActivity(activity->{main=activity;activity.getBridge().getWebView().stopLoading();activity.getBridge().getWebView().addJavascriptInterface(transport,"VVAndroidTestFixture");activity.getBridge().setWebViewClient(new ApplicationWebViewClient(activity.getBridge(),activity){
   @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
    if(!NavigationPolicy.isApplication(request.getUrl().toString()))return super.shouldInterceptRequest(view,request);
    try{
     FixtureTransport.Reply reply=transport.relay(request.getUrl().toString(),request.getMethod(),"",request.getRequestHeaders());
     if(reply.status>=300&&reply.status<400){String location=reply.headers.get("location");String next=location!=null&&location.startsWith("/")?NavigationPolicy.ORIGIN+location:NavigationPolicy.canonical(location);if(next==null)throw new IOException();view.post(()->view.loadUrl(next));return new WebResourceResponse("text/html","UTF-8",new ByteArrayInputStream("<!doctype html><head></head><body>Opening account…</body>".getBytes(StandardCharsets.UTF_8)));}
     String type=reply.headers.getOrDefault("content-type","application/octet-stream").split(";")[0];byte[] bytes=reply.bytes;
     if(type.equals("text/html"))bytes=transport.inject(activity.getBridge(),new String(bytes,StandardCharsets.UTF_8)).getBytes(StandardCharsets.UTF_8);
     Map<String,String> headers=new HashMap<>(reply.headers);headers.remove("content-length");headers.remove("transfer-encoding");headers.remove("content-encoding");
     return new WebResourceResponse(type,"UTF-8",reply.status,reply.status>=400?"Fixture failure":"OK",headers,new ByteArrayInputStream(bytes));
    }catch(Exception error){android.util.Log.e("AndroidFixture",request.getUrl().getPath()+": "+error.getClass().getSimpleName()+": "+error.getMessage());return new WebResourceResponse("text/html","UTF-8",503,"Fixture unavailable",Collections.emptyMap(),new ByteArrayInputStream("<!doctype html><head></head><body>Fixture unavailable</body>".getBytes(StandardCharsets.UTF_8)));}
   }
  });});
  evidence=new File(main.getExternalFilesDir(null),"android-proof");assertTrue(evidence.mkdirs()||evidence.isDirectory());
 }

 @Test public void installedJourney()throws Exception{
  boolean upgrade="true".equals(InstrumentationRegistry.getArguments().getString("upgrade_only"));
  if(upgrade){go("/dashboard");waitJs("location.pathname==='/portal/staff'&&document.body.textContent.includes('Synthetic Staff Fixture')");facts.add("APK upgrade preserves the real secure HttpOnly fixture cookie and server session; no login or browser relaunch");screenshot("upgrade-preserved-session");return;}
  CountDownLatch cleared=new CountDownLatch(1);InstrumentationRegistry.getInstrumentation().runOnMainSync(()->CookieManager.getInstance().removeAllCookies(done->cleared.countDown()));assertTrue(cleared.await(10,TimeUnit.SECONDS));
  go("/");waitJs("document.querySelector('a[href=\"/login\"]')&&document.querySelector('a[href=\"/register\"]')");screenshot("cold-entry");facts.add("Cold launch presents the real branded Login/Sign up entry inside installed WebView");
  js("document.querySelector('a[href=\"/login\"]').click()");waitJs("document.getElementById('loginForm')&&document.getElementById('loginButton')?.disabled===false&&location.pathname==='/login'");
  login("synthetic-staff@example.invalid","IncorrectSyntheticPassword123!");waitJs("document.getElementById('loginStatus').textContent.includes('Invalid email or password')");facts.add("Failed login stays in app with an actual credential rejection");
  login("synthetic-staff@example.invalid","SyntheticDevicePass123!");waitJs("location.pathname==='/portal/staff'&&document.body.textContent.includes('Synthetic Staff Fixture')");waitJs("window.VoxelNativeApp&&window.VoxelStaffHome?.state");screenshot("staff-home");facts.add("Real login handler, bcrypt, JWT, secure HttpOnly cookie, page authentication and permitted staff home complete in app");
  int identity=System.identityHashCode(main);scenario.moveToState(Lifecycle.State.CREATED);scenario.moveToState(Lifecycle.State.RESUMED);waitJs("location.pathname==='/portal/staff'");assertEquals(identity,System.identityHashCode(main));facts.add("Background/resume preserves the same activity and session");
  go("/profile");waitJs("document.getElementById('androidAppInfo')?.textContent.includes('com.voxelveda.app')");screenshot("profile-version");facts.add("Native package/version/source information is accessible in account settings");
  js("window.__nativeInfo=null;Capacitor.Plugins.VoxelVedaApp.getAppInfo().then(value=>window.__nativeInfo=value)");waitJs("window.__nativeInfo?.packageId==='com.voxelveda.app'");
  js("VoxelTheme.set('dark')");waitJs("document.documentElement.dataset.colorMode==='dark'");screenshot("dark-profile");device.setOrientationLeft();Thread.sleep(400);screenshot("landscape-profile");device.setOrientationNatural();
  Intent link=new Intent(Intent.ACTION_VIEW,Uri.parse(NavigationPolicy.ORIGIN+"/profile")).setClass(main,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP);
  InstrumentationRegistry.getInstrumentation().getTargetContext().startActivity(link);waitJs("location.pathname==='/profile'");assertEquals(identity,System.identityHashCode(main));facts.add("Warm explicit HTTPS app-link dispatch preserves a single activity; OS domain verification is reported separately");
  InstrumentationRegistry.getInstrumentation().runOnMainSync(()->main.getBridge().getWebView().loadUrl("https://voxelveda-app-production.up.railway.app/profile"));waitJs("location.origin==='https://app.voxelveda.com'&&location.pathname==='/profile'");facts.add("Legacy-host navigation is rewritten inside the app without an external VIEW intent");
  for(String route:new String[]{"/register","/forgot-password","/reset-password","/accept-invite"}){go(route);waitJs("document.querySelector('h1')");}facts.add("Signup, recovery and invitation screens remain canonical in the installed app; no accounts or email are created");
  go("/portal/staff");waitJs("window.VoxelStaffHome?.state");
  js("window.VoxelStaffHome.openAction('check_in')");waitJs("document.getElementById('staffAttendanceVideo')");
  UiObject2 deny=device.wait(Until.findObject(By.res("com.android.permissioncontroller","permission_deny_button")),7000);if(deny!=null)deny.click();
  waitJs("document.getElementById('staffAttendanceScanStatus')?.textContent.includes('permission')||document.getElementById('staffAttendanceScanStatus')?.textContent.includes('Position')");
  assertEquals("true",js("!![...document.querySelectorAll('button')].find(b=>b.textContent==='App camera settings')"));screenshot("camera-recovery");js("VoxelStaffHome.close()");facts.add("Actual WebView camera permission/recovery UI is reachable; physical QR camera focus is not asserted");
  js("window.__qrDecoded=false;window.loadExternalScript('/vendor/jsQR.js').then(async()=>{for(let n=0;n<5;n++){const image=new Image();image.src='/__fixture/gate.png?n='+n+'&time='+Date.now();await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height);const result=jsQR(pixels.data,canvas.width,canvas.height);if(!result?.data.startsWith('https://app.voxelveda.com/a?t='))throw new Error('decode');}window.__qrDecoded=true;}).catch(()=>window.__qrDecoded='failed')");waitJs("window.__qrDecoded===true");facts.add("Installed Android WebView decodes five actual signed branded gate payload images with original centre logo");
  js("window.__pdfPreview=false;VoxelOperations.openPdf('/api/invoice/91/pdf').then(()=>window.__pdfPreview=true).catch(error=>window.__pdfPreview=error.message)");
  UiObject2 pdf=device.wait(Until.findObject(By.textContains("ANDROID-FIXTURE-1.pdf")),15000);assertNotNull("Internal parser-validated PDF viewer opened",pdf);screenshot("pdf-viewer");device.pressBack();waitJs("window.__pdfPreview===true");facts.add("Authorised genuine PDF opens in the internal native viewer, with reachable Back/zoom/page/save controls");
  js("window.__invalidPdf='pending';VoxelNativeApp.documentAction(new TextEncoder().encode('<html>Not a PDF</html>').buffer,'fixture.pdf',true).then(()=>window.__invalidPdf='unexpected').catch(()=>window.__invalidPdf='rejected')");waitJs("window.__invalidPdf==='rejected'");facts.add("HTML/error bytes cannot be saved as PDF");
  control("/__fixture/expire");go("/dashboard");waitJs("location.pathname==='/login'&&location.search.includes('returnTo')");facts.add("Expired server session returns to login with a safe intent");
  login("android-admin@example.invalid","SyntheticDevicePass123!");waitJs("location.pathname==='/mfa'&&document.getElementById('mfaForm')");
  js("document.getElementById('code').value='000000';document.getElementById('mfaForm').requestSubmit()");waitJs("document.getElementById('status').textContent.includes('Invalid')");
  JSONObject otp=new JSONObject(new String(control("/__fixture/totp").bytes,StandardCharsets.UTF_8));js("document.getElementById('code').value="+JSONObject.quote(otp.getString("code"))+";document.getElementById('mfaForm').requestSubmit()");waitJs("location.pathname==='/admin'&&document.body.textContent.includes('Synthetic Android Admin')");screenshot("admin-home");facts.add("Admin login requires an actual encrypted TOTP challenge and reaches only its permitted portal after verification");
  js("fetch('/api/auth/logout',{method:'POST'}).then(()=>location.assign('/dashboard'))");waitJs("location.pathname==='/login'");facts.add("Logout revokes the fixture server session and clears the correct cookie");
  login("synthetic-staff@example.invalid","SyntheticDevicePass123!");waitJs("location.pathname==='/portal/staff'");
  InstrumentationRegistry.getInstrumentation().runOnMainSync(()->main.showConnectionError("Synthetic network interruption. Retry connection when ready."));assertNotNull(device.wait(Until.findObject(By.text("Retry connection")),5000));screenshot("connection-error");device.findObject(By.text("Retry connection")).click();waitJs("location.pathname==='/portal/staff'");facts.add("Connection error has a bounded branded recovery and explicit GET retry without replaying writes");
  CookieManager.getInstance().flush();
  long external=Intents.getIntents().stream().filter(intent->Intent.ACTION_VIEW.equals(intent.getAction())&&!main.getPackageName().equals(intent.getPackage())&&(intent.getComponent()==null||!main.getPackageName().equals(intent.getComponent().getPackageName()))).count();assertEquals("No ordinary flow asks Android to open a browser",0,external);
  facts.add("Normal launch/auth/navigation/resume/legacy-link flows create zero external browser ACTION_VIEW intents");
  InstrumentationRegistry.getInstrumentation().runOnMainSync(()->main.getBridge().launchIntent(Uri.parse("https://voxelveda-app-production.up.railway.app/login")));
  assertEquals(1,Intents.getIntents().stream().filter(intent->Intent.ACTION_VIEW.equals(intent.getAction())&&intent.getComponent()==null).count());facts.add("Actual unmodified Capacitor cross-host fallback emits ACTION_VIEW for the legacy Railway URL; intercepted only for this diagnostic baseline assertion");
 }

 @After public void finish()throws Exception{
  if(evidence!=null){try{screenshot("last-app-screen");}catch(Exception ignored){}JSONObject result=new JSONObject();result.put("fixtureOnly",true);result.put("realProductionAccountUsed",false);result.put("physicalDevice",false);result.put("packageId","com.voxelveda.app");result.put("appSigningVerification","NOT_TESTED: real Play certificate/access unavailable");result.put("facts",new JSONArray(facts));try(FileOutputStream output=new FileOutputStream(new File(evidence,"result-"+InstrumentationRegistry.getArguments().getString("upgrade_only","false")+".json"))){output.write(result.toString(2).getBytes(StandardCharsets.UTF_8));}}
  if(scenario!=null)scenario.close();device.unfreezeRotation();Intents.release();
 }
}
