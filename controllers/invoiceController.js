const pool = require('../config/db');
const { customerScoped, customerEmail, assertCustomerRecord } = require('../services/customerRecordScope');
const { createDocumentPdf, sendPdfResponse, money, pdfError } = require('../services/documentPdfService');
const { invoiceDocumentData, statementDocumentData, blankInvoiceDocumentData } = require('../services/invoiceDocumentService');
const { queueDocumentEmail } = require('../services/documentDeliveryService');
const { validateRecipients } = require('../services/emailService');
const { randomUUID, createHash } = require('node:crypto');
const {hasPermission}=require('../services/authorizationService');
const urls = require('../config/urls');
const {dateOnly}=require('../utils/dateOnly');
const {
  emailFailureDetails,
  isEmailTransportError
} = require('../services/emailService');

function emailDeliveryFailure(res, error) {
  if (!isEmailTransportError(error) && !String(error.code || '').startsWith('PDF_')) return false;
  const details = emailFailureDetails(error);
  res.status(details.status).json({ ...details, document_request_id: error.document_request_id || null, email_sent: false });
  return true;
}

async function applyInvoiceSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_no VARCHAR(80) NULL,
      rfq_id INT NULL,
      customer_name VARCHAR(255) NULL,
      customer_email VARCHAR(255) NULL,
      description TEXT NULL,
      quantity DECIMAL(12,3) NOT NULL DEFAULT 1,
      unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      gst_rate DECIMAL(5,2) NOT NULL DEFAULT 10,
      total DECIMAL(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(40) NOT NULL DEFAULT 'draft',
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoice_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_id INT NOT NULL,
      product_name VARCHAR(255) NULL,
      description TEXT NULL,
      qty DECIMAL(12,3) NULL,
      quantity DECIMAL(12,3) NOT NULL DEFAULT 1,
      unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      total DECIMAL(12,2) NULL,
      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_invoice_items_invoice_id (invoice_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoice_activity (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_id INT NOT NULL,
      action_type VARCHAR(60) NOT NULL,
      notes LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by INT NULL,
      INDEX idx_invoice_activity_invoice_id (invoice_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoice_payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_id INT NOT NULL,
      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      payment_date DATE NULL,
      method VARCHAR(80) NULL,
      reference VARCHAR(120) NULL,
      notes TEXT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_invoice_payments_invoice_id (invoice_id)
    )
  `);

  await pool.query(`ALTER TABLE invoices ADD COLUMN invoice_no VARCHAR(80) NULL`).catch(invoiceColumnError);
  await pool.query(`ALTER TABLE invoices ADD COLUMN rfq_id INT NULL`).catch(invoiceColumnError);
  await pool.query(`ALTER TABLE invoices ADD COLUMN customer_name VARCHAR(255) NULL`).catch(invoiceColumnError);
  await pool.query(`ALTER TABLE invoices ADD COLUMN customer_email VARCHAR(255) NULL`).catch(invoiceColumnError);
  await pool.query(`ALTER TABLE invoices ADD COLUMN description TEXT NULL`).catch(invoiceColumnError);
  await pool.query(`ALTER TABLE invoices ADD COLUMN quantity DECIMAL(12,3) NOT NULL DEFAULT 1`).catch(invoiceColumnError);
  await pool.query(`ALTER TABLE invoices ADD COLUMN unit_price DECIMAL(12,2) NOT NULL DEFAULT 0`).catch(invoiceColumnError);
  await pool.query(`ALTER TABLE invoices ADD COLUMN gst_rate DECIMAL(5,2) NOT NULL DEFAULT 10`).catch(invoiceColumnError);
  await pool.query(`ALTER TABLE invoices ADD COLUMN total DECIMAL(12,2) NOT NULL DEFAULT 0`).catch(invoiceColumnError);
  await pool.query(`ALTER TABLE invoices ADD COLUMN status VARCHAR(40) NOT NULL DEFAULT 'draft'`).catch(invoiceColumnError);
  await pool.query(`ALTER TABLE invoices ADD COLUMN deleted TINYINT(1) NOT NULL DEFAULT 0`).catch(invoiceColumnError);
  await pool.query(`ALTER TABLE invoices ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`).catch(invoiceColumnError);
  await pool.query(`ALTER TABLE invoices ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`).catch(invoiceColumnError);

  await pool.query(`ALTER TABLE invoice_items ADD COLUMN product_name VARCHAR(255) NULL`).catch(invoiceColumnError);
  await pool.query(`ALTER TABLE invoice_items ADD COLUMN qty DECIMAL(12,3) NULL`).catch(invoiceColumnError);
  await pool.query(`ALTER TABLE invoice_items ADD COLUMN unit_price DECIMAL(12,2) NOT NULL DEFAULT 0`).catch(invoiceColumnError);
  await pool.query(`ALTER TABLE invoice_items ADD COLUMN total DECIMAL(12,2) NULL`).catch(invoiceColumnError);
  await pool.query(`ALTER TABLE invoice_items ADD COLUMN description TEXT NULL`).catch(invoiceColumnError);
  await pool.query(`ALTER TABLE invoice_items ADD COLUMN quantity DECIMAL(12,3) NOT NULL DEFAULT 1`).catch(invoiceColumnError);
  await pool.query(`ALTER TABLE invoice_items ADD COLUMN amount DECIMAL(12,2) NOT NULL DEFAULT 0`).catch(invoiceColumnError);
  await addInvoiceColumn('ALTER TABLE invoice_items ADD COLUMN deleted TINYINT(1) NOT NULL DEFAULT 0');
  await addInvoiceColumn('ALTER TABLE invoices ADD COLUMN request_key CHAR(64) NULL');
  await addInvoiceColumn('ALTER TABLE invoices ADD COLUMN document_revision INT NOT NULL DEFAULT 1');
  await addInvoiceColumn('ALTER TABLE invoices ADD COLUMN request_payload_sha256 CHAR(64) NULL');
  await addInvoiceColumn('ALTER TABLE invoices ADD UNIQUE KEY uniq_invoice_request(request_key)');
  await addInvoiceColumn('ALTER TABLE invoice_payments ADD COLUMN request_key CHAR(64) NULL');
  await addInvoiceColumn('ALTER TABLE invoice_payments ADD COLUMN request_payload_sha256 CHAR(64) NULL');
  await addInvoiceColumn('ALTER TABLE invoice_payments ADD UNIQUE KEY uniq_invoice_payment_request(request_key)');
  await addInvoiceColumn('ALTER TABLE invoice_activity ADD COLUMN created_by INT NULL');
  await pool.query('ALTER TABLE invoice_activity MODIFY COLUMN notes LONGTEXT NULL');
  await addInvoiceColumn('ALTER TABLE invoice_payments ADD COLUMN voided_at DATETIME NULL');
  await addInvoiceColumn('ALTER TABLE invoice_payments ADD COLUMN voided_by INT NULL');

}

function invoiceColumnError(error) { if (!['ER_DUP_FIELDNAME','ER_DUP_KEYNAME'].includes(error.code)) throw error; }
async function addInvoiceColumn(sql) { try { await pool.query(sql); } catch(error) { invoiceColumnError(error); } }
let invoiceSchemaPromise;
function ensureInvoiceColumns() { if (!invoiceSchemaPromise) invoiceSchemaPromise = applyInvoiceSchema().catch(error => { invoiceSchemaPromise=null; throw error; }); return invoiceSchemaPromise; }

async function ensureInvoiceCustomerTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_name VARCHAR(180) NOT NULL,
      contact_name VARCHAR(180) NULL,
      email VARCHAR(180) NULL,
      phone VARCHAR(80) NULL,
      address TEXT NULL,
      notes TEXT NULL,
      file_link TEXT NULL,
      created_by INT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      deleted TINYINT(1) NOT NULL DEFAULT 0
    )
  `);
}

async function rememberManualInvoiceCustomer(conn, { customerName, customerEmail, userId }) {
  const name = String(customerName || '').trim();
  const email = String(customerEmail || '').trim();
  if (!name || !email) return;

  const [[existing]] = await conn.query(
    'SELECT id FROM customers WHERE LOWER(email) = LOWER(?) AND deleted = 0 LIMIT 1',
    [email]
  );

  if (existing) {
    // Invoice creation must not overwrite an existing customer identity.
    return;
  }

  await conn.query(
    `
    INSERT INTO customers
      (company_name, email, notes, created_by)
    VALUES (?, ?, ?, ?)
    `,
    [name, email, 'Created automatically from manual invoice history.', userId || null]
  );
}

function invoiceReceivableSelect(whereClause = 'WHERE i.deleted = 0 OR i.deleted IS NULL') {
  return `
    SELECT
      i.*,
      COALESCE(p.paid_amount, 0) AS paid_amount,
      CASE WHEN i.total IS NULL THEN NULL ELSE GREATEST(i.total - COALESCE(p.paid_amount, 0), 0) END AS balance_due,
      CASE
        WHEN COALESCE(p.paid_amount, 0) <= 0 THEN 'unpaid'
        WHEN COALESCE(p.paid_amount, 0) >= COALESCE(i.total, 0) THEN 'paid'
        ELSE 'partial'
      END AS payment_state
    FROM invoices i
    LEFT JOIN (
      SELECT invoice_id, SUM(amount) AS paid_amount
      FROM invoice_payments
      WHERE voided_at IS NULL
      GROUP BY invoice_id
    ) p ON p.invoice_id = i.id
    ${whereClause}
  `;
}

async function getInvoiceWithReceivables(invoiceId, db = pool) {
  const [[invoice]] = await db.query(
    `${invoiceReceivableSelect('WHERE i.id = ? AND (i.deleted = 0 OR i.deleted IS NULL)')} LIMIT 1`,
    [invoiceId]
  );
  return invoice;
}

function cleanPhoneForWhatsApp(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

async function buildCustomerStatementData({ search = '', customer_email = '', customer_name = '' }, user) {
  if (customerScoped(user)) {
    if (customer_email) assertCustomerRecord(user, customer_email);
    customer_email = customerEmail(user); customer_name = ''; search = '';
    if (!customer_email) throw Object.assign(new Error('Customer record not found.'), {status:404});
  }
  await ensureInvoiceColumns();

  const where = [];
  const params = [];

  if (customer_email) {
    where.push('LOWER(customer_email) = LOWER(?)');
    params.push(customer_email);
  } else if (customer_name) {
    where.push('LOWER(customer_name) = LOWER(?)');
    params.push(customer_name);
  }

  if (!where.length && search) {
    where.push('(customer_name LIKE ? OR customer_email LIKE ? OR invoice_no LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (!where.length) {
    throw new Error('Customer name, email, or search text is required');
  }

  const [invoices] = await pool.query(
    `
    SELECT *
    FROM (${invoiceReceivableSelect()}) receivables
    WHERE ${where.join(' OR ')}
    ORDER BY created_at ASC, id ASC
    `,
    params
  );

  const identities=new Set(invoices.map(invoice=>String(invoice.customer_email || `name:${invoice.customer_name || ''}`).trim().toLowerCase()));
  if(identities.size>1)throw Object.assign(new Error('Select one customer from the search matches before generating a statement.'),{status:422,code:'STATEMENT_CUSTOMER_AMBIGUOUS'});

  const invoiceIds = invoices.map((invoice) => Number(invoice.id)).filter(Boolean);
  let payments = [];

  if (invoiceIds.length) {
    const placeholders = invoiceIds.map(() => '?').join(',');
    const [rows] = await pool.query(
      `
      SELECT p.*, i.invoice_no, i.customer_name, i.customer_email
      FROM invoice_payments p
      JOIN invoices i ON i.id = p.invoice_id
      WHERE p.invoice_id IN (${placeholders}) AND p.voided_at IS NULL
      ORDER BY p.payment_date ASC, p.id ASC
      `,
      invoiceIds
    );
    payments = rows;
  }

  const totals = invoices.reduce((acc, invoice) => {
    acc.invoice_value += Number(invoice.total || 0);
    acc.paid += Number(invoice.paid_amount || 0);
    acc.balance_due += Number(invoice.balance_due || 0);
    return acc;
  }, { invoice_value: 0, paid: 0, balance_due: 0 });

  const first = invoices[0] || {};
  return {
    customer: {
      name: customer_name || first.customer_name || search || 'Customer',
      email: customer_email || first.customer_email || ''
    },
    invoices,
    payments,
    totals
  };
}

/* ================= CREATE FROM RFQ ================= */

exports.createInvoice = async (req,res) => {
  let conn;
  try {
    await ensureInvoiceColumns();
    const id=Number(req.body.rfq_id);
    if(!Number.isSafeInteger(id)||id<1)return res.status(422).json({message:'Choose a valid RFQ.',errors:{rfq_id:'A valid RFQ reference is required.'}});
    conn=await pool.getConnection();await conn.beginTransaction();
    const [[rfq]]=await conn.query('SELECT * FROM rfqs WHERE id=? FOR UPDATE',[id]);
    if(!rfq){await conn.rollback();return res.status(404).json({message:'RFQ not found.'});}
    assertCustomerRecord(req.user, rfq.email);
    const [[existing]]=await conn.query('SELECT id,invoice_no FROM invoices WHERE rfq_id=? AND IFNULL(deleted,0)=0 ORDER BY id DESC LIMIT 1',[id]);
    if(existing){await conn.commit();return res.json({message:'Invoice already exists for this RFQ.',invoice_id:existing.id,invoice_no:existing.invoice_no,existing:true});}
    if(String(rfq.status).toLowerCase()!=='approved'){await conn.rollback();return res.status(409).json({message:'Approve the RFQ before creating its invoice.',current_status:rfq.status});}
    const price=Number(req.body.unit_price ?? rfq.unit_price ?? rfq.approved_unit_price),quantity=Number(rfq.quantity),rate=Number(req.body.gst_rate ?? 10);
    const errors={};
    if(req.body.unit_price === '' || !validDecimal(price,2,99999999.99))errors.unit_price='Enter the approved unit price with at most two decimal places; no price is assumed.';
    if(!validDecimal(quantity,3,999999999.999,false))errors.quantity='The RFQ quantity must be positive with at most three decimal places.';
    if(req.body.gst_rate==='' || !validDecimal(rate,2,100))errors.gst_rate='Enter a GST rate from 0 to 100 with at most two decimal places.';
    if(Object.keys(errors).length){await conn.rollback();return res.status(422).json({message:'Check the RFQ invoice values.',errors});}
    const subtotal=Math.round(quantity*price*100)/100,total=Math.round((subtotal+Math.round(subtotal*rate)/100)*100)/100;
    if(!Number.isFinite(total)||total>9999999999.99){await conn.rollback();return res.status(422).json({message:'The RFQ invoice total exceeds the supported amount.',errors:{total:'Review the RFQ quantity and approved price.'}});}
    const reference=`INV-${Date.now()}-${randomUUID().slice(0,6).toUpperCase()}`,description=rfq.application || rfq.material;
    const [insert]=await conn.query(`INSERT INTO invoices(invoice_no,rfq_id,customer_name,customer_email,description,quantity,unit_price,gst_rate,total,status) VALUES(?,?,?,?,?,?,?,?,?,'draft')`,[reference,id,rfq.customer_name,rfq.email,description,quantity,price,rate,total]);
    await conn.query('INSERT INTO invoice_items(invoice_id,description,quantity,unit_price,amount) VALUES(?,?,?,?,?)',[insert.insertId,description,quantity,price,subtotal]);
    await conn.query("UPDATE rfqs SET status='quoted' WHERE id=?",[id]);
    await logInvoiceActivity(insert.insertId,'created',`Created from RFQ-${id}; approved unit price ${price}.`,req.user?.id,conn);
    await conn.commit();return res.status(201).json({message:'RFQ invoice draft created.',invoice_id:insert.insertId,invoice_no:reference});
  } catch(error){if(conn)await conn.rollback();return res.status(500).json({message:'Unable to create the RFQ invoice. Please retry.'});}
  finally{if(conn)conn.release();}
};

function validDecimal(value, decimals, max, allowZero=true) {
  const number=Number(value);return Number.isFinite(number) && (allowZero?number>=0:number>0) && number<=max && Math.abs(number*10**decimals-Math.round(number*10**decimals))<0.0001;
}
function cleanInvoiceInput(body,editing=false) {
  const errors={},name=String(body.customer_name || '').trim(),email=String(body.customer_email || '').trim(),rate=Number(body.gst_rate ?? 10);
  if(!name || name.length>180)errors.customer_name='Enter a customer name of up to 180 characters.';
  if(email.length>180 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))errors.customer_email='Enter a valid customer email address of up to 180 characters.';
  if(body.gst_rate==='' || !validDecimal(rate,2,100))errors.gst_rate='Enter a GST rate from 0 to 100 with at most two decimal places.';
  const source=Array.isArray(body.items)?body.items:[];
  if(!source.length||source.length>100)errors.items='Provide between 1 and 100 invoice items.';
  const items=source.slice(0,100).map((item,index)=>{
    const description=String(item?.description || '').trim(),quantity=Number(item?.quantity),unitPrice=Number(item?.unit_price);
    if(!description || description.length>2000)errors[`items.${index}.description`]='Enter a description of up to 2,000 characters.';
    if(!validDecimal(quantity,3,999999999.999,false))errors[`items.${index}.quantity`]='Enter a positive quantity with at most three decimal places.';
    if(item?.unit_price===undefined || item?.unit_price===null || item?.unit_price==='' || !validDecimal(unitPrice,2,99999999.99))errors[`items.${index}.unit_price`]='Enter a nonnegative unit price with at most two decimal places.';
    const amount=Math.round(quantity*unitPrice*100)/100;
    if(!Number.isFinite(amount)||amount>9999999999.99)errors[`items.${index}.amount`]='This line exceeds the supported invoice amount.';
    return {description,quantity,unitPrice,amount};
  });
  const subtotal=Math.round(items.reduce((sum,item)=>sum+item.amount,0)*100)/100,gst=Math.round(subtotal*rate)/100,total=Math.round((subtotal+gst)*100)/100;
  if(!Number.isFinite(total)||total>9999999999.99)errors.total='Invoice total exceeds the supported amount.';
  if(Object.keys(errors).length)throw Object.assign(new Error('Check the invoice fields.'),{status:422,errors});
  return {name,email,rate,items,subtotal,total};
}
function requestIdentity(req,scope,payload) {
  const source=JSON.stringify(payload),payloadHash=createHash('sha256').update(source).digest('hex');
  const key=String(req.get?.('Idempotency-Key') || '').trim();
  if(key.length>180 || /[\r\n]/.test(key))throw Object.assign(new Error('The request key is invalid.'),{status:422,errors:{request_key:'Use a request key of up to 180 characters.'}});
  return {payloadHash,requestKey:createHash('sha256').update(`${scope}:${req.user?.id || ''}:${key || payloadHash}`).digest('hex')};
}
function invoiceError(res,error) {return res.status(error.status || (error.code==='ER_DUP_ENTRY'?409:500)).json({message:error.status?error.message:'The invoice operation could not complete. Please retry.',errors:error.errors,code:error.code});}
async function writeInvoiceItems(conn,id,items) {
  for(const item of items)await conn.query('INSERT INTO invoice_items(invoice_id,description,quantity,unit_price,amount) VALUES(?,?,?,?,?)',[id,item.description,item.quantity,item.unitPrice,item.amount]);
}
exports.createManualInvoice=async(req,res)=>{
  let conn;
  try {
    const clean=cleanInvoiceInput(req.body),identity=requestIdentity(req,'manual-invoice',clean);
    assertCustomerRecord(req.user, clean.email);
    await ensureInvoiceColumns();await ensureInvoiceCustomerTable();
    conn=await pool.getConnection();await conn.beginTransaction();
    const [[existing]]=await conn.query('SELECT id,invoice_no,total,request_payload_sha256 FROM invoices WHERE request_key=? LIMIT 1 FOR UPDATE',[identity.requestKey]);
    if(existing){
      await conn.commit();
      if(existing.request_payload_sha256!==identity.payloadHash)return res.status(409).json({message:'This request key was already used for different invoice data. Start a new invoice request.'});
      return res.json({message:'The invoice was already saved.',invoice_id:existing.id,invoice_no:existing.invoice_no,total:Number(existing.total),existing:true});
    }
    const reference=`INV-${Date.now()}-${randomUUID().slice(0,6).toUpperCase()}`;
    const first=clean.items[0];
    const [insert]=await conn.query(`INSERT INTO invoices(invoice_no,rfq_id,customer_name,customer_email,description,quantity,unit_price,gst_rate,total,status,request_key,request_payload_sha256) VALUES(?,NULL,?,?,?,?,?,?,?,'draft',?,?)`,[reference,clean.name,clean.email,first.description,first.quantity,first.unitPrice,clean.rate,clean.total,identity.requestKey,identity.payloadHash]);
    await writeInvoiceItems(conn,insert.insertId,clean.items);
    await rememberManualInvoiceCustomer(conn,{customerName:clean.name,customerEmail:clean.email,userId:req.user?.id});
    await logInvoiceActivity(insert.insertId,'created',JSON.stringify({customer:clean.name,item_count:clean.items.length,total:clean.total,gst_rate:clean.rate}),req.user?.id,conn);
    await conn.commit();return res.status(201).json({message:'Manual invoice saved.',invoice_id:insert.insertId,invoice_no:reference,total:clean.total,existing:false});
  }catch(error){if(conn)await conn.rollback();return invoiceError(res,error);}finally{if(conn)conn.release();}
};

/* ================= GET INVOICES ================= */

exports.getInvoices = async (req, res) => {
  try {
    await ensureInvoiceColumns();
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1), limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 50));
    const filters = [], params = [];
    const archived=req.query.archived==='true';
    if(archived&&!hasPermission(req.user,'VOID_TRANSACTION'))return res.status(403).json({message:'Archived invoice access is not permitted.'});
    if (customerScoped(req.user)) { filters.push('LOWER(customer_email)=?'); params.push(customerEmail(req.user) || 'no-authorised-customer'); }
    if (req.query.search) { filters.push('(invoice_no LIKE ? OR customer_name LIKE ? OR customer_email LIKE ?)'); params.push(...Array(3).fill(`%${String(req.query.search).slice(0, 120)}%`)); }
    if (req.query.status) { filters.push('status=?'); params.push(String(req.query.status).toLowerCase()); }
    if (req.query.payment_state) { filters.push('payment_state=?'); params.push(String(req.query.payment_state)); }
    if(req.query.from){if(dateOnly(req.query.from)!==req.query.from)return res.status(422).json({message:'Enter a valid start date.',errors:{from:'Enter a valid calendar date.'}});filters.push('DATE(created_at)>=?');params.push(req.query.from);}
    if(req.query.to){if(dateOnly(req.query.to)!==req.query.to)return res.status(422).json({message:'Enter a valid end date.',errors:{to:'Enter a valid calendar date.'}});filters.push('DATE(created_at)<=?');params.push(req.query.to);}
    if(req.query.from&&req.query.to&&req.query.from>req.query.to)return res.status(422).json({message:'Start date must not follow end date.',errors:{to:'Choose an end date on or after the start date.'}});
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const select=invoiceReceivableSelect(archived?'WHERE i.deleted=1':undefined);
    const sorts = { date: 'created_at', customer: 'customer_name', total: 'total', balance: 'balance_due', reference: 'invoice_no',status:'status' };
    const sort = Object.hasOwn(sorts,req.query.sort) ? sorts[req.query.sort] : 'id';
    const direction = String(req.query.direction).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const [[count]] = await pool.query(`SELECT COUNT(*) total FROM (${select}) records ${where}`, params);
    const [[totals]] = await pool.query(`SELECT SUM(total) total_value,SUM(paid_amount) paid_value,SUM(balance_due) balance_value,SUM(total IS NULL) missing_total,SUM(paid_amount IS NULL) missing_paid,SUM(balance_due IS NULL) missing_balance FROM (${select}) records ${where}`,params);
    const [rows] = await pool.query(`SELECT * FROM (${select}) records ${where} ORDER BY ${sort} ${direction},id ${direction} LIMIT ? OFFSET ?`, [...params, limit, (page-1)*limit]);
    const summary={};for(const [field,missing]of [['total_value','missing_total'],['paid_value','missing_paid'],['balance_value','missing_balance']])summary[field]=Number(count.total)===0?0:Number(totals[missing])>0||totals[field]==null?null:Number(totals[field]);
    return res.json({ invoices: rows, total: Number(count.total), page, limit,summary });
  } catch (error) { return invoiceError(res,error); }
};

