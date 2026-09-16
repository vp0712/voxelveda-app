const crypto=require('node:crypto');
const pool=require('../config/db');

const FORMAT='VOXEL_VEDA_PERSONAL_FINANCE_CANONICAL_BACKUP';
const FORMAT_VERSION=1;
const SCHEMA_VERSION='2026-09-16.1';
const MAX_RECORDS=250000;

function uid(req){const v=req.user?.id??req.user?.user_id;if(v===undefined||v===null||v==='')throw Object.assign(new Error('User identity unavailable.'),{statusCode:401});return String(v);}
function stable(value){if(value instanceof Date)return JSON.stringify(value.toISOString());if(Buffer.isBuffer(value))return JSON.stringify(value.toString('base64'));if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;}
function hash(value){return crypto.createHash('sha256').update(typeof value==='string'?value:stable(value)).digest('hex');}
function publicRow(row){const out={...row};for(const k of ['user_id','created_by','uploaded_by','reviewed_by','resolved_by','access_token','refresh_token','consent_token','api_key','secret','password','provider_connection_id'])delete out[k];return out;}
function recordId(row){return String(row.id??row.import_uid??row.connection_uid??'');}
function err(res,e){const s=Number(e?.statusCode||500);if(s>=500)console.error('Failed to create canonical Personal Finance backup.',e);return res.status(s).json({message:s>=500?'Failed to create canonical Personal Finance backup.':e.message});}

const DATASETS=[
  {name:'bank_accounts',table:'bank_accounts',dependencies:[],query:`SELECT * FROM bank_accounts WHERE created_by=? AND ownership_scope='PERSONAL' ORDER BY id`,params:u=>[u]},
  {name:'bank_transactions',table:'bank_transactions',dependencies:['bank_accounts'],query:`SELECT bt.* FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id WHERE ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL' ORDER BY bt.id`,params:u=>[u]},
  {name:'statement_import_files',table:'statement_import_files',dependencies:['bank_accounts'],query:`SELECT sif.* FROM statement_import_files sif JOIN bank_accounts ba ON ba.id=sif.bank_account_id WHERE ba.created_by=? AND ba.ownership_scope='PERSONAL' ORDER BY sif.id`,params:u=>[u]},
  {name:'personal_money_wallets',table:'personal_money_wallets',dependencies:[],query:`SELECT * FROM personal_money_wallets WHERE user_id=? ORDER BY id`,params:u=>[u]},
  {name:'personal_money_entries',table:'personal_money_entries',dependencies:['personal_money_wallets'],query:`SELECT * FROM personal_money_entries WHERE user_id=? ORDER BY id`,params:u=>[u]},
  {name:'personal_money_debts',table:'personal_money_debts',dependencies:[],query:`SELECT * FROM personal_money_debts WHERE user_id=? ORDER BY id`,params:u=>[u]},
  {name:'personal_money_debt_payments',table:'personal_money_debt_payments',dependencies:['personal_money_debts','personal_money_wallets'],query:`SELECT * FROM personal_money_debt_payments WHERE user_id=? ORDER BY id`,params:u=>[u]},
  {name:'personal_money_budgets',table:'personal_money_budgets',dependencies:[],query:`SELECT * FROM personal_money_budgets WHERE user_id=? ORDER BY id`,params:u=>[u]},
  {name:'personal_money_recurring_items',table:'personal_money_recurring_items',dependencies:['bank_accounts'],query:`SELECT * FROM personal_money_recurring_items WHERE user_id=? ORDER BY id`,params:u=>[u]},
  {name:'personal_money_recurring_matches',table:'personal_money_recurring_matches',dependencies:['personal_money_recurring_items','bank_transactions'],query:`SELECT prm.* FROM personal_money_recurring_matches prm JOIN personal_money_recurring_items pri ON pri.id=prm.recurring_item_id AND pri.user_id=prm.user_id JOIN bank_transactions bt ON bt.id=prm.bank_transaction_id JOIN bank_accounts ba ON ba.id=bt.bank_account_id WHERE prm.user_id=? AND ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL' ORDER BY prm.id`,params:u=>[u,u]},
  {name:'personal_money_savings_goals',table:'personal_money_savings_goals',dependencies:[],query:`SELECT * FROM personal_money_savings_goals WHERE user_id=? ORDER BY id`,params:u=>[u]},
  {name:'personal_money_goal_contributions',table:'personal_money_goal_contributions',dependencies:['personal_money_savings_goals'],query:`SELECT * FROM personal_money_goal_contributions WHERE user_id=? ORDER BY id`,params:u=>[u]},
  {name:'personal_money_safety_buffers',table:'personal_money_safety_buffers',dependencies:[],query:`SELECT * FROM personal_money_safety_buffers WHERE user_id=? ORDER BY id`,params:u=>[u]},
  {name:'personal_net_worth_assets',table:'personal_net_worth_assets',dependencies:[],query:`SELECT * FROM personal_net_worth_assets WHERE user_id=? ORDER BY id`,params:u=>[u]},
  {name:'personal_net_worth_asset_values',table:'personal_net_worth_asset_values',dependencies:['personal_net_worth_assets'],query:`SELECT * FROM personal_net_worth_asset_values WHERE user_id=? ORDER BY id`,params:u=>[u]},
  {name:'personal_net_worth_liabilities',table:'personal_net_worth_liabilities',dependencies:[],query:`SELECT * FROM personal_net_worth_liabilities WHERE user_id=? ORDER BY id`,params:u=>[u]},
  {name:'personal_net_worth_liability_values',table:'personal_net_worth_liability_values',dependencies:['personal_net_worth_liabilities'],query:`SELECT * FROM personal_net_worth_liability_values WHERE user_id=? ORDER BY id`,params:u=>[u]},
  {name:'personal_net_worth_snapshots',table:'personal_net_worth_snapshots',dependencies:[],query:`SELECT * FROM personal_net_worth_snapshots WHERE user_id=? ORDER BY id`,params:u=>[u]},
  {name:'personal_asset_lifecycle_items',table:'personal_asset_lifecycle_items',dependencies:['personal_net_worth_assets','personal_net_worth_liabilities'],query:`SELECT * FROM personal_asset_lifecycle_items WHERE user_id=? ORDER BY id`,params:u=>[u]},
  {name:'personal_asset_documents',table:'personal_asset_documents',dependencies:['personal_net_worth_assets','personal_net_worth_liabilities'],query:`SELECT * FROM personal_asset_documents WHERE user_id=? ORDER BY id`,params:u=>[u]},
  {name:'personal_finance_saved_views',table:'personal_finance_saved_views',dependencies:[],query:`SELECT * FROM personal_finance_saved_views WHERE user_id=? ORDER BY id`,params:u=>[u]},
  {name:'personal_spending_challenges',table:'personal_spending_challenges',dependencies:[],query:`SELECT * FROM personal_spending_challenges WHERE user_id=? ORDER BY id`,params:u=>[u]},
  {name:'personal_financial_roadmaps',table:'personal_financial_roadmaps',dependencies:[],query:`SELECT * FROM personal_financial_roadmaps WHERE user_id=? ORDER BY id`,params:u=>[u]},
  {name:'personal_financial_roadmap_milestones',table:'personal_financial_roadmap_milestones',dependencies:['personal_financial_roadmaps'],query:`SELECT * FROM personal_financial_roadmap_milestones WHERE user_id=? ORDER BY id`,params:u=>[u]}
];

