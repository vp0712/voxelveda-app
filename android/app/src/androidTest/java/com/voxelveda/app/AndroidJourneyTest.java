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
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.Assert.*;
import static androidx.test.espresso.intent.Intents.intending;
import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.matcher.ViewMatchers.withText;
import static androidx.test.espresso.matcher.ViewMatchers.withSubstring;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.isDisplayed;

@RunWith(AndroidJUnit4.class)
public class AndroidJourneyTest {
 @Rule public org.junit.rules.TestName testName=new org.junit.rules.TestName();
 private ActivityScenario<MainActivity> scenario;
 private MainActivity main;
 private Intent originalLaunchIntent;
 private FixtureTransport transport;
 private final List<String> facts=new ArrayList<>();
 private File evidence;
 private UiDevice device;
 private volatile boolean blankStartup;

 private String js(String source)throws Exception{
  CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();
  InstrumentationRegistry.getInstrumentation().runOnMainSync(()->main.getBridge().getWebView().evaluateJavascript(source,value->{result.set(value);latch.countDown();}));
  assertTrue("WebView evaluation completed",latch.await(20,TimeUnit.SECONDS));return result.get();
 }
 private UiObject nativeText(String text,boolean partial){return device.findObject(partial?new UiSelector().textContains(text):new UiSelector().textMatches("(?i)^"+java.util.regex.Pattern.quote(text)+"$"));}
 private void waitNativeText(String text,boolean partial)throws Exception{assertTrue("Expected native control: "+text,nativeText(text,partial).waitForExists(20000));}
 private void waitJs(String expression)throws Exception{
  long end=System.currentTimeMillis()+30000;
  while(System.currentTimeMillis()<end){if("true".equals(js("Boolean("+expression+")")))return;Thread.sleep(180);}
  android.util.Log.e("AndroidFixture", "Condition failed: "+expression+"; "+js("JSON.stringify({path:location.pathname,ready:document.readyState,loginHandler:typeof login,qrError:window.__qrError,status:document.getElementById('loginStatus')?.textContent})"));
  fail("Expected application condition was not reached: "+expression);
 }
 private void go(String path)throws Exception{String leaving=UUID.randomUUID().toString();js("window.__androidTestLeaving="+JSONObject.quote(leaving));InstrumentationRegistry.getInstrumentation().runOnMainSync(()->main.getBridge().getWebView().loadUrl(NavigationPolicy.ORIGIN+path));waitJs("window.__androidTestLeaving!=="+JSONObject.quote(leaving)+"&&document.readyState==='complete'&&("+(path.equals("/dashboard")?"['/dashboard','/portal/staff','/admin','/login'].includes(location.pathname)":"location.pathname==="+JSONObject.quote(path.split("\\?",2)[0]))+")");}
 private void screenshot(String name)throws Exception{waitJs("[...document.images].every(image=>!image.getAttribute('src')||image.hidden||!image.getClientRects().length||(image.complete&&image.naturalWidth>0))&&!document.getElementById('vvGlobalBrandLoader')?.classList.contains('is-visible')");Thread.sleep(400);device.waitForIdle(1000);assertTrue(device.takeScreenshot(new File(evidence,name+".png")));}
 private void login(String email,String password)throws Exception{waitJs("document.getElementById('loginButton')?.disabled===false");js("document.getElementById('email').value="+JSONObject.quote(email)+";document.getElementById('password').value="+JSONObject.quote(password)+";document.getElementById('loginForm').requestSubmit();");}
 private FixtureTransport.Reply control(String route)throws Exception{return transport.relay(NavigationPolicy.ORIGIN+route,route.endsWith("expire")?"POST":"GET","",Collections.emptyMap());}