exports.getInvoiceDetails = async (req, res) => {
  try {
    await ensureInvoiceColumns();

    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ message: 'Invoice ID required' });

    const archived=req.query.archived==='true';
    if(archived&&!hasPermission(req.user,'VOID_TRANSACTION'))return res.status(403).json({message:'Archived invoice access is not permitted.'});
    const invoice = archived?(await pool.query(`${invoiceReceivableSelect('WHERE i.id=? AND i.deleted=1')} LIMIT 1`,[id]))[0][0]:await getInvoiceWithReceivables(id);

    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    assertCustomerRecord(req.user, invoice.customer_email);

    const [items] = await pool.query(
      'SELECT * FROM invoice_items WHERE invoice_id = ? AND IFNULL(deleted,0)=0 ORDER BY id ASC',
      [id]
    );

    const [payments] = await pool.query(
      'SELECT * FROM invoice_payments WHERE invoice_id = ? AND voided_at IS NULL ORDER BY payment_date ASC, id ASC',
      [id]
    );

    const [activity] = await pool.query('SELECT * FROM invoice_activity WHERE invoice_id=? ORDER BY created_at DESC,id DESC LIMIT 100', [id]);
    const [delivery] = await pool.query("SELECT id,status,attempts,last_error,message_id,sent_at FROM email_queue WHERE related_module='invoices' AND related_record_id=? ORDER BY id DESC LIMIT 10", [String(id)]);
    res.json({ invoice, items, payments, activity, delivery });
  } catch (err) {
    console.error('GET INVOICE DETAILS ERROR FULL:', err);
    invoiceError(res,err);
  }
};
exports.paymentReceipt=async(req,res)=>{
 try{await ensureInvoiceColumns();const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(422).json({message:'Choose a valid invoice.'});
 const invoice=await getInvoiceWithReceivables(id);if(!invoice)return res.status(404).json({message:'Invoice not found.'});assertCustomerRecord(req.user,invoice.customer_email);
 if(!req.get('Idempotency-Key'))return res.status(422).json({message:'The original payment request identity is required.'});
 const identity=requestIdentity(req,`invoice-payment:${id}`,{});const [[payment]]=await pool.query('SELECT id,amount,voided_at FROM invoice_payments WHERE invoice_id=? AND request_key=? LIMIT 1',[id,identity.requestKey]);
 res.set('Cache-Control','no-store').json({confirmed:Boolean(payment),payment_id:payment?.id||null,voided:Boolean(payment?.voided_at),invoice});
 }catch(error){return invoiceError(res,error);}
};