async function build(userId){
  const datasets={};let total=0;
  for(const def of DATASETS){
    const [rows]=await pool.query(def.query,def.params(userId));
    total+=rows.length;if(total>MAX_RECORDS)throw Object.assign(new Error(`Canonical backup exceeds the ${MAX_RECORDS.toLocaleString()} record safety limit. Contact support for a streamed export.`),{statusCode:413});
    const records=rows.map(r=>{const row=publicRow(r);return {id:recordId(row),record_sha256:hash(row),row};});
    datasets[def.name]={table:def.table,schema_version:SCHEMA_VERSION,primary_key:'id',dependencies:def.dependencies,restore_adapter:{mode:'UPSERT_BY_PRIMARY_KEY',status:'DRY_RUN_READY',owner_binding:'INJECT_CURRENT_OWNER',transaction_required:true,rollback_checkpoint_required:true},record_count:records.length,dataset_sha256:hash(records.map(r=>r.record_sha256)),records};
  }
  const createdAt=new Date().toISOString();
  const body={format:FORMAT,format_version:FORMAT_VERSION,schema_version:SCHEMA_VERSION,created_at:createdAt,scope:'PERSONAL_ONLY',owner_binding_sha256:hash(`voxelveda-personal-owner-v1:${userId}`),currency_rule:'Currencies remain separate. Canonical backup records preserve their recorded currency and never create cross-currency totals.',restore_policy:{write_mode:'DISABLED_IN_CANONICAL_BACKUP_ENGINE',dry_run_ready:true,step_up_required:true,explicit_record_approval_required:true,transaction_boundary_required:true,rollback_checkpoint_required:true},dependency_order:DATASETS.map(d=>d.name),datasets};
  const packageSha=hash(body);
  return {manifest:{format:FORMAT,format_version:FORMAT_VERSION,schema_version:SCHEMA_VERSION,created_at:createdAt,scope:'PERSONAL_ONLY',integrity_algorithm:'SHA-256',owner_binding_sha256:body.owner_binding_sha256,dataset_count:DATASETS.length,record_count:total,package_sha256:packageSha,dependency_order:body.dependency_order,restore_policy:body.restore_policy},payload:body};
}

exports.getCanonicalBackup=async(req,res)=>{try{return res.json(await build(uid(req)));}catch(e){return err(res,e);}};
exports._test={stable,hash,publicRow,DATASETS,FORMAT,FORMAT_VERSION,SCHEMA_VERSION};