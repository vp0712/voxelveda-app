const crypto = require('node:crypto');
const pool = require('../config/db');
const money = require('../utils/money');
const { adapter, environment, liveSyncEnabled, selectedProvider } = require('./openBankingProviderService');
const { logAudit } = require('./auditService');

function uid(prefix) { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`; }
function list(payload) { return Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : []; }
function clean(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
function dateOnly(value) { const s = clean(value, 40); const m = s.match(/^\d{4}-\d{2}-\d{2}/); return m ? m[0] : null; }
function dateTime(value) { const d = value ? new Date(value) : null; return d && !Number.isNaN(d.valueOf()) ? d.toISOString().slice(0, 19).replace('T', ' ') : null; }
function decimal(value) { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; }
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function normalizeInstitution(connection) { return clean(connection?.institution?.name || connection?.institution?.shortName || connection?.institution || connection?.name, 180) || 'Connected bank'; }
function maskAccount(account) {
  const raw = clean(account?.accountNo || account?.accountNumber || account?.number || account?.displayName, 80);
  if (!raw) return null;
  const tail = raw.replace(/\s/g, '').slice(-4);
  return tail ? `•••• ${tail}` : null;
}
function providerAccountId(account) { return clean(account?.id || account?.accountId, 180); }
function transactionId(tx) { return clean(tx?.id || tx?.transactionId || tx?.externalId, 180); }
function transactionDescription(tx) { return clean(tx?.description || tx?.narrative || tx?.merchant?.name || tx?.merchantName || tx?.class?.title || 'Bank transaction', 500); }
function transactionAmount(tx) {
  const raw = tx?.amount;
  if (typeof raw === 'object' && raw !== null) return decimal(raw.value ?? raw.amount);
  return decimal(raw);
}
function transactionDirection(tx, amount) {
  const direction = clean(tx?.direction || tx?.type || tx?.transactionType, 30).toUpperCase();
  if (/DEBIT|WITHDRAW|OUT|PAYMENT/.test(direction)) return 'DEBIT';
  if (/CREDIT|DEPOSIT|INCOME|IN/.test(direction)) return 'CREDIT';
  return amount < 0 ? 'DEBIT' : 'CREDIT';
}
function canonicalFingerprint(accountId, tx, debit, credit) {
  return hash([accountId, dateOnly(tx?.transactionDate || tx?.postDate || tx?.date) || '', transactionDescription(tx).toLowerCase().replace(/\s+/g, ' '), Number(debit || 0).toFixed(2), Number(credit || 0).toFixed(2)].join('|'));
}
function canonicalRowHash(accountId, tx, debit, credit) {
  const external = transactionId(tx);
  return hash(external ? `provider|${accountId}|${external}` : `fallback|${canonicalFingerprint(accountId, tx, debit, credit)}`);
}

async function ensureLocalAccount(db, connection, linkedAccount, providerAccount) {
  const providerId = providerAccountId(providerAccount);
  if (!providerId) return null;
  if (linkedAccount?.bank_account_id) return Number(linkedAccount.bank_account_id);
  const nickname = clean(providerAccount?.name || providerAccount?.displayName || providerAccount?.accountType || 'Connected account', 120);
  const institution = normalizeInstitution(connection);
  const currency = clean(providerAccount?.currency || 'AUD', 3).toUpperCase() || 'AUD';
  const balance = decimal(providerAccount?.balance ?? providerAccount?.availableFunds ?? providerAccount?.currentBalance);
  const available = providerAccount?.availableFunds ?? providerAccount?.availableBalance;
  const [created] = await db.query(
    `INSERT INTO bank_accounts
      (nickname,institution,account_number_masked,currency,opening_balance,current_ledger_balance,reconciled_balance,status,created_by,ownership_scope,account_type,connection_type,connection_status,available_balance,last_synced_at)
     VALUES (?,?,?,?,0,?,?, 'ACTIVE',?, 'UNCLASSIFIED',?, 'OPEN_BANKING','CONNECTED',?,NOW())`,
    [nickname || 'Connected account', institution, maskAccount(providerAccount), currency, balance, balance, connection.app_user_id || connection.created_by || null, clean(providerAccount?.accountType || providerAccount?.type, 50) || null, available == null ? null : decimal(available)]
  );
  await db.query('UPDATE bank_connection_accounts SET bank_account_id=? WHERE connection_id=? AND provider_account_id=?', [created.insertId, connection.id, providerId]);
  return Number(created.insertId);
}

async function upsertConnectionsAndAccounts(db, provider, appUserId, providerUserId, connectionsPayload, accountsPayload) {
  const providerConnections = list(connectionsPayload);
  const providerAccounts = list(accountsPayload);
  const connections = [];
  for (const remote of providerConnections) {
    const remoteId = clean(remote?.id || remote?.connectionId, 180);
    if (!remoteId) continue;
    const institution = normalizeInstitution(remote);
    const status = clean(remote?.status || remote?.state || 'ACTIVE', 30).toUpperCase();
    const connectionUid = `BCN-${hash(`${provider}|${providerUserId}|${remoteId}`).slice(0, 16).toUpperCase()}`;
    await db.query(
      `INSERT INTO bank_connections
       (connection_uid,provider,institution,provider_connection_id,consent_status,created_by,app_user_id,environment,status,provider_user_id,next_sync_at)
       VALUES (?,?,?,?,?,?,?, ?,?,?, DATE_ADD(NOW(), INTERVAL 6 HOUR))
       ON DUPLICATE KEY UPDATE institution=VALUES(institution), consent_status=VALUES(consent_status), app_user_id=VALUES(app_user_id), environment=VALUES(environment), status=VALUES(status), provider_user_id=VALUES(provider_user_id), updated_at=NOW()`,
      [connectionUid, provider, institution, remoteId, status, appUserId, appUserId, environment(), status, providerUserId]
    );
    const [[connection]] = await db.query('SELECT * FROM bank_connections WHERE provider=? AND provider_connection_id=? LIMIT 1', [provider, remoteId]);
    if (connection) connections.push(connection);
  }
  if (!connections.length) {
    const syntheticId = `USER-${providerUserId}`;
    const connectionUid = `BCN-${hash(`${provider}|${providerUserId}`).slice(0, 16).toUpperCase()}`;
    await db.query(
      `INSERT INTO bank_connections (connection_uid,provider,institution,provider_connection_id,consent_status,created_by,app_user_id,environment,status,provider_user_id,next_sync_at)
       VALUES (?,?, 'Connected institution',?, 'ACTIVE',?,?,?,'ACTIVE',?,DATE_ADD(NOW(), INTERVAL 6 HOUR))
       ON DUPLICATE KEY UPDATE app_user_id=VALUES(app_user_id), provider_user_id=VALUES(provider_user_id), status='ACTIVE', updated_at=NOW()`,
      [connectionUid, provider, syntheticId, appUserId, appUserId, environment(), providerUserId]
    );
    const [[connection]] = await db.query('SELECT * FROM bank_connections WHERE provider=? AND provider_connection_id=? LIMIT 1', [provider, syntheticId]);
    if (connection) connections.push(connection);
  }
  const primary = connections[0];
  if (!primary) return { connections, accounts: [] };
  for (const remote of providerAccounts) {
    const accountId = providerAccountId(remote);
    if (!accountId) continue;
    const currency = clean(remote?.currency || 'AUD', 3).toUpperCase() || 'AUD';
    const current = decimal(remote?.balance ?? remote?.currentBalance);
    const available = remote?.availableFunds ?? remote?.availableBalance;
    await db.query(
      `INSERT INTO bank_connection_accounts
       (connection_id,provider_account_id,account_name,account_type,account_number_masked,currency,current_balance,available_balance,status,provider_updated_at,last_seen_at)
       VALUES (?,?,?,?,?,?,?,?,'ACTIVE',?,NOW())
       ON DUPLICATE KEY UPDATE account_name=VALUES(account_name),account_type=VALUES(account_type),account_number_masked=VALUES(account_number_masked),currency=VALUES(currency),current_balance=VALUES(current_balance),available_balance=VALUES(available_balance),status='ACTIVE',provider_updated_at=VALUES(provider_updated_at),last_seen_at=NOW()`,
      [primary.id, accountId, clean(remote?.name || remote?.displayName, 255) || 'Connected account', clean(remote?.accountType || remote?.type, 80) || null, maskAccount(remote), currency, current, available == null ? null : decimal(available), dateTime(remote?.lastUpdated || remote?.updatedAt)]
    );
    const [[linked]] = await db.query('SELECT * FROM bank_connection_accounts WHERE connection_id=? AND provider_account_id=? LIMIT 1', [primary.id, accountId]);
    const localId = await ensureLocalAccount(db, primary, linked, remote);
    if (localId) {
      await db.query(`UPDATE bank_accounts SET institution=?, account_number_masked=?, currency=?, current_ledger_balance=?, available_balance=?, connection_type='OPEN_BANKING', connection_status='CONNECTED', last_synced_at=NOW(), updated_at=NOW() WHERE id=?`, [normalizeInstitution(primary), maskAccount(remote), currency, current, available == null ? null : decimal(available), localId]);
    }
  }
  return { connections, accounts: providerAccounts };
}

async function ingestTransactions(db, connection, transactionsPayload, provider) {
  const rows = list(transactionsPayload);
  let inserted = 0; let updated = 0; let duplicates = 0;
  for (const tx of rows) {
    const remoteAccountId = clean(tx?.account || tx?.accountId || tx?.account?.id, 180);
    let linked;
    if (remoteAccountId) [[linked]] = await db.query('SELECT * FROM bank_connection_accounts WHERE connection_id=? AND provider_account_id=? LIMIT 1', [connection.id, remoteAccountId]);
    if (!linked) [[linked]] = await db.query('SELECT * FROM bank_connection_accounts WHERE connection_id=? AND bank_account_id IS NOT NULL ORDER BY id LIMIT 1', [connection.id]);
    if (!linked?.bank_account_id) continue;
    const localAccountId = Number(linked.bank_account_id);
    const amount = transactionAmount(tx);
    const direction = transactionDirection(tx, amount);
    const absolute = Math.abs(amount);
    const debit = direction === 'DEBIT' ? absolute : 0;
    const credit = direction === 'CREDIT' ? absolute : 0;
    if (!debit && !credit) continue;
    const externalId = transactionId(tx);
    const fingerprint = canonicalFingerprint(localAccountId, tx, debit, credit);
    const rowHash = canonicalRowHash(localAccountId, tx, debit, credit);
    const rawHash = hash(JSON.stringify(tx));
    const txDate = dateOnly(tx?.transactionDate || tx?.postDate || tx?.date);
    if (!txDate) continue;
    let existing = null;
    if (externalId) [[existing]] = await db.query('SELECT id,provider_raw_hash FROM bank_transactions WHERE bank_account_id=? AND source_provider=? AND provider_transaction_id=? LIMIT 1', [localAccountId, provider, externalId]);
    if (!existing) [[existing]] = await db.query('SELECT id,source_type FROM bank_transactions WHERE bank_account_id=? AND canonical_fingerprint=? AND transaction_date=? LIMIT 1', [localAccountId, fingerprint, txDate]);
    if (existing) {
      if (externalId) await db.query(`UPDATE bank_transactions SET source_provider=?,provider_transaction_id=?,provider_account_id=?,provider_status=?,provider_raw_hash=?,canonical_fingerprint=?,last_seen_at=NOW(),provider_updated_at=? WHERE id=?`, [provider, externalId, remoteAccountId || null, clean(tx?.status || 'POSTED',40), rawHash, fingerprint, dateTime(tx?.lastUpdated || tx?.updatedAt), existing.id]);
      if (existing.provider_raw_hash && existing.provider_raw_hash !== rawHash) updated += 1; else duplicates += 1;
      continue;
    }
    await db.query(
      `INSERT IGNORE INTO bank_transactions
       (bank_account_id,import_batch_uid,row_hash,transaction_date,description,reference,debit,credit,running_balance,reconciliation_status,imported_by,source_type,source_provider,provider_transaction_id,merchant_name,posting_date,currency,ownership_scope,category,classification_status,is_internal_transfer,first_seen_at,last_seen_at,provider_account_id,provider_status,provider_raw_hash,canonical_fingerprint,transaction_timestamp,provider_updated_at)
       SELECT ?,?,?,?,?,?,?,?,?, 'UNRECONCILED',?, 'OPEN_BANKING',?,?,?,?,?,currency,ownership_scope,?, 'UNCLASSIFIED',0,NOW(),NOW(),?,?,?,?,?
       FROM bank_accounts WHERE id=?`,
      [localAccountId, `SYNC-${connection.connection_uid}`, rowHash, txDate, transactionDescription(tx), clean(tx?.reference || tx?.referenceNo,180) || null, debit, credit, tx?.balance == null ? null : decimal(tx.balance), connection.app_user_id || null, provider, externalId || null, clean(tx?.merchant?.name || tx?.merchantName,255) || null, dateOnly(tx?.postDate) || null, clean(tx?.category || tx?.class?.title,120) || null, remoteAccountId || null, clean(tx?.status || 'POSTED',40), rawHash, fingerprint, dateTime(tx?.transactionDate || tx?.postDate), dateTime(tx?.lastUpdated || tx?.updatedAt), localAccountId]
    );
    inserted += 1;
  }
  return { seen: rows.length, inserted, updated, duplicates };
}

async function syncUserBanking({ appUserId, providerUserId, trigger = 'MANUAL', actor = null }) {
  const provider = selectedProvider() || 'BASIQ';
  if (environment() === 'PRODUCTION' && !liveSyncEnabled()) throw Object.assign(new Error('Production bank sync is locked until live sync is explicitly enabled.'), { code: 'LIVE_BANKING_LOCKED', status: 503 });
  const impl = adapter(provider);
  const syncUid = uid('BSYNC');
  const db = await pool.getConnection();
  try {
    await db.query(`INSERT INTO open_banking_sync_runs (sync_uid,provider,environment,trigger_type,status,app_user_id,started_at) VALUES (?,?,?,?, 'RUNNING',?,NOW())`, [syncUid, provider, environment(), trigger, appUserId]);
    const [connectionsPayload, accountsPayload, transactionsPayload] = await Promise.all([impl.listConnections(providerUserId), impl.listAccounts(providerUserId), impl.listTransactions(providerUserId, { limit: 500 })]);
    await db.beginTransaction();
    const linked = await upsertConnectionsAndAccounts(db, provider, appUserId, providerUserId, connectionsPayload, accountsPayload);
    const connection = linked.connections[0];
    if (!connection) throw Object.assign(new Error('Provider connection could not be resolved after consent.'), { code: 'BANK_CONNECTION_NOT_FOUND' });
    const tx = await ingestTransactions(db, connection, transactionsPayload, provider);
    await db.query(`UPDATE bank_connections SET last_sync_started_at=COALESCE(last_sync_started_at,NOW()),last_sync_completed_at=NOW(),last_sync_status='SUCCESS',last_sync_error_code=NULL,next_sync_at=DATE_ADD(NOW(),INTERVAL 6 HOUR),status='ACTIVE' WHERE id=?`, [connection.id]);
    await db.query(`UPDATE open_banking_sync_runs SET connection_uid=?,status='SUCCESS',accounts_seen=?,accounts_linked=?,transactions_seen=?,transactions_inserted=?,transactions_updated=?,duplicates_skipped=?,completed_at=NOW() WHERE sync_uid=?`, [connection.connection_uid, linked.accounts.length, linked.accounts.length, tx.seen, tx.inserted, tx.updated, tx.duplicates, syncUid]);
    await db.query(`INSERT INTO bank_sync_events (event_uid,sync_uid,event_type,event_json) VALUES (?,?, 'SYNC_COMPLETED',?)`, [uid('BSE'), syncUid, JSON.stringify({ accounts: linked.accounts.length, ...tx })]);
    await logAudit(db, { actorId: actor || appUserId, action: 'BANK_SYNC_COMPLETED', module: 'finance_intelligence', recordType: 'bank_sync', recordId: syncUid, newValue: { provider, connection_uid: connection.connection_uid, ...tx } });
    await db.commit();
    return { sync_uid: syncUid, connection_uid: connection.connection_uid, accounts_seen: linked.accounts.length, transactions_seen: tx.seen, inserted: tx.inserted, updated: tx.updated, duplicates: tx.duplicates };
  } catch (error) {
    await db.rollback().catch(() => {});
    await pool.query(`UPDATE open_banking_sync_runs SET status='FAILED',error_code=?,error_detail=?,completed_at=NOW() WHERE sync_uid=?`, [clean(error.code || 'SYNC_FAILED',100), clean(error.message,500), syncUid]).catch(() => {});
    throw error;
  } finally { db.release(); }
}

module.exports = { canonicalFingerprint, ingestTransactions, syncUserBanking };