exports.searchCustomerStatements = async (req, res) => {
  try {
    await ensureInvoiceColumns();

    const search = String(req.query.search || '').trim();
    if (search.length < 2) {
      return res.json({ matches: [] });
    }

    const customerFilter = customerScoped(req.user) ? 'AND LOWER(customer_email)=?' : '';
    const [matches] = await pool.query(
      `
      SELECT
        COALESCE(NULLIF(customer_email, ''), CONCAT('name:', customer_name)) AS customer_key,
        COALESCE(NULLIF(customer_name, ''), 'Customer') AS customer_name,
        COALESCE(customer_email, '') AS customer_email,
        COUNT(*) AS invoice_count,
        COALESCE(SUM(total), 0) AS invoice_value,
        COALESCE(SUM(paid_amount), 0) AS paid_amount,
        COALESCE(SUM(balance_due), 0) AS balance_due
      FROM (${invoiceReceivableSelect()}) receivables
      WHERE (customer_name LIKE ? OR customer_email LIKE ? OR invoice_no LIKE ?) ${customerFilter}
      GROUP BY customer_key, customer_name, customer_email
      ORDER BY balance_due DESC, customer_name ASC
      LIMIT 20
      `,
      [`%${search}%`, `%${search}%`, `%${search}%`, ...(customerScoped(req.user) ? [customerEmail(req.user) || 'no-authorised-customer'] : [])]
    );

    res.json({ matches });
  } catch (err) {
    console.error('SEARCH CUSTOMER STATEMENTS ERROR FULL:', err);
    res.status(500).json({ message: 'Failed to search customer statements', error: err.message });
  }
};

