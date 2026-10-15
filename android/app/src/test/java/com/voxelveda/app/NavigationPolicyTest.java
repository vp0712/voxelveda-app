package com.voxelveda.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class NavigationPolicyTest {
 @Test public void onlyExactSecureAppOriginIsPrivileged(){
  assertTrue(NavigationPolicy.isApplication("https://app.voxelveda.com/login"));
  for(String url:new String[]{"http://app.voxelveda.com/login","https://app.voxelveda.com.evil.invalid","https://app.voxelveda.com@evil.invalid","https://evil@app.voxelveda.com/login","https://app.voxelveda.com:444/login","https://voxelveda-app-production.up.railway.app/login","javascript:alert(1)","file:///private/file","data:text/html,test","intent://app.voxelveda.com","https://app.voxelveda.com\\@evil.invalid"})assertFalse(url,NavigationPolicy.isApplication(url));
 }
 @Test public void legacyGetKeepsPathIntentAndFragmentOnCanonicalHost(){
  assertEquals("https://app.voxelveda.com/accept-invite#token=controlled-fixture",NavigationPolicy.canonical("https://voxelveda-app-production.up.railway.app/accept-invite#token=controlled-fixture"));
  assertEquals("https://app.voxelveda.com/login?returnTo=%2Fportal%2Fstaff",NavigationPolicy.canonical("https://voxelveda-app-production.up.railway.app/login?returnTo=%2Fportal%2Fstaff"));
  assertNull(NavigationPolicy.canonical("https://app.voxelveda.com//evil.invalid"));
  assertNull(NavigationPolicy.canonical("https://untrusted.invalid/reset-password"));
 }
}
