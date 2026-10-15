package com.voxelveda.app;

import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSExport;
import org.json.*;
import java.io.*;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Instrumentation-only loopback transport; never packaged in the application APK. */
final class FixtureTransport {
 final int port;
 FixtureTransport(int port){this.port=port;}
 static class Reply {int status;Map<String,String> headers=new HashMap<>();byte[] bytes;}
 Reply relay(String url,String method,String body,Map<String,String> headers)throws Exception{
  if(!NavigationPolicy.isApplication(url))throw new IOException("Fixture rejects non-application origin");
  Uri uri=Uri.parse(url);String route=uri.getEncodedPath()+(uri.getEncodedQuery()==null?"":"?"+uri.getEncodedQuery());
  byte[] input=body.getBytes(StandardCharsets.UTF_8);
  try(Socket socket=new Socket("10.0.2.2",port)){
   socket.setSoTimeout(15000);OutputStream output=socket.getOutputStream();
   StringBuilder head=new StringBuilder(method+" "+route+" HTTP/1.1\r\nHost: app.voxelveda.com\r\nX-Forwarded-Proto: https\r\nOrigin: https://app.voxelveda.com\r\nConnection: close\r\nContent-Length: "+input.length+"\r\n");
   String cookie=CookieManager.getInstance().getCookie(NavigationPolicy.ORIGIN);if(cookie!=null)head.append("Cookie: ").append(cookie).append("\r\n");
   for(Map.Entry<String,String> entry:headers.entrySet())if(!Arrays.asList("host","cookie","origin","content-length","connection","x-forwarded-proto","if-none-match","if-modified-since","range").contains(entry.getKey().toLowerCase()))head.append(entry.getKey()).append(": ").append(entry.getValue()).append("\r\n");
   output.write((head+"\r\n").getBytes(StandardCharsets.ISO_8859_1));output.write(input);output.flush();
   InputStream stream=socket.getInputStream();Reply result=new Reply();result.status=Integer.parseInt(line(stream).split(" ")[1]);String line;
   while(!(line=line(stream)).isEmpty()){int colon=line.indexOf(':');if(colon<1)continue;String key=line.substring(0,colon).toLowerCase(),value=line.substring(colon+1).trim();if(key.equals("set-cookie"))CookieManager.getInstance().setCookie(NavigationPolicy.ORIGIN,value);else result.headers.put(key,value);}
   ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] block=new byte[16384];int count;
   if("chunked".equalsIgnoreCase(result.headers.get("transfer-encoding"))){while(true){int size=Integer.parseInt(line(stream).split(";")[0],16);if(size==0)break;int remaining=size;while(remaining>0){count=stream.read(block,0,Math.min(block.length,remaining));if(count<0)throw new EOFException();bytes.write(block,0,count);remaining-=count;}line(stream);}}
   else while((count=stream.read(block))!=-1)bytes.write(block,0,count);
   result.bytes=bytes.toByteArray();return result;
  }
 }
 private static String line(InputStream input)throws IOException{ByteArrayOutputStream bytes=new ByteArrayOutputStream();int value;while((value=input.read())!=-1){if(value==10)break;if(value!=13)bytes.write(value);}return bytes.toString("ISO-8859-1");}
 @JavascriptInterface public String request(String url,String method,String body,String headerJson){
  try{Map<String,String> headers=new HashMap<>();JSONArray values=new JSONArray(headerJson);for(int i=0;i<values.length();i++){JSONArray row=values.getJSONArray(i);headers.put(row.getString(0),row.getString(1));}Reply reply=relay(url,method,body,headers);return new JSONObject().put("status",reply.status).put("headers",new JSONObject(reply.headers)).put("base64",android.util.Base64.encodeToString(reply.bytes,android.util.Base64.NO_WRAP)).toString();}
  catch(Exception error){return "{\"status\":503,\"headers\":{\"content-type\":\"application/json\"},\"base64\":\"eyJtZXNzYWdlIjoiRml4dHVyZSB0cmFuc3BvcnQgdW5hdmFpbGFibGUifQ==\"}";}
 }
 String inject(Bridge bridge,String html)throws Exception{
  String runtime=JSExport.getGlobalJS(bridge.getContext(),false,true)+JSExport.getBridgeJS(bridge.getContext())+JSExport.getPluginJS(Collections.singletonList(bridge.getPlugin("VoxelVedaApp")));
  String fetch="window.fetch=async function(input,options){const request=new Request(input,options);const body=['GET','HEAD'].includes(request.method)?'':await request.text();const reply=JSON.parse(window.VVAndroidTestFixture.request(request.url,request.method,body,JSON.stringify([...request.headers])));const binary=atob(reply.base64),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));return new Response([204,205,304].includes(reply.status)?null:bytes,{status:reply.status,headers:reply.headers});};";
  return html.replace("<head>","<head><script>"+runtime+fetch+"</script>");
 }
}