exports.viewCustomerStatementPdf = async (req, res) => {
  try {
    const statement = await buildCustomerStatementData(req.query, req.user);
    if (!statement.invoices.length) return res.status(404).json({ message: 'No invoice history found for this customer' });
    return await sendPdfResponse(res, await createDocumentPdf(statementDocumentData(statement)), Boolean(req.query.download));
  } catch (error) { return res.status(error.status || 500).json({ message: error.message, code: error.code || 'PDF_GENERATION_FAILED' }); }
};
exports.sendCustomerStatement = async (req, res) => {
  try {
    const statement = await buildCustomerStatementData(req.body, req.user);
    if (!statement.invoices.length) return res.status(404).json({ message: 'No invoice history found for this customer' });
    const to = validateRecipients(req.body.email || statement.customer.email, 'to');
    if (customerScoped(req.user) && (to.length !== 1 || to[0].toLowerCase() !== customerEmail(req.user))) throw Object.assign(new Error('Use your authorised customer email for this statement.'), {status:403});
    // Keep issue date tied to the saved ledger version, so retries of the same statement deduplicate.
    statement.issueDate = statement.invoices.reduce((latest, row) => String(row.updated_at || row.created_at) > String(latest) ? row.updated_at || row.created_at : latest, statement.invoices[0].created_at);
    const delivery = await queueDocumentEmail({ module: 'invoices', recordId: `statement:${createHash('sha256').update(statement.customer.email || statement.customer.name).digest('hex').slice(0,32)}`, data: statementDocumentData(statement), to,
      subject: `Voxel Veda customer statement - ${statement.customer.name}`, text: `Hello ${statement.customer.name}, your customer statement PDF is attached. Please contact Voxel Veda for questions.`, createdBy: req.user?.id });
    return res.json({ message: delivery.provider_accepted ? 'The email provider accepted this statement. Recipient receipt is unverified.' : 'Statement PDF validated and queued for email delivery.', email_sent: false, email_queued: true, ...delivery });
  } catch (error) { if (emailDeliveryFailure(res, error)) return; return res.status(error.status || 400).json({ message: error.message, code: error.code || 'STATEMENT_SEND_FAILED', email_sent: false, document_request_id: error.document_request_id || null }); }
};

