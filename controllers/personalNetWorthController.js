const crypto = require('node:crypto');
const pool = require('../config/db');

function uid(req) {
  const value = req.user?.id ?? req.user?.user_id;
  if (value === undefined || value === null || value === '') throw Object.assign(new Error('User identity unavailable.'), { statusCode: 401 });
  return String(value);
}
function respondError(res, error, fallback) {
  const status = Number(error?.statusCode || 500);
  if (status >= 500) console.error(fallback, error);
  return res.status(status).json({ message: status >= 500 ? fallback : error.message });
}
function money(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 999999999999) throw Object.assign(new Error(`${field} must be zero or a positive amount.`), { statusCode: 400 });
  return Math.round(number * 10000) / 10000;
}
function currency(value) {
  const code = String(value || 'AUD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw Object.assign(new Error('Currency must be a three-letter code such as AUD, USD or INR.'), { statusCode: 400 });
  return code;
}
function clean(value, max = 200) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : null;
}
function dateOnly(value, required = false) {
  if (!value && !required) return null;
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw Object.assign(new Error('Date must use YYYY-MM-DD.'), { statusCode: 400 });
  return text;
}
function pct(value, field) {
  if (value === undefined || value === '' || value === null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1000) throw Object.assign(new Error(`${field} is invalid.`), { statusCode: 400 });
  return Math.round(number * 10000) / 10000;
}
function type(value, allowed, label) {
  const result = String(value || '').trim().toUpperCase();
  if (!allowed.has(result)) throw Object.assign(new Error(`Choose a valid ${label}.`), { statusCode: 400 });
  return result;
}
function ensure(map, code) {
  const key = currency(code);
  if (!map[key]) map[key] = { currency:key, liquid_funds:0, registered_assets:0, lent_receivables:0, registered_liabilities:0, borrowed_money:0 };
  return map[key];
}
async function ownedAsset(connection, userId, id, lock = false) {
  const [[row]] = await connection.query(`SELECT * FROM personal_net_worth_assets WHERE id=? AND user_id=? LIMIT 1${lock?' FOR UPDATE':''}`, [id,userId]);
  if (!row) throw Object.assign(new Error('Asset not found.'), { statusCode:404 });
  return row;
}
async function ownedLiability(connection, userId, id, lock = false) {
  const [[row]] = await connection.query(`SELECT * FROM personal_net_worth_liabilities WHERE id=? AND user_id=? LIMIT 1${lock?' FOR UPDATE':''}`, [id,userId]);
  if (!row) throw Object.assign(new Error('Liability not found.'), { statusCode:404 });
  return row;
}
async function calculateTotals(userId, connection = pool) {
  const [bankRows, walletRows, assetRows, liabilityRows, debtRows] = await Promise.all([
    connection.query(`SELECT currency,COALESCE(SUM(COALESCE(available_balance,current_ledger_balance,0)),0) total FROM bank_accounts WHERE created_by=? AND ownership_scope='PERSONAL' AND status='ACTIVE' GROUP BY currency`, [userId]).then(([r])=>r),
    connection.query(`SELECT currency,COALESCE(SUM(balance),0) total FROM personal_money_wallets WHERE user_id=? AND active=1 GROUP BY currency`, [userId]).then(([r])=>r),
    connection.query(`SELECT currency,COALESCE(SUM(current_value),0) total FROM personal_net_worth_assets WHERE user_id=? AND active=1 GROUP BY currency`, [userId]).then(([r])=>r),
    connection.query(`SELECT currency,COALESCE(SUM(current_balance),0) total FROM personal_net_worth_liabilities WHERE user_id=? AND active=1 GROUP BY currency`, [userId]).then(([r])=>r),
    connection.query(`SELECT currency,COALESCE(SUM(CASE WHEN direction='LENT' AND status<>'SETTLED' THEN outstanding_amount ELSE 0 END),0) lent,COALESCE(SUM(CASE WHEN direction='BORROWED' AND status<>'SETTLED' THEN outstanding_amount ELSE 0 END),0) borrowed FROM personal_money_debts WHERE user_id=? GROUP BY currency`, [userId]).then(([r])=>r)
  ]);
  const out = {};
  bankRows.forEach((r)=>{ensure(out,r.currency).liquid_funds += Number(r.total||0);});
  walletRows.forEach((r)=>{ensure(out,r.currency).liquid_funds += Number(r.total||0);});
  assetRows.forEach((r)=>{ensure(out,r.currency).registered_assets = Number(r.total||0);});
  liabilityRows.forEach((r)=>{ensure(out,r.currency).registered_liabilities = Number(r.total||0);});
  debtRows.forEach((r)=>{const row=ensure(out,r.currency);row.lent_receivables=Number(r.lent||0);row.borrowed_money=Number(r.borrowed||0);});
  Object.values(out).forEach((row)=>{
    for (const key of ['liquid_funds','registered_assets','lent_receivables','registered_liabilities','borrowed_money']) row[key]=Math.round(row[key]*100)/100;
    row.total_assets=Math.round((row.liquid_funds+row.registered_assets+row.lent_receivables)*100)/100;
    row.total_liabilities=Math.round((row.registered_liabilities+row.borrowed_money)*100)/100;
    row.net_worth=Math.round((row.total_assets-row.total_liabilities)*100)/100;
  });
  return out;
}

