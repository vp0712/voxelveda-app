'use strict';
const crypto=require('node:crypto');
const path=require('node:path');
const {createDocumentPdf,storedDocumentArtifact,safePdfFilename,pdfError}=require('./documentPdfService');
const MAX_CELLS=10000,MAX_ROWS=1000;
function unsupported(message){return pdfError(`${message} The original source file and its import diagnostics remain preserved. No alternate download was returned.`,'PDF_SOURCE_FORMAT_UNSUPPORTED');}
function tablesFor(sheets){
  let cells=0,recordCount=0;const tables=[];
  for(const {name,rows,sourceRowNumbers} of sheets){
    if(!rows.length)continue;
    recordCount+=rows.length;if(recordCount>MAX_ROWS)throw unsupported('Choose a smaller source for preview; this document has more than 1,000 rows.');
    const width=Math.max(...rows.map(row=>row.length));cells+=rows.length*width;if(cells>MAX_CELLS||width>50)throw unsupported('Choose a smaller source for preview; the complete table exceeds its supported limit.');
    const textRows=rows.map(row=>Array.from({length:width},(_,i)=>String(row[i]??'')));
    if(textRows.some(row=>row.some(cell=>cell.length>2000)))throw unsupported('A source cell is too long for a readable PDF.');
    if(width<=6){tables.push({title:name,columns:Array.from({length:width},(_,i)=>({label:`Column ${i+1}`,width:1})),rows:textRows});}
    else textRows.forEach((row,i)=>tables.push({title:`${name} — source row ${sourceRowNumbers?.[i]??i+1}`,columns:[{label:'Column',width:1},{label:'Saved source value',width:5}],rows:row.map((cell,index)=>[String(index+1),cell])}));
  }
  if(!tables.length)throw unsupported('The source contains no readable table records.');
  return tables;
}
async function sourceArtifact({buffer,filename,sha256}){
  if(!Buffer.isBuffer(buffer)||buffer.length>10*1024*1024)throw unsupported('The original source bytes are unavailable or too large.');
  const hash=crypto.createHash('sha256').update(buffer).digest('hex');
  if(!/^[a-f0-9]{64}$/.test(String(sha256))||hash!==sha256)throw pdfError('The original source bytes failed their saved integrity check.','PDF_SNAPSHOT_MISMATCH');
  const ext=path.extname(String(filename||'')).toLowerCase();
  if(buffer.subarray(0,5).toString()==='%PDF-'||['.png','.jpg','.jpeg'].includes(ext))return storedDocumentArtifact(buffer,`source-${filename}`);
  let sheets;
  if(['.csv','.xlsx','.xls'].includes(ext)){
    let extracted;
    try{extracted=await require('./procurementImportExtractionService').extractImportFile({buffer,filename},{preserveSourceRows:true,limits:{maxRows:MAX_ROWS,maxCells:MAX_CELLS,maxColumns:50,maxFieldChars:2000,maxExpandedBytes:20*1024*1024,maxZipEntryBytes:8*1024*1024,timeoutMs:10000}});}catch{throw unsupported('The complete source could not be safely extracted for PDF preview.');}
    sheets=extracted.sheets.map(sheet=>{
      const all=sheet.sourceRows||[...(sheet.preamble||[]),...(sheet.headerRow?[{sourceRow:sheet.headerRow,cells:sheet.headers}]:[]),...sheet.rows].sort((a,b)=>a.sourceRow-b.sourceRow);
      if(all.some(row=>row.errors?.length))throw unsupported('The source contains malformed or incomplete rows. Correct the original file before preview.');
      return{name:sheet.name,sourceRowNumbers:all.map(row=>row.sourceRow),rows:all.map(row=>row.cells.map((cell,i)=>{const meta=row.cellMeta?.[i],saved=meta?.display??cell;return meta?.formula?(meta.cachedValueAvailable===false?'No cached formula result; review required':`${saved??''} [saved formula value; not recalculated]`):saved;}))};
    });
  }else throw unsupported('This original source type cannot be converted into a verified PDF.');
  const artifact=await createDocumentPdf({title:'PROCUREMENT SOURCE PREVIEW',reference:String(filename),filename:safePdfFilename(`source-${filename}`),party:'Preserved uploaded source',columns:[],tables:tablesFor(sheets),notes:['Complete supported source tables are shown as saved. Spreadsheet formulas are not executed or recalculated. This preview does not approve records, place orders, change inventory or establish payment.']});
  return {...artifact,source_sha256:hash};
}
module.exports={sourceArtifact,_test:{tablesFor}};