/* ================= STATUS ACTIONS ================= */

async function transitionInvoice(req,res,target,allowed) {
  let conn;
  try {
    await ensureInvoiceColumns();const id=Number(req.body.invoice_id);
    if(!Number.isSafeInteger(id)||id<1)throw Object.assign(new Error('Choose a valid invoice.'),{status:422});
    const reason=String(req.body.reason || '').trim();
    if(target==='rejected' && (!reason||reason.length>2000))throw Object.assign(new Error('Enter a rejection reason of up to 2,000 characters.'),{status:422,errors:{reason:'A reason is required.'}});
    conn=await pool.getConnection();await conn.beginTransaction();
    const [[invoice]]=await conn.query('SELECT * FROM invoices WHERE id=? FOR UPDATE',[id]);
    if(invoice)assertCustomerRecord(req.user, invoice.customer_email);
    if(!invoice || invoice.deleted){await conn.rollback();return res.status(404).json({message:'Active invoice not found.'});}
    if(invoice.status===target){await conn.commit();return res.json({message:`Invoice is already ${target}.`,status:target,existing:true});}
    if(!allowed.includes(invoice.status)){await conn.rollback();return res.status(409).json({message:`This invoice cannot transition from ${invoice.status} to ${target}.`});}
    await conn.query('UPDATE invoices SET status=? WHERE id=?',[target,id]);
    await logInvoiceActivity(id,target,JSON.stringify({from:invoice.status,to:target,reason}),req.user?.id,conn);
    await conn.commit();return res.json({message:`Invoice ${target}.`,status:target});
  }catch(error){if(conn)await conn.rollback();return invoiceError(res,error);}finally{if(conn)conn.release();}
}
exports.approveInvoice=(req,res)=>transitionInvoice(req,res,'approved',['draft','rejected']);
exports.sendInvoice = async (req, res) => {
  try {
    const id = Number(req.body.invoice_id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ message: 'A valid invoice ID is required', errors: { invoice_id: 'Choose an invoice.' } });
    const email = String(req.body.email || '').trim(), mobile = cleanPhoneForWhatsApp(req.body.mobile);
    if (!email && !mobile) return res.status(400).json({ message: 'Enter customer email or mobile number' });
    if(email && !hasPermission(req.user,'SEND_COMPANY_EMAIL'))return res.status(403).json({message:'Company document email is not enabled for your account.'});
    const { invoice, data } = await loadInvoiceDocument(id, req.user);
    if (['draft','rejected'].includes(String(invoice.status).toLowerCase())) return res.status(409).json({ message: 'Approve the invoice before sending it.' });
    let delivery = null;
    if (email) {
      const to = validateRecipients(email, 'to');
      delivery = await queueDocumentEmail({ module: 'invoices', recordId: id, data, to,
        subject: `Voxel Veda invoice ${invoice.invoice_no}`, text: `Hello ${invoice.customer_name || 'Customer'}, invoice ${invoice.invoice_no} is attached as a PDF. Please reply with questions.`, createdBy: req.user?.id,
        beforeQueue: async conn => {
          const [[current]]=await conn.query('SELECT * FROM invoices WHERE id=? FOR UPDATE',[id]);
          if(!current || current.deleted || !['approved','sent','paid'].includes(current.status))throw pdfError('The invoice changed while its PDF was being generated. Review its current status before retrying.','PDF_DOCUMENT_CHANGED');
          const currentInvoice=await getInvoiceWithReceivables(id,conn);
          const [currentItems]=await conn.query('SELECT * FROM invoice_items WHERE invoice_id=? AND IFNULL(deleted,0)=0 ORDER BY id ASC',[id]);
          if(JSON.stringify(invoiceDocumentData(currentInvoice,currentItems))!==JSON.stringify(data))throw pdfError('The invoice changed while its PDF was being generated. Review the latest version and retry.','PDF_DOCUMENT_CHANGED');
        },
        afterQueue: async (conn,queueId) => logInvoiceActivity(id,'email_queued',`Queued validated invoice PDF for ${email}; queue ${queueId}`,req.user?.id,conn)
      });
    }
    const whatsappUrl = mobile ? `https://wa.me/${mobile}?text=${encodeURIComponent(`Voxel Veda invoice ${invoice.invoice_no}: ${urls.absolute(`/api/invoice/${id}/pdf`)}`)}` : '';
    return res.json({ message: delivery ? (delivery.provider_accepted ? 'The email provider accepted this invoice. Recipient receipt is unverified.' : 'Invoice PDF validated and queued for email delivery.') : 'Mobile message is ready.', email_sent: false, email_queued: Boolean(delivery), whatsapp_url: whatsappUrl, ...delivery });
  } catch (error) { if (emailDeliveryFailure(res, error)) return; return res.status(error.status || 400).json({ message: error.message, code: error.code || 'INVOICE_SEND_FAILED', email_sent: false, document_request_id: error.document_request_id || null }); }
};

