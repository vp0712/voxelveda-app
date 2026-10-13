'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
let childTextWrites=0;
class Element extends EventTarget {
 constructor(tag='span'){super();this.tagName=tag;this.children=[];this.dataset={};this.style={};this.attrs={};this.hidden=false;this.isConnected=true;this._text='';const classes=new Set();this.classList={add:value=>classes.add(value),remove:value=>classes.delete(value),toggle(value,on){on?classes.add(value):classes.delete(value);},contains:value=>classes.has(value)};}
 appendChild(child){this.children.push(child);child.parent=this;return child;}
 replaceChildren(...children){this.children=children;this._text='';children.forEach(child=>child.parent=this);}
 contains(child){return this.children.includes(child);}
 set textContent(text){childTextWrites++;this._text=String(text);this.children=[];}
 get textContent(){return this._text;}
 setAttribute(key,value){this.attrs[key]=String(value);}
 hasAttribute(key){return Object.hasOwn(this.attrs,key);}
 removeAttribute(key){delete this.attrs[key];if(key==='src')this._src='';}
 set src(value){this._src=value;queueMicrotask(()=>this.onload?.());}
 get src(){return this._src;}
}
const source=fs.readFileSync(path.join(__dirname,'..','public','profile-avatar.js'),'utf8');
const values=new Map([['token','fixture-account-A'],['user',JSON.stringify({id:1})]]);
const window=new EventTarget(),document=new EventTarget();document.readyState='loading';document.body=new Element('body');document.head=new Element('head');
const header=new Element(),home=new Element(),directory=new Element();header.setAttribute('data-avatar-self','');home.setAttribute('data-avatar-self','');directory.setAttribute('data-avatar-user-id','2');directory.dataset.avatarUserId='2';directory.dataset.avatarName='Staff B';
let activeTargets=[header,home];header.title='Open My Profile';
document.querySelectorAll=()=>activeTargets;document.getElementById=id=>document.head.children.find(element=>element.id===id)||null;document.createElement=tag=>new Element(tag);
const requests=[],revoked=[],created=[];let photoStatus=200,holdPhoto=false,resolvePhoto,actualProfile={id:1,name:'Staff A',has_profile_photo:true,profile_photo_url:'/api/profile/photo?v=first',profile_photo_revision:'first'};
class FixtureURL extends URL {static createObjectURL(blob){const url='blob:fixture-'+(created.length+1);created.push({url,blob});return url;}static revokeObjectURL(url){revoked.push(url);}}
class CustomEvent extends Event {constructor(type,options={}){super(type);this.detail=options.detail;}}
const fetch=async(url,options)=>{
 requests.push({url,options});
 if(url==='/api/profile')return Response.json({profile:actualProfile});
 if(holdPhoto){holdPhoto=false;return new Promise(resolve=>resolvePhoto=resolve);}
 if(photoStatus!==200)return Response.json({message:'Fixture temporary failure'},{status:photoStatus});
 return new Response(Buffer.from('fixture-decoded-image-bytes'),{headers:{'Content-Type':'image/jpeg'}});
};
const context=vm.createContext({window,document,localStorage:{getItem:key=>values.get(key)||null},location:{origin:'https://fixture.invalid'},URL:FixtureURL,fetch,AbortController,CustomEvent,setTimeout,clearTimeout,MutationObserver:class{observe(){}},console});
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
async function main(){
 vm.runInContext(source,context);const avatar=window.VoxelAvatar;
 avatar.mount(header,{self:true});avatar.mount(home,{self:true});avatar.updateSelf(actualProfile);await flush();
 assert.equal(requests.filter(row=>row.url.startsWith('/api/profile/photo')).length,1,'One private fetch supplies header and home.');
 assert.equal(avatar.objectUrl(header),avatar.objectUrl(home));assert.equal(header.dataset.avatarState,'loaded');
 assert.ok(requests.every(row=>row.options.credentials==='same-origin'&&row.options.headers.Authorization==='Bearer fixture-account-A'));assert.ok(requests.every(row=>!row.url.includes('fixture-account-A')));
 const old=avatar.objectUrl(header);actualProfile={...actualProfile,profile_photo_revision:'second',profile_photo_url:'/api/profile/photo?v=second'};avatar.updateSelf(actualProfile);await flush();
 assert.ok(revoked.includes(old));assert.notEqual(avatar.objectUrl(header),old);assert.equal(avatar.objectUrl(header),avatar.objectUrl(home));
 holdPhoto=true;actualProfile={...actualProfile,profile_photo_revision:'held',profile_photo_url:'/api/profile/photo?v=held'};avatar.updateSelf(actualProfile);await flush();assert.equal(header.dataset.avatarState,'loading');
 header.dataset.avatarName='Staff A';home.dataset.avatarName='Staff A';values.set('token','fixture-account-B');values.set('user',JSON.stringify({id:2}));actualProfile={id:2,name:'Staff B',has_profile_photo:false,profile_photo_url:null,profile_photo_revision:null};const changing=avatar.refreshSelf({force:true});assert.notEqual(header.children[1].textContent,'SA','Unverified stale DOM names cannot restore the previous account initials.');await changing;
 assert.equal(avatar.objectUrl(header),null);assert.equal(header.dataset.avatarState,'missing');const count=created.length;resolvePhoto(new Response('stale account A photo',{headers:{'Content-Type':'image/jpeg'}}));await flush();assert.equal(created.length,count,'A stale account response cannot produce a cached Blob.');
 assert.ok(requests.at(-1).options.headers.Authorization==='Bearer fixture-account-B');
 actualProfile={...actualProfile,has_profile_photo:true,profile_photo_revision:'failure',profile_photo_url:'/api/profile/photo?v=failure'};photoStatus=503;avatar.updateSelf(actualProfile);await flush();assert.equal(header.dataset.avatarState,'failed');assert.match(header.title,/Retry/);
 const failedRequests=requests.length;avatar.mount(header,{self:true});await flush();assert.equal(requests.length,failedRequests,'Render does not create retry loops.');photoStatus=200;await avatar.retrySelf();await flush();assert.equal(header.dataset.avatarState,'loaded');assert.equal(header.title,'Open My Profile','Successful retry clears the stale failure tooltip.');
 avatar.mount(directory,{self:false,userId:2,name:'Staff B'});await flush();assert.ok(requests.some(row=>row.url==='/api/profile/staff/2/photo'));
 const removedDirectoryUrl=avatar.objectUrl(directory),retainedHeaderUrl=avatar.objectUrl(header);directory.isConnected=false;avatar.mountAll();await flush();assert.ok(revoked.includes(removedDirectoryUrl),'Directory pagination revokes the removed row photo.');assert.ok(!revoked.includes(retainedHeaderUrl),'Live shared header photo stays cached.');
 const nextDirectory=new Element();nextDirectory.setAttribute('data-avatar-user-id','3');nextDirectory.dataset.avatarUserId='3';nextDirectory.dataset.avatarName='Staff C';activeTargets=[header,home,nextDirectory];holdPhoto=true;avatar.mountAll();await flush();
 const pendingRequest=requests.at(-1);assert.equal(pendingRequest.url,'/api/profile/staff/3/photo');const beforePrune=created.length;nextDirectory.isConnected=false;activeTargets=[header,home];avatar.mountAll();assert.equal(pendingRequest.options.signal.aborted,true,'A removed pending directory fetch is aborted.');
 resolvePhoto(new Response('late removed directory photo',{headers:{'Content-Type':'image/jpeg'}}));await flush();assert.equal(created.length,beforePrune,'A late response from a pruned cache cannot create a Blob URL.');
 for(const [id,httpStatus,expected] of [[4,404,'missing'],[5,503,'failed']]){
   const settled=new Element();settled.setAttribute('data-avatar-user-id',String(id));settled.dataset.avatarUserId=String(id);settled.dataset.avatarName='Directory Fixture';activeTargets=[header,home,settled];photoStatus=httpStatus;avatar.mountAll();await flush();assert.equal(settled.dataset.avatarState,expected);
   const settledRequests=requests.length,settledWrites=childTextWrites;for(let i=0;i<5;i++){avatar.mountAll();await flush();}
   assert.equal(requests.length,settledRequests,'Settled directory failures do not re-fetch on DOM updates.');assert.equal(childTextWrites,settledWrites,'Settled directory failures do not toggle loading and initials text.');
   settled.isConnected=false;activeTargets=[header,home];avatar.mountAll();photoStatus=200;
 }
 const invalid=new Element();invalid.setAttribute('data-avatar-user-id','NaN');invalid.dataset.avatarUserId='NaN';invalid.dataset.avatarName='Invalid directory ID';activeTargets=[header,home,invalid];const beforeInvalid=requests.length;avatar.mountAll();await flush();assert.equal(requests.length,beforeInvalid,'Invalid directory IDs cannot request /NaN or fall back to the signed-in account.');assert.equal(invalid.dataset.avatarState,'missing');invalid.isConnected=false;activeTargets=[header,home];avatar.mountAll();
 const validRequests=requests.length;actualProfile={...actualProfile,profile_photo_revision:'invalid-reference',profile_photo_url:'https://unrelated.invalid/private-image'};avatar.updateSelf(actualProfile);await flush();assert.equal(header.dataset.avatarState,'failed');assert.ok(requests.slice(validRequests).every(row=>row.url.startsWith('/api/profile/staff/')),'Bearer credentials never follow an external photo URL.');
 window.dispatchEvent(new Event('pagehide'));assert.equal(avatar.objectUrl(header),null);assert.equal(avatar.objectUrl(home),null);assert.ok(created.every(item=>revoked.includes(item.url)),'Page exit revokes every Blob URL.');
 console.log('Shared avatar component tests passed: one authenticated Blob fetch across displays; immediate revision updates; account-switch clear and stale-response isolation; bounded retry; private staff endpoint; directory pagination prunes cached and pending photos; cached 404/503 states settle without text toggles; invalid IDs never fetch; successful retry clears failure tooltip; no token/external URLs; complete Blob revocation.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