exports.getDashboard = async (req,res) => {
  try {
    const userId=uid(req);
    const [assets, liabilities, assetHistory, liabilityHistory, snapshots, totals] = await Promise.all([
      pool.query(`SELECT id,asset_type,name,currency,current_value,purchase_value,purchase_date,institution,note,active,created_at,updated_at FROM personal_net_worth_assets WHERE user_id=? AND active=1 ORDER BY current_value DESC,created_at DESC`,[userId]).then(([r])=>r),
      pool.query(`SELECT id,liability_type,name,currency,current_balance,original_balance,interest_rate_percent,minimum_payment,due_day,institution,note,active,created_at,updated_at FROM personal_net_worth_liabilities WHERE user_id=? AND active=1 ORDER BY current_balance DESC,created_at DESC`,[userId]).then(([r])=>r),
      pool.query(`SELECT asset_id,value_amount,value_date,source,note FROM personal_net_worth_asset_values WHERE user_id=? ORDER BY value_date DESC,created_at DESC LIMIT 120`,[userId]).then(([r])=>r),
      pool.query(`SELECT liability_id,balance_amount,value_date,source,note FROM personal_net_worth_liability_values WHERE user_id=? ORDER BY value_date DESC,created_at DESC LIMIT 120`,[userId]).then(([r])=>r),
      pool.query(`SELECT currency,snapshot_date,liquid_funds,registered_assets,lent_receivables,registered_liabilities,borrowed_money,net_worth FROM personal_net_worth_snapshots WHERE user_id=? AND snapshot_date>=DATE_SUB(CURRENT_DATE,INTERVAL 18 MONTH) ORDER BY snapshot_date`,[userId]).then(([r])=>r),
      calculateTotals(userId)
    ]);
    return res.json({
      privacy:'Owner-only personal wealth register. Voxel Veda business finance users cannot read another user’s assets, liabilities or snapshots.',
      currency_rule:'Currencies stay separate. No AUD/USD/INR conversion is assumed.',
      double_counting_warning:'Do not add bank balances or cash again as assets. Bank accounts and Personal Money wallets are already included automatically. Also avoid entering the same borrowed money both as a Personal Money debt and as a Net Worth liability.',
      valuation_warning:'Asset values are user-entered estimates unless you explicitly update them. Voxel Veda does not claim a market valuation.',
      totals_by_currency:totals,
      assets:assets.map((r)=>({...r,current_value:Number(r.current_value||0),purchase_value:r.purchase_value===null?null:Number(r.purchase_value)})),
      liabilities:liabilities.map((r)=>({...r,current_balance:Number(r.current_balance||0),original_balance:r.original_balance===null?null:Number(r.original_balance),interest_rate_percent:r.interest_rate_percent===null?null:Number(r.interest_rate_percent),minimum_payment:r.minimum_payment===null?null:Number(r.minimum_payment)})),
      asset_history:assetHistory,
      liability_history:liabilityHistory,
      snapshots:snapshots.map((r)=>({...r,liquid_funds:Number(r.liquid_funds),registered_assets:Number(r.registered_assets),lent_receivables:Number(r.lent_receivables),registered_liabilities:Number(r.registered_liabilities),borrowed_money:Number(r.borrowed_money),net_worth:Number(r.net_worth)}))
    });
  } catch(error){return respondError(res,error,'Failed to load Net Worth Center.');}
};