function paymentDate(value) {
  const date=String(value || new Date().toISOString().slice(0,10));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date+'T00:00:00Z')) || new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw Object.assign(new Error('Enter a valid payment date.'),{status:422,errors:{payment_date:'Use a valid YYYY-MM-DD date.'}});
  return date;
}
async function savePayment(req,res,settle=false) {
  let conn;
  try {
    await ensureInvoiceColumns();const id=Number(req.body.invoice_id);
    if(!Number.isSafeInteger(id)||id<1)throw Object.assign(new Error('Choose a valid invoice.'),{status:422});
    const date=paymentDate(req.body.payment_date),method=String(req.body.method || 'Recorded payment').trim(),reference=String(req.body.reference || '').trim(),notes=String(req.body.notes || '').trim();
    if(method.length>80||reference.length>120||notes.length>4000)throw Object.assign(new Error('Payment method, reference or notes is too long.'),{status:422});
    const amount=Number(req.body.amount);
    if(!settle && !validDecimal(amount,2,9999999999.99,false))throw Object.assign(new Error('Enter a positive payment amount with at most two decimal places.'),{status:422,errors:{amount:'Enter a positive currency amount.'}});
    const identity=requestIdentity(req,`invoice-payment:${id}`,{settle,amount:settle?null:amount,date,method,reference,notes});
    conn=await pool.getConnection();await conn.beginTransaction();
    const [[invoice]]=await conn.query('SELECT * FROM invoices WHERE id=? AND IFNULL(deleted,0)=0 FOR UPDATE',[id]);
    if(invoice)assertCustomerRecord(req.user, invoice.customer_email);
    if(!invoice){await conn.rollback();return res.status(404).json({message:'Active invoice not found.'});}
    const [[existing]]=await conn.query('SELECT id,amount,request_payload_sha256,voided_at FROM invoice_payments WHERE request_key=? LIMIT 1',[identity.requestKey]);
    if(existing){await conn.commit();if(existing.request_payload_sha256!==identity.payloadHash)return res.status(409).json({message:'This request key was used for different payment data.'});return res.json({message:existing.voided_at?'This payment request was previously voided. Start a new request to record another payment.':'Payment already recorded.',payment_id:existing.id,existing:true});}
    const [[paid]]=await conn.query('SELECT COALESCE(SUM(amount),0) amount FROM invoice_payments WHERE invoice_id=? AND voided_at IS NULL',[id]);
    const balance=Math.round((Number(invoice.total)-Number(paid.amount))*100)/100;
    if(settle && balance<=0){await conn.commit();return res.json({message:'Invoice is already fully paid.',status:invoice.status,existing:true});}
    if(!['approved','sent'].includes(invoice.status)){await conn.rollback();return res.status(409).json({message:'Only approved or sent invoices can receive payment.'});}
    const recorded=settle?balance:amount;
    if(recorded>balance+0.009){await conn.rollback();return res.status(422).json({message:`Payment exceeds the balance due of ${money(balance)}.`,errors:{amount:'Payment cannot exceed the remaining balance.'}});}
    const [insert]=await conn.query('INSERT INTO invoice_payments(invoice_id,amount,payment_date,method,reference,notes,created_by,request_key,request_payload_sha256) VALUES(?,?,?,?,?,?,?,?,?)',[id,recorded,date,method,reference,notes,req.user?.id,identity.requestKey,identity.payloadHash]);
    const remaining=Math.round((balance-recorded)*100)/100,status=remaining<=0.009?'paid':invoice.status;
    await conn.query('UPDATE invoices SET status=? WHERE id=?',[status,id]);
    await logInvoiceActivity(id,'payment',JSON.stringify({payment_id:insert.insertId,amount:recorded,date,method,reference,previous_balance:balance,balance_due:remaining,status}),req.user?.id,conn);
    await conn.commit();return res.json({message:status==='paid'?'Payment recorded; invoice fully paid.':'Payment recorded; balance updated.',payment_id:insert.insertId,status,balance_due:remaining,existing:false});
  }catch(error){if(conn)await conn.rollback();return invoiceError(res,error);}finally{if(conn)conn.release();}
}
exports.markInvoicePaid=(req,res)=>savePayment(req,res,true);
exports.recordInvoicePayment=(req,res)=>savePayment(req,res,false);
exports.deleteInvoicePayment=async(req,res)=>{
 let conn;
 try{
  await ensureInvoiceColumns();const id=Number(req.body.invoice_id),paymentId=Number(req.body.payment_id);
  if(!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(paymentId)||paymentId<1)throw Object.assign(new Error('Choose a valid invoice and payment.'),{status:422});
  conn=await pool.getConnection();await conn.beginTransaction();
  const [[invoice]]=await conn.query('SELECT * FROM invoices WHERE id=? AND IFNULL(deleted,0)=0 FOR UPDATE',[id]);
  if(!invoice){await conn.rollback();return res.status(404).json({message:'Active invoice not found.'});}
  const [[payment]]=await conn.query('SELECT * FROM invoice_payments WHERE id=? AND invoice_id=? FOR UPDATE',[paymentId,id]);
  if(!payment){await conn.rollback();return res.status(404).json({message:'Payment not found.'});}
  if(payment.voided_at){await conn.commit();return res.json({message:'Payment is already voided.',existing:true});}
  await conn.query('UPDATE invoice_payments SET voided_at=NOW(),voided_by=? WHERE id=?',[req.user?.id,paymentId]);
  if(invoice.status==='paid')await conn.query("UPDATE invoices SET status='approved' WHERE id=?",[id]);
  await logInvoiceActivity(id,'payment_voided',JSON.stringify({payment_id:paymentId,amount:payment.amount,reference:payment.reference,previous_status:invoice.status}),req.user?.id,conn);
  await conn.commit();return res.json({message:'Payment voided and preserved in audit history.',status:invoice.status==='paid'?'approved':invoice.status});
 }catch(error){if(conn)await conn.rollback();return invoiceError(res,error);}finally{if(conn)conn.release();}
};
exports.rejectInvoice=(req,res)=>transitionInvoice(req,res,'rejected',['draft','approved']);
async function archiveInvoice(req,res,restore=false){
 let conn;
 try{
  await ensureInvoiceColumns();const id=Number(req.body.invoice_id);
  if(!Number.isSafeInteger(id)||id<1)throw Object.assign(new Error('Choose a valid invoice.'),{status:422});
  conn=await pool.getConnection();await conn.beginTransaction();
  const [[invoice]]=await conn.query('SELECT * FROM invoices WHERE id=? FOR UPDATE',[id]);
  if(!invoice){await conn.rollback();return res.status(404).json({message:'Invoice not found.'});}
  const target=restore?0:1;
  if(Number(invoice.deleted)===target){await conn.commit();return res.json({message:restore?'Invoice already restored.':'Invoice already archived.',existing:true});}
  await conn.query('UPDATE invoices SET deleted=? WHERE id=?',[target,id]);
  await logInvoiceActivity(id,restore?'restored':'archived',JSON.stringify({invoice_no:invoice.invoice_no,status:invoice.status,total:invoice.total}),req.user?.id,conn);
  await conn.commit();return res.json({message:restore?'Invoice restored.':'Invoice archived; records and attachments preserved.'});
 }catch(error){if(conn)await conn.rollback();return invoiceError(res,error);}finally{if(conn)conn.release();}
}
exports.deleteInvoice=(req,res)=>archiveInvoice(req,res,false);
exports.restoreInvoice=(req,res)=>archiveInvoice(req,res,true);
exports.editInvoice=async(req,res)=>{
 let conn;
 try{
  const clean=cleanInvoiceInput(req.body,true),id=Number(req.body.invoice_id),reference=String(req.body.invoice_no||'').trim();
  if(!Number.isSafeInteger(id)||id<1 || !reference || reference.length>80 || /[\r\n]/.test(reference))throw Object.assign(new Error('Enter a valid invoice ID and reference of up to 80 characters.'),{status:422});
  await ensureInvoiceColumns();conn=await pool.getConnection();await conn.beginTransaction();
  const [[before]]=await conn.query('SELECT * FROM invoices WHERE id=? AND IFNULL(deleted,0)=0 FOR UPDATE',[id]);
  if(!before){await conn.rollback();return res.status(404).json({message:'Active invoice not found.'});}
  if(req.body.expected_revision!==undefined&&Number(req.body.expected_revision)!==Number(before.document_revision)){await conn.rollback();return res.status(409).json({message:'This invoice changed after you opened it. Reload the current invoice before saving.',code:'INVOICE_REVISION_CONFLICT'});}
  if(!['draft','rejected','approved'].includes(before.status)){await conn.rollback();return res.status(409).json({message:'Sent and paid invoices retain their issued content. Archive or resolve the issued record before creating a correction.'});}
  if(req.body.status && req.body.status!==before.status){await conn.rollback();return res.status(409).json({message:'Use the authorised approval, rejection or payment action to change invoice status.'});}
  const [[duplicate]]=await conn.query('SELECT id FROM invoices WHERE invoice_no=? AND id<>? AND IFNULL(deleted,0)=0 LIMIT 1',[reference,id]);
  if(duplicate){await conn.rollback();return res.status(422).json({message:'Invoice reference is already in use.',errors:{invoice_no:'Choose a unique invoice reference.'}});}
  const [queued]=await conn.query("SELECT id,status FROM email_queue WHERE related_module='invoices' AND related_record_id=? AND status IN ('PENDING','RETRY','FAILED','SENDING') FOR UPDATE",[String(id)]);
  if(queued.some(row=>row.status==='SENDING')){await conn.rollback();return res.status(409).json({message:'The invoice document is being sent. Check its delivery status before revising it.'});}
  await conn.query("UPDATE email_queue SET status='CANCELLED',last_error='Invoice revised before document delivery. Generate the revised document before sending.' WHERE related_module='invoices' AND related_record_id=? AND status IN ('PENDING','RETRY','FAILED')",[String(id)]);
  const [oldItems]=await conn.query('SELECT * FROM invoice_items WHERE invoice_id=? AND IFNULL(deleted,0)=0 ORDER BY id',[id]);
  const first=clean.items[0],status=before.status==='approved'?'draft':before.status;
  await conn.query('UPDATE invoices SET invoice_no=?,customer_name=?,customer_email=?,description=?,quantity=?,unit_price=?,gst_rate=?,total=?,status=?,document_revision=document_revision+1 WHERE id=?',[reference,clean.name,clean.email,first.description,first.quantity,first.unitPrice,clean.rate,clean.total,status,id]);
  for(let index=0;index<clean.items.length;index++){
    const item=clean.items[index],previous=oldItems[index];
    if(previous)await conn.query('UPDATE invoice_items SET description=?,quantity=?,unit_price=?,amount=?,qty=NULL,total=NULL,deleted=0 WHERE id=? AND invoice_id=?',[item.description,item.quantity,item.unitPrice,item.amount,previous.id,id]);
    else await writeInvoiceItems(conn,id,[item]);
  }
  for(const previous of oldItems.slice(clean.items.length))await conn.query('UPDATE invoice_items SET deleted=1 WHERE id=? AND invoice_id=?',[previous.id,id]);
  await logInvoiceActivity(id,'edited',JSON.stringify({before:{reference:before.invoice_no,customer:before.customer_name,email:before.customer_email,gst_rate:before.gst_rate,total:before.total,status:before.status,items:oldItems},after:{reference,customer:clean.name,email:clean.email,gst_rate:clean.rate,total:clean.total,status,items:clean.items}}),req.user?.id,conn);
  await conn.commit();return res.json({message:before.status==='approved'?'Invoice updated; reapproval is required.':'Invoice updated.',total:clean.total,status});
 }catch(error){if(conn)await conn.rollback();return invoiceError(res,error);}finally{if(conn)conn.release();}
};

