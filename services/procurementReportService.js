'use strict';
const crypto = require('node:crypto');
const { DateTime } = require('luxon');
const pool = require('../config/db');
const { hasPermission } = require('./authorizationService');
const { logAudit, stableJsonText } = require('./auditService');
const { createDocumentPdf, validateDocumentPdf, safePdfFilename, dateLabel, pdfError } = require('./documentPdfService');
const decimal = require('../utils/money');
const { quantityUnits } = require('../utils/quantity');
const TYPES = new Set(['register','items','suppliers','summary','selected','individual','import-outcomes']);
const SOURCES = new Set(['entries','purchase-orders','receipts','requisitions','workflow','catalog']);
const MAX_RECORDS = 2000;
let schemaPromise;
function error(message, status=422, code='PROCUREMENT_REPORT_INVALID') { return Object.assign(new Error(message), {status,statusCode:status,code}); }
function authorised(user) { if (!user?.id || !hasPermission(user,'VIEW_PROCUREMENT')) throw error('Procurement reports are not permitted.',403,'PERMISSION_DENIED'); }
function id(value) { const text=String(value || ''); if (!/^(?:[1-9]\d{0,15}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(text)) throw error('Choose a valid saved record.'); return text; }
function isoDate(value, field) { if (!value) return null; const text=String(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !DateTime.fromISO(text).isValid) throw error(`Enter a valid ${field} date.`); return text; }
function parseRequest(input={}) {
  const type=input.type || 'register', source=input.source || 'entries';
  if (!TYPES.has(type) || !SOURCES.has(source)) throw error('Choose a supported procurement report and source.');
  const filters={};
  const allowed=new Set(['search','classification','status','currency','supplier_id','from','to','from_date','to_date','archived','sort','priority','phase','category']);
  if (input.filters && (typeof input.filters!=='object' || Array.isArray(input.filters))) throw error('Report filters must be an object.');
  for (const [key,value] of Object.entries(input.filters || {})) {
    if (!allowed.has(key) || !['string','number','boolean'].includes(typeof value) || String(value).length>255) throw error(`The ${key} report filter is invalid.`);
    if (String(value).trim()) filters[key]=String(value).trim();
  }
  if (filters.from) { if(filters.from_date && filters.from!==filters.from_date)throw error('Conflicting start dates.');filters.from_date=filters.from;delete filters.from; }
  if (filters.to) { if(filters.to_date && filters.to!==filters.to_date)throw error('Conflicting end dates.');filters.to_date=filters.to;delete filters.to; }
  filters.from_date=isoDate(filters.from_date,'start');filters.to_date=isoDate(filters.to_date,'end');
  if (filters.from_date && filters.to_date && filters.from_date>filters.to_date) throw error('The end date must follow the start date.');
  if (filters.currency && !/^[A-Z]{3}$/.test(filters.currency)) throw error('Choose a three-letter currency.');
  if(filters.supplier_id)filters.supplier_id=id(filters.supplier_id);
  if(filters.archived!==undefined && !['0','1','true','false'].includes(filters.archived))throw error('Archive filter must be true or false.');
  if (filters.archived==='1'||filters.archived==='true') { if(filters.status && filters.status!=='ARCHIVED')throw error('Conflicting archive/status filters.');filters.status='ARCHIVED'; }
  delete filters.archived;
  const ids=input.ids===undefined?[]:input.ids;
  if (!Array.isArray(ids) || ids.length>500) throw error('Choose at most 500 saved records.');
  const selected=[...new Set(ids.map(id))];
  if (type==='individual') { selected.splice(0,selected.length,id(input.record_id)); }
  if (type==='selected' && !selected.length) throw error('Select at least one saved record.');
  if (type==='import-outcomes' && !input.batch_id) throw error('Choose an import batch.');
  if(type==='import-outcomes' && source!=='entries')throw error('Import outcomes belong to saved-entry imports.');
  return {type,source,filters,ids:selected,batch_id:input.batch_id?id(input.batch_id):null};
}
function bounded(records) { if(!Array.isArray(records) || records.length>MAX_RECORDS) throw error('Choose narrower filters; no partial procurement report was generated.',422,'PROCUREMENT_REPORT_LIMIT'); return records; }
function cleanSnapshot(source) { return JSON.parse(JSON.stringify(source)); }
function sourceHash(source) { return crypto.createHash('sha256').update(stableJsonText(cleanSnapshot(source))).digest('hex'); }
function sourceRecordCount(source) { return source.imports?Number(source.imports.counts?.total_rows??source.imports.rows.length):source.records.length; }
function value(amount,currency) {
  if(amount===null || amount===undefined || amount==='')return 'Not recorded';
  if(!Number.isFinite(Number(amount)) || (currency && !/^[A-Z]{3}$/.test(currency)))throw pdfError('A saved procurement amount or currency is invalid.','PDF_DATA_INVALID');
  const exact=decimal.fromCents(decimal.toCents(amount)),[whole,fraction]=exact.split('.');
  return currency?`${currency} ${BigInt(whole).toLocaleString('en-AU')}.${fraction}`:`${exact} (currency not recorded)`;
}
function quantity(amount,unit) { if(amount===null || amount===undefined || amount==='')return 'Not recorded';const n=quantityUnits(amount,{allowZero:true,signed:true});if(n===null)throw pdfError('A saved procurement quantity is invalid.','PDF_DATA_INVALID');return `${(n/1000).toFixed(3).replace(/\.?0+$/,'')} ${unit || '(unit not recorded)'}`; }
function amountBasis(row) {
  if(row.native_kind==='receipt')return 'Receipt quantities';
  if(row.native_kind==='order')return ['APPROVED','ISSUED','PART_RECEIVED','PARTIALLY_RECEIVED','RECEIVED','CLOSED'].includes(row.status)?'Committed purchase orders':'Uncommitted purchase orders';
  if(row.classification==='PLAN')return 'Plan estimates';
  if(row.classification==='QUOTATION')return 'Quoted document values';
  if(row.classification==='PURCHASE_ORDER')return 'Draft purchase-order document values';
  return 'Supplier-invoice document values';
}
function groupedBasis(row) {
  const base=amountBasis(row);
  if(row.archived_at || row.status==='ARCHIVED')return `Archived records: ${base}`;
  if(row.status==='CANCELLED')return `Cancelled records: ${base}`;
  return base;
}
function orderQuantities(record,line) {
  const ordered=quantityUnits(line.quantity,{allowZero:true});
  const received=line.received_quantity==null?null:quantityUnits(line.received_quantity,{allowZero:true});
  const returned=line.returned_quantity==null?null:quantityUnits(line.returned_quantity,{allowZero:true});
  if(ordered===null || (line.received_quantity!=null && (received===null||received>ordered)) || (line.returned_quantity!=null && (returned===null || (received!==null && returned>received))))throw pdfError('Recorded purchase-order quantities require review before reporting.','PDF_DATA_INVALID');
  return {ordered,received,returned,outstanding:['CANCELLED','CLOSED'].includes(record.status)||record.archived_at?0:received===null?null:ordered-received};
}
function totalsFor(records) {
  const amounts=new Map(), quantities=new Map();let missingCurrency=0,missingAmount=0,missingUnit=0;
  for(const row of records) {
    const basis=groupedBasis(row);
    if(!row.currency)missingCurrency++;
    if(row.total===null || row.total===undefined || row.total==='')missingAmount++;else if(row.currency) {
      const key=[basis,row.currency].join('|');const current=amounts.get(key)||{basis,currency:row.currency,cents:0n,count:0};current.cents+=decimal.toCents(row.total);current.count++;amounts.set(key,current);
    }
    function addQuantity(label,unit,units){const key=[label,unit].join('|'),current=quantities.get(key)||{basis:label,unit,units:0};current.units+=units;if(!Number.isSafeInteger(current.units))throw pdfError('The quantity total exceeds its supported range.','PDF_DATA_INVALID');quantities.set(key,current);}
    for(const line of row.lines || [row])if(line.quantity!==null && line.quantity!==undefined) {
      if(!line.unit){missingUnit++;continue;}
      const units=quantityUnits(line.quantity,{allowZero:true,signed:true});if(units===null)throw pdfError('A saved quantity is invalid.','PDF_DATA_INVALID');
      if(row.native_kind==='order'){
        const q=orderQuantities(row,line);addQuantity(`${basis}: ordered`,line.unit,q.ordered);
        if(q.received!==null)addQuantity(`${basis}: received`,line.unit,q.received);
        if(q.returned!==null)addQuantity(`${basis}: returned`,line.unit,q.returned);
        if(q.outstanding!==null && !['CANCELLED','CLOSED'].includes(row.status) && !row.archived_at)addQuantity(`${basis}: outstanding`,line.unit,q.outstanding);
      }else addQuantity(basis,line.unit,units);
    }
    if(row.native_kind==='receipt'){
      const units=new Set((row.lines||[]).map(line=>line.unit));
      if(units.size===1 && !units.has(null) && !units.has(undefined))for(const key of ['accepted_quantity','rejected_quantity'])if(row[key]!=null){const n=quantityUnits(row[key],{allowZero:true});if(n===null)throw pdfError('A recorded receiving inspection quantity is invalid.','PDF_DATA_INVALID');addQuantity(`${basis}: ${key==='accepted_quantity'?'inspection accepted':'inspection rejected'}`,[...units][0],n);}
    }
  }
  return {amounts:[...amounts.values()].map(group=>({...group,total:decimal.fromCents(group.cents),cents:undefined})),quantities:[...quantities.values()],missingCurrency,missingAmount,missingUnit};
}
function nativeWhere(request, alias, dateColumn, names, extra=[]) {
  const clauses=[...extra],params=[], f=request.filters;
  if(f.search){clauses.push(`(${names.map(name=>`${name} LIKE ?`).join(' OR ')})`);params.push(...names.map(()=>`%${f.search}%`));}
  if(f.status){clauses.push(`${alias}.status=?`);params.push(f.status);}
  if(f.currency){clauses.push(`${alias}.currency=?`);params.push(f.currency);}
  if(f.supplier_id){clauses.push(`${alias}.supplier_id=?`);params.push(f.supplier_id);}
  if(f.from_date){clauses.push(`${dateColumn}>=?`);params.push(f.from_date);}
  if(f.to_date){clauses.push(`${dateColumn}<=?`);params.push(f.to_date);}
  if(request.ids.length){clauses.push(`${alias}.id IN (${request.ids.map(()=>'?').join(',')})`);params.push(...request.ids);}
  return {sql:clauses.length?`WHERE ${clauses.join(' AND ')}`:'',params};
}
async function nativeRows(request,db) {
  if(request.source==='workflow') {
    if(request.ids.length || request.filters.supplier_id || request.filters.currency || request.filters.classification)throw error('Use an individual native register for record, supplier, classification or currency filters.');
    const rows=[];for(const source of ['requisitions','purchase-orders','receipts'])rows.push(...await nativeRows({...request,source},db));return bounded(rows);
  }
  let rows,records=[];
  if(request.source==='purchase-orders') {
    if(request.filters.classification && request.filters.classification!=='PURCHASE_ORDER')return [];
    const w=nativeWhere(request,'po','po.issue_date',['po.po_number','s.supplier_name','po.notes']);
    [rows]=await db.query(`SELECT po.*,s.supplier_name,s.email FROM purchase_orders po LEFT JOIN suppliers s ON s.id=po.supplier_id ${w.sql} ORDER BY po.issue_date,po.id LIMIT 2001`,w.params);bounded(rows);
    for(const row of rows){const [items]=await db.query('SELECT * FROM purchase_order_items WHERE purchase_order_id=? ORDER BY line_no,id',[row.id]);
      const sum=key=>decimal.fromCents(items.reduce((total,item)=>total+decimal.toCents(item[key]),0n));
      if(!items.length || !decimal.equals(sum('line_total'),row.total_amount) || !decimal.equals(sum('line_subtotal'),row.subtotal) || !decimal.equals(sum('line_tax'),row.tax_amount) || items.some(item=>!decimal.equals(decimal.add(item.line_subtotal,item.line_tax),item.line_total)))throw pdfError('Purchase order totals do not match its saved items.','PDF_TOTAL_MISMATCH');
      records.push({...row,reference:row.po_number,classification:'PURCHASE_ORDER',date:row.issue_date,due_date:row.expected_date,total:row.total_amount,net:row.subtotal,tax:row.tax_amount,native_kind:'order',revision:1,lines:items.map(item=>({...item,net:item.line_subtotal,tax:item.line_tax,total:item.line_total}))});
    }
  }else if(request.source==='requisitions') {
    if(request.filters.supplier_id)throw error('Requisitions have item-level preferred suppliers; use the requisition register without a supplier filter.');
    if(request.filters.classification && request.filters.classification!=='PLAN')return [];
    const w=nativeWhere(request,'pr','DATE(pr.created_at)',['pr.requisition_no','pr.title','pr.business_reason']);
    [rows]=await db.query(`SELECT pr.* FROM purchase_requisitions pr ${w.sql} ORDER BY pr.created_at,pr.id LIMIT 2001`,w.params);bounded(rows);
    for(const row of rows){const [items]=await db.query('SELECT * FROM purchase_requisition_items WHERE purchase_requisition_id=? ORDER BY line_no,id',[row.id]);records.push({...row,reference:row.requisition_no,classification:'PLAN',date:String(row.created_at instanceof Date?row.created_at.toISOString():row.created_at).slice(0,10),due_date:row.required_date,total:row.estimated_total,native_kind:'requisition',revision:1,lines:items.map(item=>({...item,unit_price:item.estimated_unit_price,total:decimal.multiplyQuantity(item.estimated_unit_price,item.quantity)}))});}
  }else {
    if(request.filters.currency)throw error('Receipts record quantities; use the purchase-order register for currency filters.');
    if(request.filters.classification && request.filters.classification!=='GOODS_RECEIPT')return [];
    const requestWithoutCurrency={...request,filters:{...request.filters}};delete requestWithoutCurrency.filters.supplier_id;
    const w=nativeWhere(requestWithoutCurrency,'gr','gr.received_date',['gr.receipt_no','po.po_number','s.supplier_name']);
    if(request.filters.supplier_id){w.sql+=`${w.sql?' AND':'WHERE'} po.supplier_id=?`;w.params.push(request.filters.supplier_id);}
    [rows]=await db.query(`SELECT gr.*,po.po_number,po.supplier_id,s.supplier_name,ri.result AS inspection_result,ri.accepted_quantity,ri.rejected_quantity FROM goods_receipts gr JOIN purchase_orders po ON po.id=gr.purchase_order_id LEFT JOIN suppliers s ON s.id=po.supplier_id LEFT JOIN receiving_inspections ri ON ri.goods_receipt_id=gr.id ${w.sql} ORDER BY gr.received_date,gr.id LIMIT 2001`,w.params);bounded(rows);
    for(const row of rows){const [items]=await db.query(`SELECT gri.*,poi.description,poi.unit,poi.item_code FROM goods_receipt_items gri JOIN purchase_order_items poi ON poi.id=gri.purchase_order_item_id WHERE gri.goods_receipt_id=? ORDER BY poi.line_no,gri.id`,[row.id]);records.push({...row,reference:row.receipt_no,classification:'GOODS_RECEIPT',date:row.received_date,total:null,native_kind:'receipt',revision:1,lines:items.map(item=>({...item,quantity:item.quantity_received,total:null}))});}
  }
  return bounded(records);
}
async function loadSource(request,user,db=pool) {
  authorised(user);
  if(request.type==='import-outcomes') {
    if(Object.values(request.filters).some(Boolean))throw error('An import-outcome report includes the complete chosen batch; register filters do not apply.');
    const imports=await require('./procurementImportService').readImportReport({user,batchId:request.batch_id,db});
    if(imports.rows.length>5000)throw error('This complete import-outcome report exceeds the supported PDF limit. Use smaller upload batches; no partial outcomes were returned.',422,'PROCUREMENT_REPORT_LIMIT');
    return {request,imports,records:[]};
  }
  let records;
  if(request.source==='entries')records=await require('./procurementEntryService').listReportRecords({user,filters:{...request.filters,...(request.ids.length?{ids:request.ids}:{})},db,limit:MAX_RECORDS});
  else if(request.source==='catalog') {
    if(request.filters.status || request.filters.currency || request.filters.supplier_id || request.filters.from_date || request.filters.to_date || request.filters.classification || request.filters.sort)throw error('The approved master catalog supports search, category, priority and phase filters.');
    records=require('./procurementCatalogData').bom.slice(1).map(row=>({id:String(row[0]),reference:`BOM-${row[0]}`,classification:'PLAN',title:row[3],description:[row[3],row[4]].filter(Boolean).join(' — '),supplier_name:row[13],quantity:row[6],unit:null,currency:'AUD',unit_price:row[7],total:row[18],landed_estimate:row[19],status:'REFERENCE ESTIMATE',revision:1,category:row[1],priority:row[9],phase:row[10]}));
    records=records.filter(row=>(!request.filters.search || JSON.stringify(row).toLowerCase().includes(request.filters.search.toLowerCase())) && ['category','priority','phase'].every(key=>!request.filters[key]||String(row[key])===request.filters[key]));
  }else {if(request.filters.priority||request.filters.phase||request.filters.category||request.filters.sort)throw error('This filter belongs to the master catalog or saved-entry register.');records=await nativeRows(request,db);}
  bounded(records);
  if(request.ids.length){const selected=new Set(request.ids);records=records.filter(row=>selected.has(String(row.id)));if(records.length!==selected.size)throw error('One or more selected records are unavailable under these filters or your access. No partial report was generated.',404,'PROCUREMENT_SELECTION_UNAVAILABLE');}
  const lineCount=records.reduce((n,row)=>n+(row.lines?.length||1),0);if(lineCount>10000)throw error('Choose narrower filters; too many item lines were selected.',422,'PROCUREMENT_REPORT_LIMIT');
  return {request,records:cleanSnapshot(records)};
}
function documentData(source,reference,createdAt=new Date()) {
  const {request,records}=source,tables=[], totals=totalsFor(records), count=source.imports?Number(source.imports.counts?.total_rows??source.imports.rows.length):records.length;
  const cols=items=>items.map(([label,width,align])=>({label,width,align:align||'left'}));
  if(source.imports) {
    const {files,rows,counts}=source.imports;
    tables.push({title:'Every uploaded file',columns:cols([['Filename',3],['Status',1.3],['Diagnostic',3]]),rows:files.map(file=>[file.name||file.original_name||file.filename||file.original_filename||'Unnamed source',file.status||file.outcome||'REVIEW REQUIRED',file.error_message||file.error||file.message||''])});
    const fileNames=new Map(files.map(file=>[String(file.id),file.name||file.original_name||file.filename||file.original_filename]));
    const diagnostics=row=>[row.message,row.reason,row.error_message,row.record_no,row.values?.reference,...(row.errors||[]).map(item=>typeof item==='string'?item:[item.field,item.message].filter(Boolean).join(': ')),...(row.warnings||[]).map(item=>typeof item==='string'?item:[item.field,item.message].filter(Boolean).join(': '))].filter(Boolean).join('\n');
    tables.push({title:'Item-level outcomes',columns:cols([['Source / row',2.5],['Classification',1.6],['Outcome',1.2],['Reason / reference',3]]),rows:rows.map(row=>[[fileNames.get(String(row.file_id||row.import_file_id))||row.file_name||row.filename||'Source',row.sheet_name,row.source_row||row.row_number||row.row_index?`Row ${row.source_row||row.row_number||row.row_index}`:''].filter(Boolean).join(' / '),row.values?.classification||row.classification||'',row.outcome||row.status||'REVIEW REQUIRED',diagnostics(row)])});
    tables.push({title:'Saved import counts',columns:cols([['Outcome',3],['Count',1,'right']]),rows:Object.entries(counts||{}).filter(([,n])=>Number.isFinite(Number(n))).map(([key,n])=>[key.replace(/_/g,' '),String(n)])});
  }else if(request.type==='summary') {
    const status=new Map();for(const row of records){const key=`${row.classification} / ${row.status}`;status.set(key,(status.get(key)||0)+1);}
    tables.push({title:'Records by classification and status',columns:cols([['Classification / status',4],['Records',1,'right']]),rows:[...status].map(([key,n])=>[key,String(n)])});
  }else if(request.type==='suppliers') {
    const grouped=new Map();for(const row of records){const supplier=row.supplier_name||'Supplier not recorded';if(!grouped.has(supplier))grouped.set(supplier,[]);grouped.get(supplier).push(row);}
    for(const [supplier,list] of grouped)tables.push({title:supplier,columns:cols([['Value basis',3],['Currency',1],['Records',1,'right'],['Value',2,'right']]),rows:totalsFor(list).amounts.map(group=>[group.basis,group.currency,String(group.count),value(group.total,group.currency)]).concat([['All selected documents','',String(list.length),'']])});
  }else {
    tables.push({title:`${count} complete matching ${count===1?'record':'records'}`,columns:cols([['Reference / version',1.8],['Document / supplier',3],['Date / status',1.8],['Value basis / amount',2.7]]),rows:records.map(row=>[`${row.record_no||row.reference||'Saved record'} / v${row.revision||1}`,[row.title||row.description,row.supplier_name].filter(Boolean).join('\n'),[row.date?dateLabel(row.date):'Date not recorded',row.status].filter(Boolean).join('\n'),`${amountBasis(row)}\n${value(row.total,row.currency)}`])});
    if(['items','individual','selected'].includes(request.type))for(const row of records){
      const quantityText=line=>{if(row.native_kind!=='order')return `${row.native_kind==='receipt'?'Received: ':''}${quantity(line.quantity,line.unit)}`;const q=orderQuantities(row,line);return Object.entries(q).map(([key,n])=>`${key[0].toUpperCase()+key.slice(1)}: ${n===null?'Not recorded':quantity(n/1000,line.unit)}`).join('\n');};
      tables.push({title:`${row.record_no||row.reference||'Saved record'} — item details`,columns:cols([['Item',2.7],[row.native_kind==='order'?'Order quantities':'Quantity / unit',2.1],['Unit price',1.5,'right'],['Tax',1.3,'right'],['Line value',1.8,'right']]),rows:(row.lines||[row]).map(line=>[line.description||line.item_code||row.title||'Item',quantityText(line),value(line.unit_price,row.currency),value(line.tax??line.tax_amount??line.line_tax,row.currency),value(line.total??line.total_amount??line.line_total,row.currency)])});
      if(row.native_kind==='receipt' && row.inspection_result){const units=new Set((row.lines||[]).map(line=>line.unit));tables.push({title:'Recorded receiving inspection',columns:cols([['Field',2],['Saved value',5]]),rows:[['Result',row.inspection_result],...(units.size===1&&!units.has(null)&&!units.has(undefined)?[['Accepted',quantity(row.accepted_quantity,[...units][0])],['Rejected',quantity(row.rejected_quantity,[...units][0])]]:[['Quantity allocation','Legacy aggregate acceptance/rejection cannot be allocated to the different item units. Review the inspection record.']])]});}
      if(request.type==='individual')tables.push({title:'Document details',columns:cols([['Field',2],['Saved value',5]]),rows:[['Classification',row.classification],['Supplier',row.supplier_name||'Not recorded'],['Due / expected',row.due_date?dateLabel(row.due_date):'Not recorded'],['Net',value(row.net??row.subtotal,row.currency)],['Tax',value(row.tax??row.tax_amount,row.currency)],['Notes',row.notes||'Not recorded']]});
    }
  }
  if(!source.imports && request.type!=='individual'){
    tables.push({title:'Values separated by currency and business basis',columns:cols([['Value basis',3],['Currency',1],['Records',1,'right'],['Value',2,'right']]),rows:totals.amounts.map(group=>[group.basis,group.currency,String(group.count),value(group.total,group.currency)])});
    tables.push({title:'Quantities separated by recorded unit',columns:cols([['Quantity basis',3],['Unit',1.5],['Quantity',2,'right']]),rows:totals.quantities.map(group=>[group.basis,group.unit,quantity(group.units/1000,group.unit)])});
  }
  const filters=Object.entries(request.filters).filter(([key,v])=>v && !['sort','supplier_id'].includes(key)).map(([key,v])=>`${key.replace(/_/g,' ')}: ${key==='from_date'||key==='to_date'?dateLabel(v):v}`).join(' | ');
  const sourceLabels={entries:'Saved procurement documents','purchase-orders':'Native purchase orders',receipts:'Recorded goods receipts',requisitions:'Purchase requisitions',workflow:'Original procurement workflow',catalog:'Historical master BOM estimates'};
  return {title:source.imports?'PROCUREMENT IMPORT OUTCOMES':`PROCUREMENT ${request.type.toUpperCase()} REPORT`,reference,filename:reference,sourceVersion:1,issueDate:DateTime.fromJSDate(new Date(createdAt),{zone:'Australia/Sydney'}).toISODate(),party:'Voxel Veda procurement records',period:filters||'All authorised matching records in the selected source',tables,
    notes:[`Source: ${sourceLabels[request.source]}. Snapshot version 1; ${count} ${source.imports?(count===1?'row outcome':'row outcomes'):(count===1?'record':'records')}. Values are retained as recorded; currencies are not converted and unlike units are not combined.`,
      request.source==='catalog'?'Approved historical master BOM reference estimates; these are not placed orders, receipts, invoices or payments.':'Saved PLAN, quotation, draft purchase order and supplier-invoice documents remain document records. They do not prove an order was placed, stock received or payment made.',
      request.type!=='individual' && !source.imports?`Records without recorded currency (${totals.missingCurrency}), amount (${totals.missingAmount}) or quantity unit (${totals.missingUnit}) are not silently included in comparable totals. Archived/cancelled values remain in separate historical groups and do not represent current obligations.`:'',
      'This document records the saved source at generation. Later corrections are recorded in a new report.'].filter(Boolean)};
}
async function ensureProcurementReportSchema() {
  if(!schemaPromise)schemaPromise=pool.query(`CREATE TABLE IF NOT EXISTS procurement_report_snapshots (
    id CHAR(36) PRIMARY KEY,reference VARCHAR(70) NOT NULL,request_key CHAR(64) NOT NULL,created_by BIGINT NOT NULL,
    report_type VARCHAR(40) NOT NULL,source_kind VARCHAR(40) NOT NULL,source_sha256 CHAR(64) NOT NULL,source_json LONGTEXT NOT NULL,
    document_json LONGTEXT NOT NULL,record_count INT NOT NULL,version INT NOT NULL DEFAULT 1,
    generation_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',pdf_bytes LONGBLOB NULL,pdf_sha256 CHAR(64) NULL,pdf_pages INT NULL,
    claim_token CHAR(36) NULL,claim_expires_at DATETIME NULL,last_error TEXT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,UNIQUE KEY uniq_procurement_report_request(request_key),
    INDEX idx_procurement_report_owner(created_by,created_at)) ENGINE=InnoDB`).catch(e=>{schemaPromise=null;throw e;});
  return schemaPromise;
}
function metadata(row) {return {snapshot_id:row.id,reference:row.reference,source_hash:row.source_sha256,pdf_hash:row.pdf_sha256,pdf_pages:row.pdf_pages,version:row.version,generation_status:row.generation_status,record_count:row.record_count,last_error:row.last_error||null,preview_url:`/api/procurement/reports/snapshots/${row.id}/pdf`,download_url:`/api/procurement/reports/snapshots/${row.id}/pdf?download=1`,status_url:`/api/procurement/reports/snapshots/${row.id}`,created_at:row.created_at};}
async function snapshotAccess(user,row,db=pool) {
  authorised(user);
  const entries=require('./procurementEntryService');
  if(Number(row.created_by)!==Number(user.id) && !entries.canViewAll(user))throw error('Procurement report not found.',404,'PROCUREMENT_REPORT_NOT_FOUND');
  if(row.source_kind==='entries') {
    const source=JSON.parse(row.source_json);
    for(const record of source.records || [])await entries.assertRecordAccess({user,record});
    if(source.imports)await require('./procurementImportService').readImportReport({user,batchId:source.request.batch_id,db});
  }
  return true;
}
async function getSnapshot({user,snapshotId,db=pool}) { authorised(user);await ensureProcurementReportSchema();const [[row]]=await db.query('SELECT * FROM procurement_report_snapshots WHERE id=?',[id(snapshotId)]);if(!row)throw error('Procurement report not found.',404,'PROCUREMENT_REPORT_NOT_FOUND');await snapshotAccess(user,row,db);return row; }
async function createSnapshot({user,input,req,db=pool,documentFactory}) {
  authorised(user);const request=parseRequest(input);await ensureProcurementReportSchema();
  const conn=db===pool?await pool.getConnection():db;let source;
  try {await conn.beginTransaction();source=await loadSource(request,user,conn);await conn.commit();}catch(e){await conn.rollback().catch(()=>{});throw e;}finally{if(conn!==db)conn.release();}
  const specificData=documentFactory?documentFactory(source):null;
  if(specificData)source.document_data=cleanSnapshot(specificData);
  const hash=sourceHash(source),requestKey=sourceHash({user:Number(user.id),source_hash:hash}),now=new Date(),reference=`PRPT-${DateTime.fromJSDate(now,{zone:'Australia/Sydney'}).toFormat('yyyyMMdd')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,snapshotId=crypto.randomUUID(),data=specificData||documentData(source,reference,now);
  await db.query(`INSERT INTO procurement_report_snapshots(id,reference,request_key,created_by,report_type,source_kind,source_sha256,source_json,document_json,record_count)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE request_key=VALUES(request_key)`,[snapshotId,reference,requestKey,user.id,request.type,request.source,hash,JSON.stringify(source),JSON.stringify(data),sourceRecordCount(source)]);
  const [[row]]=await db.query('SELECT * FROM procurement_report_snapshots WHERE request_key=?',[requestKey]);
  if(row.generation_status==='VALIDATED'){await snapshotArtifact(row);return metadata(row);}
  const token=crypto.randomUUID(),[claim]=await db.query(`UPDATE procurement_report_snapshots SET generation_status='GENERATING',claim_token=?,claim_expires_at=DATE_ADD(NOW(),INTERVAL 10 MINUTE),last_error=NULL WHERE id=? AND (generation_status IN ('PENDING','GENERATION_FAILED') OR (generation_status='GENERATING' AND claim_expires_at<NOW()))`,[token,row.id]);
  if(!claim.affectedRows)return metadata(row);
  try{
    const artifact=await createDocumentPdf(JSON.parse(row.document_json));
    const write=db===pool?await pool.getConnection():db;
    try{await write.beginTransaction();const [saved]=await write.query(`UPDATE procurement_report_snapshots SET generation_status='VALIDATED',pdf_bytes=?,pdf_sha256=?,pdf_pages=?,claim_token=NULL,claim_expires_at=NULL WHERE id=? AND claim_token=? AND generation_status='GENERATING'`,[artifact.buffer,artifact.validation.sha256,artifact.validation.pages,row.id,token]);if(saved.affectedRows!==1)throw error('The report generation lease changed. Refresh its status.',409,'PROCUREMENT_REPORT_CLAIM_CHANGED');await logAudit(write,{actorId:user.id,action:'PROCUREMENT_REPORT_VALIDATED',module:'procurement',recordType:'report_snapshot',recordId:row.id,newValue:{reference:row.reference,source_hash:hash,pdf_hash:artifact.validation.sha256,pages:artifact.validation.pages,count:row.record_count},ipAddress:req?.ip,userAgent:req?.get?.('user-agent')});await write.commit();}catch(e){await write.rollback().catch(()=>{});throw e;}finally{if(write!==db)write.release();}
    Object.assign(row,{generation_status:'VALIDATED',pdf_bytes:artifact.buffer,pdf_sha256:artifact.validation.sha256,pdf_pages:artifact.validation.pages,last_error:null});return metadata(row);
  }catch(e){await db.query("UPDATE procurement_report_snapshots SET generation_status='GENERATION_FAILED',last_error=?,claim_token=NULL,claim_expires_at=NULL WHERE id=? AND claim_token=? AND generation_status<>'VALIDATED'",[String(e.message).slice(0,1500),row.id,token]);e.snapshot_id=row.id;throw e;}
}
async function snapshotArtifact(row) {
  if(row.generation_status!=='VALIDATED' || !Buffer.isBuffer(row.pdf_bytes))throw error('This PDF is not validated yet. Retry report generation after reviewing its failure.',409,'PROCUREMENT_PDF_PENDING');
  const source=JSON.parse(row.source_json),data=JSON.parse(row.document_json);
  if(sourceHash(source)!==row.source_sha256)throw pdfError('The retained procurement source snapshot failed integrity validation.','PDF_SNAPSHOT_MISMATCH');
  if(source.request.source!==row.source_kind || source.request.type!==row.report_type || sourceRecordCount(source)!==Number(row.record_count))throw pdfError('The procurement snapshot identity does not match its retained report.','PDF_SNAPSHOT_MISMATCH');
  const checked=await validateDocumentPdf(row.pdf_bytes,data);
  if(checked.sha256!==row.pdf_sha256 || checked.pages!==Number(row.pdf_pages))throw pdfError('The retained procurement PDF failed integrity validation.','PDF_SNAPSHOT_MISMATCH');
  return {buffer:row.pdf_bytes,filename:safePdfFilename(data.filename||row.reference),sha256:checked.sha256,validation:checked};
}
module.exports={createSnapshot,getSnapshot,snapshotAccess,snapshotArtifact,metadata,ensureProcurementReportSchema,_test:{parseRequest,totalsFor,documentData,loadSource,nativeRows,sourceHash,value,quantity}};