exports.createAsset = async (req,res) => {
  const connection=await pool.getConnection();
  try {
    const userId=uid(req); const allowed=new Set(['PROPERTY','VEHICLE','INVESTMENT','SUPER','BUSINESS_INTEREST','EQUIPMENT','VALUABLE','OTHER']);
    const assetType=type(req.body.asset_type,allowed,'asset type'); const name=clean(req.body.name,160); if(!name) throw Object.assign(new Error('Asset name is required.'),{statusCode:400});
    const value=money(req.body.current_value,'Current value'); const code=currency(req.body.currency); const id=crypto.randomUUID(); const today=new Date().toISOString().slice(0,10);
    await connection.beginTransaction();
    await connection.query(`INSERT INTO personal_net_worth_assets (id,user_id,asset_type,name,currency,current_value,purchase_value,purchase_date,institution,note) VALUES (?,?,?,?,?,?,?,?,?,?)`,[id,userId,assetType,name,code,value,req.body.purchase_value===''||req.body.purchase_value==null?null:money(req.body.purchase_value,'Purchase value'),dateOnly(req.body.purchase_date),clean(req.body.institution,160),clean(req.body.note,500)]);
    await connection.query(`INSERT INTO personal_net_worth_asset_values (id,asset_id,user_id,value_amount,value_date,source,note) VALUES (?,?,?,?,?,'MANUAL',?)`,[crypto.randomUUID(),id,userId,value,today,'Opening asset value']);
    await connection.commit(); return res.status(201).json({message:'Asset added to your private Net Worth Center.',id});
  } catch(error){await connection.rollback().catch(()=>{});return respondError(res,error,'Failed to add asset.');} finally{connection.release();}
};
exports.updateAssetValue = async (req,res) => {
  const connection=await pool.getConnection();
  try {const userId=uid(req),value=money(req.body.value_amount,'Asset value'),valueDate=dateOnly(req.body.value_date||new Date().toISOString().slice(0,10),true);await connection.beginTransaction();await ownedAsset(connection,userId,req.params.id,true);await connection.query(`UPDATE personal_net_worth_assets SET current_value=? WHERE id=? AND user_id=?`,[value,req.params.id,userId]);await connection.query(`INSERT INTO personal_net_worth_asset_values (id,asset_id,user_id,value_amount,value_date,source,note) VALUES (?,?,?,?,?,'MANUAL',?)`,[crypto.randomUUID(),req.params.id,userId,value,valueDate,clean(req.body.note,255)]);await connection.commit();return res.json({message:'Asset value updated and added to value history.'});}catch(error){await connection.rollback().catch(()=>{});return respondError(res,error,'Failed to update asset value.');}finally{connection.release();}
};
exports.archiveAsset = async (req,res) => {try{const userId=uid(req);const [result]=await pool.query(`UPDATE personal_net_worth_assets SET active=0 WHERE id=? AND user_id=?`,[req.params.id,userId]);if(!result.affectedRows)return res.status(404).json({message:'Asset not found.'});return res.json({message:'Asset archived. Historical value records are retained.'});}catch(error){return respondError(res,error,'Failed to archive asset.');}};

