/* Chart.js canvas colours, sizing and accessible record links share one contract. */
(() => {
  'use strict';
  const registry = new Map();
  const text = value => String(value ?? '');
  const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const wrap = label => text(label).match(/.{1,22}(?:\s|$)|\S{1,22}/g)?.map(part=>part.trim()) || [''];
  function render(id, spec) {
    const canvas = document.getElementById(id);
    if (!canvas || typeof Chart === 'undefined') return null;
    registry.get(id)?.chart?.destroy();
    const tokens = window.VoxelTheme.tokens();
    let frame = canvas.closest('.vv-chart-frame');
    if (!frame) { frame = document.createElement('div'); frame.className='vv-chart-frame'; canvas.replaceWith(frame); frame.append(canvas); }
    canvas.setAttribute('role','img');
    canvas.setAttribute('aria-label', spec.title + '. ' + spec.context + '. Values and record links follow the chart.');
    const card = frame.parentElement;
    card.querySelectorAll(':scope > .vv-chart-context, :scope > .vv-chart-data, :scope > .vv-chart-details, :scope > .vv-chart-empty').forEach(e=>e.remove());
    const context = document.createElement('p'); context.className='vv-chart-context'; context.textContent=spec.context;
    frame.before(context);
    const list = document.createElement('ul'); list.className='vv-chart-data';
    (spec.rows || []).forEach(row => {
      const item=document.createElement('li'), button=document.createElement('button'), label=document.createElement('span'), value=document.createElement('strong');
      button.type='button'; label.textContent=row.label; value.textContent=row.display ?? text(row.value);
      button.append(label,value); button.onclick=()=>spec.open?.(row);
      if (!spec.open) { button.disabled=true; button.setAttribute('aria-label',row.label+': '+value.textContent); }
      item.append(button); list.append(item);
    });
    if (spec.collapsible) {
      const details=document.createElement('details'); details.className='vv-chart-details';
      const summary=document.createElement('summary'); summary.textContent='View chart values and records'; details.append(summary,list); frame.after(details);
    } else frame.after(list);
    const datasets = spec.datasets.map((dataset,index)=>({ ...dataset, data:dataset.data.map(finite), backgroundColor:dataset.colourByValue ? dataset.data.map((_,i)=>tokens.series[i%tokens.series.length]) : tokens.series[index%tokens.series.length], borderColor:dataset.type==='line' ? tokens.series[index%tokens.series.length] : tokens.surface, borderWidth:spec.type==='doughnut'?2:1, borderRadius:spec.type==='doughnut'?0:4, pointBackgroundColor:tokens.series[index%tokens.series.length], pointBorderColor:tokens.surface, tension:0, minBarLength:0 }));
    const empty = !datasets.some(dataset=>dataset.data.some(value=>value!==0));
    frame.hidden=empty;
    if (empty) { const message=document.createElement('div'); message.className='vv-chart-empty'; message.textContent='No non-zero values for this period. Zero values are listed below.'; frame.after(message); registry.set(id,{spec,chart:null}); return null; }
    const horizontal=spec.horizontal || (spec.mobileHorizontal && matchMedia('(max-width:600px)').matches);
    const doughnut=spec.type==='doughnut';
    const center={id:'workspaceCentre',afterDraw(chart){
      if(!spec.center || !chart.getDatasetMeta(0)?.data?.[0])return;
      const {x,y}=chart.getDatasetMeta(0).data[0], ctx=chart.ctx; ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=tokens.text;ctx.font='700 22px Arial';ctx.fillText(text(spec.center.value),x,y-10);ctx.fillStyle=tokens.muted;ctx.font='14px Arial';ctx.fillText(spec.center.label,x,y+16);ctx.restore();
    }};
    const chart = new Chart(canvas, {
      type:spec.type || 'bar', data:{labels:spec.labels,datasets}, plugins:[center],
      options:{responsive:true,maintainAspectRatio:false,indexAxis:horizontal?'y':'x',cutout:'68%',animation:false,
        color:tokens.text,layout:{padding:4}, interaction:{mode:'nearest',intersect:true},
        onClick:(_event,elements)=>{if(elements.length)spec.chartOpen?.(elements[0].index,elements[0].datasetIndex);},
        plugins:{legend:{display:spec.legend!==false,position:'bottom',labels:{color:tokens.text,font:{size:14},boxWidth:14,boxHeight:14,padding:14}},tooltip:{backgroundColor:tokens.surface,titleColor:tokens.text,bodyColor:tokens.text,borderColor:tokens.primary,borderWidth:1,titleFont:{size:14},bodyFont:{size:14},callbacks:{label:context=>context.dataset.label+': '+(spec.format?spec.format(context.raw):text(context.raw))}}},
        ...(!doughnut?{scales:{x:{beginAtZero:true,ticks:{color:tokens.text,font:{size:14},precision:spec.currency?undefined:0,...(horizontal&&spec.currency?{callback:spec.format}:{}),...(horizontal?{}:{maxRotation:0,minRotation:0})},grid:{color:tokens.border,display:horizontal}},y:{beginAtZero:true,ticks:{color:tokens.text,font:{size:14},precision:spec.currency?undefined:0,...(!horizontal&&spec.currency?{callback:spec.format}:{}),...(horizontal?{callback:function(value){return wrap(this.getLabelForValue(value));}}:{})},grid:{color:tokens.border,display:!horizontal}}}}:{})
      }
    });
    registry.set(id,{spec,chart}); return chart;
  }
  let resizeFrame;
  function refresh() { cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>registry.forEach(({spec},id)=>render(id,spec))); }
  window.VoxelCharts={render,resize:()=>registry.forEach(({chart})=>chart?.resize()),destroy:()=>{registry.forEach(({chart})=>chart?.destroy());registry.clear();}};
  window.addEventListener('workspace:theme',refresh);
  const breakpoint=matchMedia('(max-width:600px)');breakpoint.addEventListener('change',refresh);
  window.addEventListener('pagehide',event=>{if(!event.persisted)window.VoxelCharts.destroy();});
  window.addEventListener('pageshow',event=>{if(event.persisted)refresh();});
})();
