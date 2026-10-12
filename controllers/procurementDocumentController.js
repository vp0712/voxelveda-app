'use strict';
const pool = require('../config/db');
const { createDocumentPdf, sendPdfResponse, money, dateLabel, pdfError } = require('../services/documentPdfService');
const { queueDocumentEmail } = require('../services/documentDeliveryService');
const { validateRecipients } = require('../services/emailService');
const { logAudit }=require('../services/auditService');
const emailableStatuses=['APPROVED','ISSUED','PART_RECEIVED','RECEIVED','PARTIALLY_RECEIVED'];
async function load(id,db=pool,lock=false) {
  if(db===pool){const conn=await pool.getConnection();try{await conn.beginTransaction();const result=await load(id,conn);await conn.commit();return result;}catch(error){await conn.rollback();throw error;}finally{conn.release();}}
  const [[order]] = await db.query(`SELECT po.*,s.supplier_name,s.email FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id WHERE po.id=?${lock?' FOR UPDATE':''}`, [id]);
  if (!order) throw Object.assign(new Error('Purchase order not found.'), { status: 404 });
  const [items] = await db.query('SELECT * FROM purchase_order_items WHERE purchase_order_id=? ORDER BY line_no,id', [id]);
  const sum = key => Math.round(items.reduce((total, row) => total + Number(row[key]), 0) * 100) / 100;
  if (!items.length || Math.abs(sum('line_total') - Number(order.total_amount)) > 0.02 || Math.abs(sum('line_tax') - Number(order.tax_amount)) > 0.02 || Math.abs(sum('line_subtotal') - Number(order.subtotal)) > 0.02) throw pdfError('Purchase order item totals do not match its saved totals. Review the purchase order first.', 'PDF_TOTAL_MISMATCH');
  return { order, data: { title: order.status === 'DRAFT' ? 'DRAFT PURCHASE ORDER' : 'PURCHASE ORDER', reference: order.po_number, filename: order.po_number, issueDate: order.issue_date,
    party: `${order.supplier_name}${order.email ? ` | ${order.email}` : ''}`, columns: [{label:'Description',width:3.5},{label:'Quantity',width:1,align:'right'},{label:'Unit',width:0.7},{label:'Unit price',width:1.5,align:'right'},{label:'Tax',width:1.3,align:'right'},{label:'Total',width:1.6,align:'right'}],
    rows: items.map(row=>[row.description, row.quantity,row.unit,money(row.unit_price,order.currency),money(row.line_tax,order.currency),money(row.line_total,order.currency)]),
    totals: [{label:'Subtotal',value:money(order.subtotal,order.currency)},{label:'Tax',value:money(order.tax_amount,order.currency)},{label:'Order total',value:money(order.total_amount,order.currency)}],
    notes: [order.expected_date ? `Expected date: ${dateLabel(order.expected_date)}` : '',order.delivery_address ? `Delivery address: ${order.delivery_address}` : '',order.payment_terms ? `Terms: ${order.payment_terms}` : '',order.notes].filter(Boolean) } };
}
exports.pdf = async (req,res) => {
  try { return await sendPdfResponse(res, await createDocumentPdf((await load(req.params.id)).data), Boolean(req.query.download)); }
  catch(error) { return res.status(error.status || 500).json({message:error.message,code:error.code || 'PDF_GENERATION_FAILED'}); }
};
exports.send = async (req,res) => {
  try {
    const {order,data} = await load(req.params.id);
    if (!emailableStatuses.includes(order.status)) return res.status(409).json({message:'The purchase order must be approved before sending it.'});
    const delivery = await queueDocumentEmail({module:'procurement',recordId:order.id,data,to:validateRecipients(req.body.email || order.email,'to'),subject:`Voxel Veda purchase order ${order.po_number}`,text:`Purchase order ${order.po_number} is attached as a PDF.`,createdBy:req.user.id,
      beforeQueue:async conn=>{const current=await load(order.id,conn,true);if(!emailableStatuses.includes(current.order.status) || JSON.stringify(current.data)!==JSON.stringify(data))throw pdfError('The purchase order changed while rendering. Review its latest version and approval before retrying.','PDF_DOCUMENT_CHANGED');},
      afterQueue:async(conn,queueId)=>logAudit(conn,{actorId:req.user.id,action:'PURCHASE_ORDER_EMAIL_QUEUED',module:'procurement',recordType:'purchase_order',recordId:String(order.id),newValue:{reference:order.po_number,email_queue_id:queueId},ipAddress:req.ip,userAgent:req.get?.('user-agent')})
    });
    return res.json({message:delivery.provider_accepted?'The provider accepted this purchase order email. Recipient receipt is unverified.':'Purchase order PDF validated and queued for email delivery.',email_sent:false,email_queued:true,...delivery});
  } catch(error) { return res.status(error.status || 400).json({message:error.message,code:error.code || 'DOCUMENT_EMAIL_FAILED',email_sent:false,document_request_id:error.document_request_id || null}); }
};
exports._test = {load};