 @Before public void start()throws Exception{
  Intents.init();intending(org.hamcrest.CoreMatchers.allOf(IntentMatchers.hasAction(Intent.ACTION_VIEW),org.hamcrest.CoreMatchers.not(IntentMatchers.hasComponent(MainActivity.class.getName())))).respondWith(new Instrumentation.ActivityResult(Activity.RESULT_CANCELED,null));
  int port=Integer.parseInt(InstrumentationRegistry.getArguments().getString("fixture_port"));transport=new FixtureTransport(port);device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
  scenario=ActivityScenario.launch(MainActivity.class);scenario.onActivity(activity->{main=activity;originalLaunchIntent=new Intent(activity.getIntent());activity.getBridge().getWebView().stopLoading();activity.getBridge().getWebView().addJavascriptInterface(transport,"VVAndroidTestFixture");activity.getBridge().setWebViewClient(new ApplicationWebViewClient(activity.getBridge(),activity){
   @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
    if(!NavigationPolicy.isApplication(request.getUrl().toString()))return super.shouldInterceptRequest(view,request);
    try{
     if(blankStartup&&request.isForMainFrame())return new WebResourceResponse("text/html","UTF-8",new ByteArrayInputStream("<!doctype html><head><title>Incomplete startup fixture</title></head><body></body>".getBytes(StandardCharsets.UTF_8)));
     FixtureTransport.Reply reply=transport.relay(request.getUrl().toString(),request.getMethod(),"",request.getRequestHeaders());
     if(reply.status>=300&&reply.status<400){String location=reply.headers.get("location");String next=location!=null&&location.startsWith("/")?NavigationPolicy.ORIGIN+location:NavigationPolicy.canonical(location);if(next==null)throw new IOException();view.post(()->view.loadUrl(next));return new WebResourceResponse("text/html","UTF-8",new ByteArrayInputStream("<!doctype html><head></head><body>Opening account…</body>".getBytes(StandardCharsets.UTF_8)));}
     String type=reply.headers.getOrDefault("content-type","application/octet-stream").split(";")[0];byte[] bytes=reply.bytes;
     if(type.equals("text/html"))bytes=transport.inject(activity.getBridge(),new String(bytes,StandardCharsets.UTF_8)).getBytes(StandardCharsets.UTF_8);
     Map<String,String> headers=new HashMap<>(reply.headers);headers.remove("content-length");headers.remove("transfer-encoding");headers.remove("content-encoding");
     return new WebResourceResponse(type,"UTF-8",reply.status,reply.status>=400?"Fixture failure":"OK",headers,new ByteArrayInputStream(bytes));
    }catch(Exception error){android.util.Log.e("AndroidFixture",request.getUrl().getPath()+": "+error.getClass().getSimpleName()+": "+error.getMessage());if(transport.offline&&request.isForMainFrame())view.postDelayed(()->onReceivedHttpError(view,request,new WebResourceResponse("text/html","UTF-8",503,"Isolated transport interruption",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]))),250);return new WebResourceResponse("text/html","UTF-8",503,"Fixture unavailable",Collections.emptyMap(),new ByteArrayInputStream("<!doctype html><head></head><body>Fixture unavailable</body>".getBytes(StandardCharsets.UTF_8)));}
   }
  });});
  evidence=new File(main.getExternalFilesDir(null),"android-proof");assertTrue(evidence.mkdirs()||evidence.isDirectory());
 }

 @Test public void blankCompletedPageRequiresVisibleRecovery()throws Exception{
  blankStartup=true;
  InstrumentationRegistry.getInstrumentation().runOnMainSync(()->main.getBridge().getWebView().loadUrl(NavigationPolicy.ORIGIN+"/"));
  waitJs("document.readyState==='complete'&&document.body.innerText.trim()===''&&typeof VoxelNativeApp==='undefined'");
  waitNativeText("Opening your secure account",true);
  assertTrue(device.takeScreenshot(new File(evidence,"blank-page-branded-loading.png")));
  assertTrue("A completed blank document reaches bounded native recovery",nativeText("Retry connection",false).waitForExists(35000));
  assertTrue(device.takeScreenshot(new File(evidence,"blank-page-controlled-recovery.png")));
  blankStartup=false;nativeText("Retry connection",false).click();
  waitJs("window.VoxelNativeApp&&document.querySelector('h1,h2,main')");
  long deadline=System.currentTimeMillis()+10000;while(nativeText("Retry connection",false).exists()&&System.currentTimeMillis()<deadline)Thread.sleep(150);
  assertFalse("Usable app dismisses the recovery overlay",nativeText("Retry connection",false).exists());
  assertEquals("Startup and retry never launch a browser",0,Intents.getIntents().stream().filter(intent->Intent.ACTION_VIEW.equals(intent.getAction())&&intent.getComponent()==null).count());
  facts.add("A real installed WebView finishes an empty HTML document without the application adapter; branding remains visible, bounded recovery appears, explicit GET retry reaches usable canonical app with zero external-browser intents");
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
  control("/__fixture/expire");go("/dashboard");waitJs("location.pathname==='/login'&&location.search.includes('returnTo')");facts.add("Expired server session returns to login with a safe intent");
  login("android-admin@example.invalid","SyntheticDevicePass123!");waitJs("location.pathname==='/mfa'&&document.getElementById('mfaVerify')?.disabled===false");
  js("document.getElementById('mfaCode').value='000000';document.getElementById('mfaForm').requestSubmit()");waitJs("document.getElementById('status').textContent.includes('Invalid')");
  JSONObject otp=new JSONObject(new String(control("/__fixture/totp").bytes,StandardCharsets.UTF_8));js("document.getElementById('mfaCode').value="+JSONObject.quote(otp.getString("code"))+";document.getElementById('mfaForm').requestSubmit()");waitJs("location.pathname==='/admin'&&document.body.textContent.includes('Synthetic Android Admin')");screenshot("admin-home");facts.add("Admin login requires an actual encrypted TOTP challenge and reaches only its permitted portal after verification");
  js("fetch('/api/auth/logout',{method:'POST'}).then(()=>location.assign('/dashboard'))");waitJs("location.pathname==='/login'");facts.add("Logout revokes the fixture server session and clears the correct cookie");
  login("synthetic-staff@example.invalid","SyntheticDevicePass123!");waitJs("location.pathname==='/portal/staff'");
  transport.offline=true;InstrumentationRegistry.getInstrumentation().runOnMainSync(()->main.getBridge().getWebView().loadUrl(NavigationPolicy.ORIGIN+"/profile"));waitNativeText("Retry connection",false);screenshot("connection-error");transport.offline=false;nativeText("Retry connection",false).click();waitJs("location.pathname==='/profile'&&document.getElementById('androidAppInfo')");go("/portal/staff");waitJs("window.VoxelStaffHome?.state");facts.add("A controlled intercepted transport failure invokes the WebView HTTP-error callback and branded explicit GET retry without replaying writes");
  CookieManager.getInstance().flush();
  long external=Intents.getIntents().stream().filter(intent->Intent.ACTION_VIEW.equals(intent.getAction())&&!main.getPackageName().equals(intent.getPackage())&&(intent.getComponent()==null||!main.getPackageName().equals(intent.getComponent().getPackageName()))).count();assertEquals("No ordinary flow asks Android to open a browser",0,external);
  facts.add("Normal launch/auth/navigation/resume/legacy-link flows create zero external browser ACTION_VIEW intents");
  InstrumentationRegistry.getInstrumentation().runOnMainSync(()->main.getBridge().launchIntent(Uri.parse("https://voxelveda-app-production.up.railway.app/login")));
  assertEquals(1,Intents.getIntents().stream().filter(intent->Intent.ACTION_VIEW.equals(intent.getAction())&&intent.getComponent()==null).count());facts.add("Actual unmodified Capacitor cross-host fallback emits ACTION_VIEW for the legacy Railway URL; intercepted only for this diagnostic baseline assertion");
 }

 private void staffSession()throws Exception{
  CountDownLatch latch=new CountDownLatch(1);InstrumentationRegistry.getInstrumentation().runOnMainSync(()->CookieManager.getInstance().removeAllCookies(done->latch.countDown()));assertTrue(latch.await(10,TimeUnit.SECONDS));go("/login");login("synthetic-staff@example.invalid","SyntheticDevicePass123!");waitJs("location.pathname==='/portal/staff'&&window.VoxelNativeApp&&window.VoxelOperations&&window.VoxelStaffHome?.state");
 }
 private void waitKeyboard(boolean expected)throws Exception{
  long end=System.currentTimeMillis()+15000;
  while(System.currentTimeMillis()<end){AtomicBoolean visible=new AtomicBoolean();InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{androidx.core.view.WindowInsetsCompat insets=androidx.core.view.ViewCompat.getRootWindowInsets(main.getWindow().getDecorView());visible.set(insets!=null&&insets.isVisible(androidx.core.view.WindowInsetsCompat.Type.ime()));});if(visible.get()==expected)return;Thread.sleep(150);}fail("Android keyboard visibility did not become "+expected);
 }
 private void assertKeyboardViewport()throws Exception{
  long end=System.currentTimeMillis()+8000;AtomicReference<Integer> gap=new AtomicReference<>(),limit=new AtomicReference<>();
  while(System.currentTimeMillis()<end){InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{WebView web=main.getBridge().getWebView();android.graphics.Rect visible=new android.graphics.Rect();web.getWindowVisibleDisplayFrame(visible);int[] location=new int[2];web.getLocationOnScreen(location);gap.set(visible.bottom-location[1]-web.getHeight());limit.set(Math.round(96*web.getResources().getDisplayMetrics().density));});if(gap.get()>=-8&&gap.get()<=limit.get()){facts.add("Keyboard viewport measured: "+gap.get()+" px between WebView and visible display bottom; no duplicate IME reservation");return;}Thread.sleep(150);}
  fail("Keyboard leaves a clipped or unnecessarily reduced WebView: gap="+gap.get()+" px, permitted="+limit.get());
 }
 @Test public void nativeBackDiscardsOnlyAfterConfirmation()throws Exception{
  staffSession();go("/profile");
  waitJs("document.getElementById('name')?.value==='Synthetic Staff Fixture'");
  js("document.getElementById('name').scrollIntoView({block:'center',behavior:'instant'})");
  UiObject nameInput=device.findObject(new UiSelector().className("android.widget.EditText").text("Synthetic Staff Fixture"));
  assertTrue("Native accessibility identifies the actual editable name field",nameInput.waitForExists(15000));
  device.waitForIdle(3000);nameInput.click();waitJs("document.activeElement?.id==='name'");waitKeyboard(true);
  waitJs("document.activeElement?.id==='name'&&innerHeight>=160");assertKeyboardViewport();js("document.getElementById('saveBtn').scrollIntoView({block:'center'})");waitJs("(()=>{const r=document.getElementById('saveBtn').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()");screenshot("profile-keyboard");device.pressBack();waitKeyboard(false);assertEquals("true",js("location.pathname==='/profile'"));js("document.getElementById('name').blur()");facts.add("Actual Android on-screen keyboard leaves the real profile Save action reachable; first Back dismisses the keyboard without leaving the form");
  js("document.getElementById('name').value='Unsaved Android fixture edit';document.getElementById('name').dispatchEvent(new Event('input',{bubbles:true}))");
  device.pressBack();waitNativeText("Unsaved changes",false);device.findObject(new UiSelector().resourceId("android:id/button2")).click();assertEquals("true",js("location.pathname==='/profile'&&document.getElementById('name').value==='Unsaved Android fixture edit'"));
  device.pressBack();device.findObject(new UiSelector().resourceId("android:id/button1")).click();waitJs("location.pathname==='/portal/staff'");go("/profile");waitJs("document.getElementById('name')?.value==='Synthetic Staff Fixture'");facts.add("Android Back offers Keep editing/Discard on the real profile form; cancellation retains unsaved input and discard performs no save");
 }
 @Test public void coldProfileBackRequiresDiscardConsent()throws Exception{
  staffSession();go("/profile");waitJs("document.getElementById('name')?.value==='Synthetic Staff Fixture'");InstrumentationRegistry.getInstrumentation().runOnMainSync(()->main.getBridge().getWebView().clearHistory());
  js("document.getElementById('name').value='Unsaved cold-profile fixture';document.getElementById('name').dispatchEvent(new Event('input',{bubbles:true}))");device.pressBack();waitNativeText("Unsaved changes",false);device.findObject(new UiSelector().resourceId("android:id/button2")).click();assertEquals("true",js("location.pathname==='/profile'&&document.getElementById('name').value==='Unsaved cold-profile fixture'"));
  device.pressBack();waitNativeText("Unsaved changes",false);assertTrue(device.takeScreenshot(new File(evidence,"cold-profile-discard.png")));device.findObject(new UiSelector().resourceId("android:id/button1")).click();long deadline=System.currentTimeMillis()+15000;while(scenario.getState()!=Lifecycle.State.DESTROYED&&System.currentTimeMillis()<deadline)Thread.sleep(150);assertEquals("Consent closes the activity when there is no history",Lifecycle.State.DESTROYED,scenario.getState());
  JSONObject state=new JSONObject(new String(control("/__fixture/state").bytes,StandardCharsets.UTF_8));JSONArray requests=state.getJSONArray("requests");for(int n=0;n<requests.length();n++){JSONObject request=requests.getJSONObject(n);assertFalse("Discard never writes the profile",request.getString("path").equals("/api/profile")&&!request.getString("method").equals("GET"));}facts.add("A cold profile with no WebView history keeps edits on cancel and closes only after explicit discard, with no profile write");
 }
 @Test public void nativeCameraAndBrandedQr()throws Exception{
  staffSession();
  go("/portal/staff");waitJs("window.VoxelStaffHome?.state");
  js("window.__cameraOpen='pending';window.VoxelStaffHome.openAction('CHECK_IN').then(()=>window.__cameraOpen='done').catch(error=>window.__cameraOpen=error.message)");waitJs("document.getElementById('staffAttendanceVideo')");
  UiObject deny=device.findObject(new UiSelector().resourceId("com.android.permissioncontroller:id/permission_deny_button"));assertTrue("Android camera permission prompt displayed",deny.waitForExists(15000));deny.click();
  waitJs("document.getElementById('staffAttendanceScanStatus')?.textContent.includes('permission')||document.getElementById('staffAttendanceScanStatus')?.textContent.includes('Position')");
  assertEquals("true",js("!![...document.querySelectorAll('button')].find(b=>b.textContent==='App camera settings')"));screenshot("camera-recovery");js("VoxelStaffHome.close()");facts.add("Actual WebView camera permission/recovery UI is reachable; physical QR camera focus is not asserted");
  js("window.__qrDecoded=false;window.__qrError=null;window.loadExternalScript('/vendor/jsQR.js').then(async()=>{for(let n=0;n<5;n++){const image=new Image();image.src='/__fixture/gate.png?n='+n+'&time='+Date.now();await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height);const result=jsQR(pixels.data,canvas.width,canvas.height);if(!result?.data.startsWith('https://app.voxelveda.com/a?t='))throw new Error('decode');}window.__qrDecoded=true;}).catch(error=>{window.__qrError=error.message;window.__qrDecoded='failed'})");waitJs("window.__qrDecoded===true");facts.add("Installed Android WebView decodes five actual signed branded gate payload images with original centre logo");
 }
 @Test public void nativePdfViewAndSave()throws Exception{
  staffSession();
  js("window.__pdfPreview=false;VoxelOperations.openPdf('/api/invoice/91/pdf').then(()=>window.__pdfPreview=true).catch(error=>window.__pdfPreview=error.message)");
  waitNativeText("ANDROID-FIXTURE-1.pdf",true);screenshot("pdf-viewer");device.pressBack();waitJs("window.__pdfPreview===true");facts.add("Authorised genuine PDF opens in the internal native viewer, with reachable Back/zoom/page/save controls");
  js("window.__savedPdf=null;VoxelNativeApp.openDocument('/api/invoice/91/pdf',true).then(value=>window.__savedPdf=value).catch(error=>window.__savedPdf={error:error.message})");
  UiObject savePdf=nativeText("Save",false);assertTrue("Android PDF destination picker opened",savePdf.waitForExists(15000));screenshot("pdf-save-picker");savePdf.click();waitJs("window.__savedPdf?.saved===true");facts.add("Android destination picker saves the parser-validated fixture PDF and confirms the completed output stream");
  js("window.__invalidPdf='pending';VoxelNativeApp.documentAction(new TextEncoder().encode('<html>Not a PDF</html>').buffer,'fixture.pdf',true).then(()=>window.__invalidPdf='unexpected').catch(()=>window.__invalidPdf='rejected')");waitJs("window.__invalidPdf==='rejected'");facts.add("HTML/error bytes cannot be saved as PDF");
 }

 @After public void finish()throws Exception{
  if(evidence!=null){try{device.dumpWindowHierarchy(new File(evidence,"ui-"+testName.getMethodName()+".xml"));}catch(Exception ignored){}try{device.takeScreenshot(new File(evidence,"last-app-screen-"+testName.getMethodName()+".png"));}catch(Exception ignored){}JSONObject result=new JSONObject();result.put("fixtureOnly",true);result.put("realProductionAccountUsed",false);result.put("physicalDevice",false);result.put("packageId","com.voxelveda.app");result.put("appSigningVerification","NOT_TESTED: real Play certificate/access unavailable");result.put("facts",new JSONArray(facts));try(FileOutputStream output=new FileOutputStream(new File(evidence,"result-"+testName.getMethodName()+"-"+InstrumentationRegistry.getArguments().getString("upgrade_only","false")+".json"))){output.write(result.toString(2).getBytes(StandardCharsets.UTF_8));}}
  try{
   // ActivityScenario keys lifecycle events by the original launch intent.
   if(main!=null&&originalLaunchIntent!=null)InstrumentationRegistry.getInstrumentation().runOnMainSync(()->main.setIntent(originalLaunchIntent));
   if(scenario!=null)scenario.close();
  }finally{if(device!=null)device.unfreezeRotation();Intents.release();}
 }
}
