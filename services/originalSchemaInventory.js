'use strict';
// This read-only preflight observes historical tables before any additive helper runs.
// Missing tables are reported, never silently interpreted as permission to erase records.
const ORIGINAL_BASE_SCHEMA = Object.freeze({
  users: ['id', 'email', 'role', 'permissions', 'active', 'manager_id'],
  rfqs: ['id', 'customer_name', 'email', 'material', 'quantity', 'application', 'status'],
  invoices: ['id', 'invoice_no', 'rfq_id', 'customer_name', 'customer_email', 'quantity', 'unit_price', 'gst_rate', 'total', 'status', 'deleted', 'document_revision'],
  customers: ['id', 'company_name', 'contact_name', 'email', 'deleted'],
  suppliers: ['id', 'supplier_name', 'email', 'deleted'],
  stock_batches: ['id', 'product_name', 'batch_code', 'unit_qty', 'current_unit_qty', 'deleted'],
  stock_movements: ['id', 'stock_id', 'quantity', 'unit_price', 'total_price', 'created_by'],
  material_inventory: ['id', 'inventory_type', 'item_name', 'input_qty', 'current_qty', 'unit_price', 'deleted'],
  staff_attendance: ['id', 'user_id', 'clock_in', 'clock_out', 'work_date', 'total_minutes', 'total_hours', 'deleted'],
  weekly_timesheets: ['id', 'user_id', 'week_start', 'week_end', 'total_hours', 'status'],
  roster_shifts: ['id', 'user_id', 'shift_date', 'start_time', 'end_time', 'status', 'deleted'],
  tasks: ['id', 'title', 'assigned_to', 'assigned_by', 'status', 'due_date', 'deleted'],
  meetings: ['id', 'title', 'meeting_date', 'deleted'],
  expenses: ['id', 'expense_date', 'supplier_name', 'total_amount', 'gst_amount', 'status', 'deleted'],
  compliance_entries: ['id', 'category', 'title', 'status', 'deleted'],
  secure_documents: ['id', 'module', 'record_type', 'record_id', 'original_name', 'stored_name', 'scan_status'],
  audit_logs: ['id', 'actor_id', 'action', 'module', 'record_id', 'old_value', 'new_value', 'created_at']
});

async function inspectOriginalSchema(db) {
  const [rows] = await db.query(`SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, DATA_TYPE AS data_type, COLUMN_TYPE AS column_type, IS_NULLABLE AS is_nullable
    FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position`);
  const tables = new Map();
  for (const row of rows) {
    if (!tables.has(row.table_name)) tables.set(row.table_name, new Map());
    tables.get(row.table_name).set(row.column_name, { type: row.column_type, nullable: row.is_nullable === 'YES' });
  }
  const missingTables = [], missingColumns = [];
  for (const [table, required] of Object.entries(ORIGINAL_BASE_SCHEMA)) {
    const existing = tables.get(table);
    if (!existing) { missingTables.push(table); continue; }
    for (const column of required) if (!existing.has(column)) missingColumns.push(`${table}.${column}`);
  }
  return {
    inspectedAt: new Date().toISOString(), existingTableCount: tables.size,
    originalTableCount: Object.keys(ORIGINAL_BASE_SCHEMA).length,
    missingTables, missingColumns,
    tables: Object.fromEntries([...tables].filter(([name]) => Object.hasOwn(ORIGINAL_BASE_SCHEMA, name)).map(([name, columns]) => [name, Object.fromEntries(columns)])),
    compatible: !missingTables.length && !missingColumns.length,
    migrationPolicy: 'Add missing original structures and nullable compatibility fields only; preserve records, attachments, IDs and keys.'
  };
}
module.exports = { ORIGINAL_BASE_SCHEMA, inspectOriginalSchema };