async function logInvoiceActivity(invoiceId,actionType,notes,actorId=null,db=pool){
 return db.query('INSERT INTO invoice_activity(invoice_id,action_type,notes,created_by) VALUES(?,?,?,?)',[invoiceId,actionType,notes||'',actorId]);
}

/* ================= VALIDATED PDF ================= */
async function loadInvoiceDocument(id, user) {
  await ensureInvoiceColumns();
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    const invoice=await getInvoiceWithReceivables(id,conn);
    if(!invoice)throw Object.assign(new Error('Invoice not found'),{status:404});
    assertCustomerRecord(user, invoice.customer_email);
    const [items]=await conn.query('SELECT * FROM invoice_items WHERE invoice_id=? AND IFNULL(deleted,0)=0 ORDER BY id ASC',[id]);
    const data=invoiceDocumentData(invoice,items);
    await conn.commit();return {invoice,data};
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
}
exports.viewInvoicePdf = async (req, res) => {
  try {
    const { data } = await loadInvoiceDocument(req.params.id, req.user);
    return await sendPdfResponse(res, await createDocumentPdf(data), Boolean(req.query.download));
  } catch (error) { return res.status(error.status || 500).json({ message: error.message, code: error.code || 'PDF_GENERATION_FAILED' }); }
};
exports.viewBlankInvoicePdf = async (req, res) => {
  try { return await sendPdfResponse(res, await createDocumentPdf(blankInvoiceDocumentData()), Boolean(req.query.download)); }
  catch (error) { return res.status(error.status || 500).json({ message: error.message, code: error.code || 'PDF_GENERATION_FAILED' }); }
};
async function buildInvoicePdfBuffer(id) { return (await createDocumentPdf((await loadInvoiceDocument(id)).data)).buffer; }
async function buildCustomerStatementPdfBuffer(statement) { return (await createDocumentPdf(statementDocumentData(statement))).buffer; }
function statementMoney(value) { return money(value); }
exports._test = { loadInvoiceDocument, buildInvoicePdfBuffer, buildCustomerStatementPdfBuffer, cleanInvoiceInput,requestIdentity,validDecimal,paymentDate };

exports.ensureInvoiceColumns = ensureInvoiceColumns;