exports.createLiability = async (req,res) => {
  const connection=await pool.getConnection();
  try {const userId=uid(req);const allowed=new Set(['MORTGAGE','VEHICLE_LOAN','PERSONAL_LOAN','CREDIT_CARD','TAX','OTHER']);const liabilityType=type(req.body.liability_type,allowed,'liability type');const name=clean(req.body.name,160);if(!name)throw Object.assign(new Error('Liability name is required.'),{statusCode:400});const balance=money(req.body.current_balance,'Current balance'),code=currency(req.body.currency),id=crypto.randomUUID(),today=new Date().toISOString().slice(0,10);const dueDay=req.body.due_day===''||req.body.due_day==null?null:Number(req.body.due_day);if(dueDay!==null&&(!Number.isInteger(dueDay)||dueDay<1||dueDay>31))throw Object.assign(new Error('Due day must be between 1 and 31.'),{statusCode:400});await connection.beginTransaction();await connection.query(`INSERT INTO personal_net_worth_liabilities (id,user_id,liability_type,name,currency,current_balance,original_balance,interest_rate_percent,minimum_payment,due_day,institution,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[id,userId,liabilityType,name,code,balance,req.body.original_balance===''||req.body.original_balance==null?null:money(req.body.original_balance,'Original balance'),pct(req.body.interest_rate_percent,'Interest rate'),req.body.minimum_payment===''||req.body.minimum_payment==null?null:money(req.body.minimum_payment,'Minimum payment'),dueDay,clean(req.body.institution,160),clean(req.body.note,500)]);await connection.query(`INSERT INTO personal_net_worth_liability_values (id,liability_id,user_id,balance_amount,value_date,source,note) VALUES (?,?,?,?,?,'MANUAL',?)`,[crypto.randomUUID(),id,userId,balance,today,'Opening liability balance']);await connection.commit();return res.status(201).json({message:'Liability added to your private Net Worth Center.',id});}catch(error){await connection.rollback().catch(()=>{});return respondError(res,error,'Failed to add liability.');}finally{connection.release();}
};
exports.updateLiabilityBalance = async (req,res) => {const connection=await pool.getConnection();try{const userId=uid(req),balance=money(req.body.balance_amount,'Liability balance'),valueDate=dateOnly(req.body.value_date||new Date().toISOString().slice(0,10),true);await connection.beginTransaction();await ownedLiability(connection,userId,req.params.id,true);await connection.query(`UPDATE personal_net_worth_liabilities SET current_balance=? WHERE id=? AND user_id=?`,[balance,req.params.id,userId]);await connection.query(`INSERT INTO personal_net_worth_liability_values (id,liability_id,user_id,balance_amount,value_date,source,note) VALUES (?,?,?,?,?,'MANUAL',?)`,[crypto.randomUUID(),req.params.id,userId,balance,valueDate,clean(req.body.note,255)]);await connection.commit();return res.json({message:'Liability balance updated and added to history.'});}catch(error){await connection.rollback().catch(()=>{});return respondError(res,error,'Failed to update liability balance.');}finally{connection.release();}};
exports.archiveLiability = async (req,res) => {try{const userId=uid(req);const [result]=await pool.query(`UPDATE personal_net_worth_liabilities SET active=0 WHERE id=? AND user_id=?`,[req.params.id,userId]);if(!result.affectedRows)return res.status(404).json({message:'Liability not found.'});return res.json({message:'Liability archived. Historical records are retained.'});}catch(error){return respondError(res,error,'Failed to archive liability.');}};

exports.saveSnapshot = async (req,res) => {
  const connection=await pool.getConnection();
  try {const userId=uid(req),date=dateOnly(req.body.snapshot_date||new Date().toISOString().slice(0,10),true);await connection.beginTransaction();const totals=await calculateTotals(userId,connection);for(const row of Object.values(totals)){await connection.query(`INSERT INTO personal_net_worth_snapshots (id,user_id,currency,snapshot_date,liquid_funds,registered_assets,lent_receivables,registered_liabilities,borrowed_money,net_worth) VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE liquid_funds=VALUES(liquid_funds),registered_assets=VALUES(registered_assets),lent_receivables=VALUES(lent_receivables),registered_liabilities=VALUES(registered_liabilities),borrowed_money=VALUES(borrowed_money),net_worth=VALUES(net_worth)`,[crypto.randomUUID(),userId,row.currency,date,row.liquid_funds,row.registered_assets,row.lent_receivables,row.registered_liabilities,row.borrowed_money,row.net_worth]);}await connection.commit();return res.json({message:`Net worth snapshot saved for ${date}.`,currencies:Object.keys(totals).length});}catch(error){await connection.rollback().catch(()=>{});return respondError(res,error,'Failed to save net worth snapshot.');}finally{connection.release();}
};
