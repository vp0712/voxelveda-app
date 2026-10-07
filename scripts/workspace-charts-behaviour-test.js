'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.className='';}
  append(...children){children.forEach(child=>{child.parentElement=this;this.children.push(child);});}
  setAttribute(key,value){this.attrs[key]=value;}
  remove(){this.parentElement.children=this.parentElement.children.filter(item=>item!==this);}
  before(node){this.parentElement.append(node);}
  after(node){this.parentElement.append(node);}
  closest(selector){return this.parentElement?.className==='vv-chart-frame'?this.parentElement:null;}
  replaceWith(node){const parent=this.parentElement;this.remove();parent.append(node);}
  querySelectorAll(){return this.children.filter(child=>/^vv-chart-(context|data|details|empty)$/.test(child.className));}
}
const card=new Element('article'),canvas=new Element('canvas');card.append(canvas);
let theme={text:'#0F172A',muted:'#475569',surface:'#FFFFFF',border:'#CBD5E1',primary:'#1D4ED8',series:['#1D4ED8','#166534','#B91C1C']};
const charts=[],events={};
class Chart { constructor(element,config){this.config=config;charts.push(this);}destroy(){this.destroyed=true;}resize(){this.resized=true;} }
const window={VoxelTheme:{tokens:()=>theme},addEventListener:(name,fn)=>events[name]=fn};
vm.runInNewContext(fs.readFileSync('public/workspace-charts.js','utf8'),{window,document:{getElementById:()=>canvas,createElement:tag=>new Element(tag)},Chart,matchMedia:()=>({matches:true,addEventListener:()=>{}}),requestAnimationFrame:fn=>{fn();return 1;},cancelAnimationFrame:()=>{},Map});
const opened=[];
const spec={title:'Invoices',context:'All records · count',type:'bar',horizontal:true,labels:['Very long status label that must wrap','Paid'],datasets:[{label:'Invoices',data:[0,3]}],rows:[{label:'Very long status label that must wrap',value:0},{label:'Paid',value:3}],open:row=>opened.push(row.label)};
window.VoxelCharts.render('chart',spec);
assert.equal(charts[0].config.options.scales.x.ticks.color,theme.text);
assert.equal(charts[0].config.options.plugins.legend.labels.font.size,14);
assert.equal(charts[0].config.data.datasets[0].minBarLength,0);
assert.deepEqual(charts[0].config.data.datasets[0].data,[0,3]);
const list=card.children.find(item=>item.className==='vv-chart-data');
assert.equal(list.children.length,2);list.children[1].children[0].onclick();assert.deepEqual(opened,['Paid']);
assert.match(canvas.attrs['aria-label'],/Values and record links/);
theme={...theme,text:'#F8FAFC',surface:'#172033',primary:'#93C5FD'};events['workspace:theme']();
assert.equal(charts[0].destroyed,true);assert.equal(charts.at(-1).config.options.plugins.tooltip.bodyColor,'#F8FAFC');
events.pagehide({persisted:true});assert(!charts.at(-1).destroyed,'cached Back navigation keeps the rendered chart alive');
events.pageshow({persisted:true});assert.equal(charts.at(-1).config.options.color,'#F8FAFC');
const count=charts.length;window.VoxelCharts.render('chart',{...spec,datasets:[{label:'Zero',data:[0,0]}]});
assert.equal(charts.length,count,'zero counts cannot invent chart segments');
assert(card.children.some(item=>item.className==='vv-chart-empty'));
window.VoxelCharts.render('chart',{...spec,datasets:[{label:'Net',data:[-10,0]}]});
assert.equal(charts.at(-1).config.data.datasets[0].data[0],-10,'negative results retain their sign');
events.pagehide({persisted:false});assert(charts.at(-1).destroyed);
console.log('Workspace chart behaviour passed: explicit theme, 14px labels, accessible actions, zero/negative values, theme cleanup and cached Back navigation.');
