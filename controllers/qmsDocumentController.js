'use strict';
const pool = require('../config/db');
const { createDocumentPdf, sendPdfResponse } = require('../services/documentPdfService');
function label(value) { return String(value).replace(/_/g,' ').replace(/\b\w/g, char=>char.toUpperCase()); }
exports.recordPdf = async(req,res) => {
  try {
    const [[record]] = await pool.query('SELECT * FROM qms_records WHERE id=? OR record_uuid=? LIMIT 1',[req.params.id,req.params.id]);
    if (!record) return res.status(404).json({message:'Controlled record not found.'});
    const values = typeof record.values_json === 'string' ? JSON.parse(record.values_json) : record.values_json || {};
    const artifact = await createDocumentPdf({title:record.document_title,reference:record.record_no || record.document_id,filename:record.record_no || record.document_id,issueDate:record.updated_at || record.created_at,
      columns:[{label:'Field',width:2},{label:'Recorded value',width:4}],rows:Object.entries(values).map(([key,value])=>[label(key),typeof value==='object'?JSON.stringify(value):String(value??'')]),
      notes:[`Review status: ${record.status}. Document revision: ${record.source_revision}. Record revision: ${record.record_revision}.`,record.status==='APPROVED'?'Approved controlled record.':'This record has not completed approval.']});
    return await sendPdfResponse(res,artifact,Boolean(req.query.download));
  } catch(error) {return res.status(error.status || 500).json({message:error.message,code:error.code || 'PDF_GENERATION_FAILED'});}
};
exports.draftPdf = async(req,res) => {
  try {
    const {title,reference,updatedAt,fields}=req.body;
    const errors={};
    if (!String(title||'').trim() || String(title).length>150) errors.title='Enter a title of up to 150 characters.';
    if (!Array.isArray(fields) || !fields.length || fields.length>100) errors.fields='Provide between 1 and 100 form fields.';
    if (Array.isArray(fields)) fields.forEach((field,index)=>{if(!field || !String(field.label||'').trim() || String(field.label).length>120 || String(field.value??'').length>4000)errors[`fields.${index}`]='Each field needs a label and a value of up to 4000 characters.';});
    if(Object.keys(errors).length)return res.status(422).json({message:'Check the form document fields.',errors});
    const artifact=await createDocumentPdf({title:String(title),reference:String(reference||'Local draft').slice(0,80),filename:title,issueDate:updatedAt || new Date().toISOString(),
      columns:[{label:'Field',width:2},{label:'Draft value',width:4}],rows:fields.map(field=>[field.label,String(field.value??'')]),notes:['Unreviewed local draft. Save the record to controlled quality records and complete the required approval before use as approved evidence.']});
    return await sendPdfResponse(res,artifact,Boolean(req.query.download));
  } catch(error) {return res.status(error.status || 500).json({message:error.message,code:error.code || 'PDF_GENERATION_FAILED'});}
};
