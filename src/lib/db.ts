// src/lib/db.ts — libSQL Client (Local SQLite / Turso Cloud) & Complete 25-Table Schema
import { createClient, type Client } from '@libsql/client';

import fs from 'node:fs';
import path from 'node:path';

let globalClient: Client | null = null;

/**
 * Returns a libSQL client instance.
 * Supports:
 *  - Development: Local SQLite via file:pharmapilot.db (absolute path)
 *  - Vercel Serverless: Copies bundled db to /tmp/pharmapilot.db for writable SQLite
 *  - Production: Turso Cloud libSQL via TURSO_DATABASE_URL and TURSO_AUTH_TOKEN
 */
export function getDb(): Client {
  if (!globalClient) {
    let url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;

    if (!url) {
      if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
        const tmpDbPath = '/tmp/pharmapilot.db';
        const bundledDbPath = path.resolve(process.cwd(), 'pharmapilot.db');

        if (!fs.existsSync(tmpDbPath)) {
          if (fs.existsSync(bundledDbPath)) {
            try {
              fs.copyFileSync(bundledDbPath, tmpDbPath);
            } catch (err) {
              console.error('Notice: Could not copy bundled db to /tmp:', err);
            }
          }
        }
        url = `file:${tmpDbPath}`;
      } else {
        const localPath = path.resolve(process.cwd(), 'pharmapilot.db');
        url = `file:${localPath}`;
      }
    }

    const authToken = process.env.TURSO_AUTH_TOKEN;

    globalClient = createClient({
      url,
      ...(authToken ? { authToken } : {}),
    });
  }
  return globalClient;
}

/**
 * Close and reset current client (useful in unit tests or when switching databases)
 */
export async function closeDb(): Promise<void> {
  if (globalClient) {
    try {
      await globalClient.close();
    } catch {
      // Ignore close errors
    }
    globalClient = null;
  }
}

/**
 * Proxy object delegating all operations to the active libSQL client
 */
export const db: Client = new Proxy({} as Client, {
  get(_target, prop) {
    const client = getDb();
    const val = (client as any)[prop];
    if (typeof val === 'function') {
      return val.bind(client);
    }
    return val;
  },
});

export const SCHEMA_SQL = `
-- PharmaPilot Complete Pharmacy ERP Schema Matching 0001_init.sql

CREATE TABLE IF NOT EXISTS shop_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT DEFAULT '',
    gstin TEXT NOT NULL,
    drug_license_no_1 TEXT NOT NULL,
    drug_license_no_2 TEXT DEFAULT '',
    pharmacist_name TEXT NOT NULL,
    pharmacist_reg_no TEXT NOT NULL,
    state_code TEXT NOT NULL,
    logo_blob BLOB,
    fy_start_month INTEGER NOT NULL DEFAULT 4,
    invoice_prefixes_json TEXT NOT NULL DEFAULT '{"sale":"INV","purchase":"PUR","sale_return":"SRN","purchase_return":"PRN","receipt":"RCT","payment":"PMT","po":"PO"}'
);

CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    permissions_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    pin_or_password_hash TEXT NOT NULL,
    role_id TEXT NOT NULL REFERENCES roles(id),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);

CREATE TABLE IF NOT EXISTS manufacturers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    generic_name TEXT NOT NULL DEFAULT '',
    manufacturer_id TEXT REFERENCES manufacturers(id),
    category TEXT NOT NULL DEFAULT 'Medicine',
    drug_form TEXT NOT NULL DEFAULT 'Tablet',
    hsn_code TEXT NOT NULL DEFAULT '3004',
    gst_rate_bp INTEGER NOT NULL DEFAULT 1200,
    schedule TEXT NOT NULL DEFAULT 'none' CHECK (schedule IN ('none','H','H1','X','NDPS','OTC')),
    base_unit TEXT NOT NULL DEFAULT 'TAB',
    rack_location TEXT NOT NULL DEFAULT '',
    reorder_level INTEGER NOT NULL DEFAULT 20,
    reorder_qty INTEGER NOT NULL DEFAULT 100,
    barcode TEXT NOT NULL DEFAULT '',
    margin_override_bp INTEGER,
    notes TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_manufacturer ON items(manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_items_schedule ON items(schedule);
CREATE INDEX IF NOT EXISTS idx_items_barcode ON items(barcode);
CREATE INDEX IF NOT EXISTS idx_items_active ON items(is_active);

-- FTS5 Virtual Table on items(name, generic_name, barcode) kept in sync by triggers
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
    item_id UNINDEXED,
    name,
    generic_name,
    barcode,
    tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS trg_items_ai AFTER INSERT ON items BEGIN
    INSERT INTO items_fts(rowid, item_id, name, generic_name, barcode)
    VALUES (new.rowid, new.id, new.name, new.generic_name, new.barcode);
END;

CREATE TRIGGER IF NOT EXISTS trg_items_ad AFTER DELETE ON items BEGIN
    DELETE FROM items_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS trg_items_au AFTER UPDATE ON items BEGIN
    DELETE FROM items_fts WHERE rowid = old.rowid;
    INSERT INTO items_fts(rowid, item_id, name, generic_name, barcode)
    VALUES (new.rowid, new.id, new.name, new.generic_name, new.barcode);
END;

CREATE TABLE IF NOT EXISTS item_units (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id),
    unit_name TEXT NOT NULL,
    qty_in_base_unit INTEGER NOT NULL CHECK (qty_in_base_unit >= 1),
    is_default_sale INTEGER NOT NULL DEFAULT 0,
    is_default_purchase INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_item_units_item_id ON item_units(item_id);

CREATE TABLE IF NOT EXISTS batches (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id),
    batch_no TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    mrp_paise INTEGER NOT NULL CHECK (mrp_paise >= 0),
    ptr_paise INTEGER NOT NULL DEFAULT 0,
    pts_paise INTEGER NOT NULL DEFAULT 0,
    purchase_rate_paise INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(item_id, batch_no, mrp_paise)
);
CREATE INDEX IF NOT EXISTS idx_batches_item_id ON batches(item_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON batches(expiry_date);

CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id),
    batch_id TEXT NOT NULL REFERENCES batches(id),
    qty_base_signed INTEGER NOT NULL,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('purchase','sale','purchase_return','sale_return','adjustment','opening','damage','expiry_writeoff','transfer')),
    ref_doc_type TEXT NOT NULL,
    ref_doc_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    user_id TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_batch ON stock_movements(batch_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ref ON stock_movements(ref_doc_type, ref_doc_id);

CREATE VIEW IF NOT EXISTS v_batch_stock AS
SELECT
    b.id AS batch_id,
    b.item_id,
    b.batch_no,
    b.expiry_date,
    b.mrp_paise,
    b.ptr_paise,
    b.pts_paise,
    b.purchase_rate_paise,
    COALESCE(SUM(sm.qty_base_signed), 0) AS current_qty_base
FROM batches b
LEFT JOIN stock_movements sm ON sm.batch_id = b.id
GROUP BY b.id;

CREATE TABLE IF NOT EXISTS parties (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('customer','supplier','both')),
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    state_code TEXT NOT NULL DEFAULT '09',
    gstin TEXT NOT NULL DEFAULT '',
    drug_license_no TEXT NOT NULL DEFAULT '',
    credit_limit_paise INTEGER NOT NULL DEFAULT 0,
    credit_days INTEGER NOT NULL DEFAULT 0,
    opening_balance_paise INTEGER NOT NULL DEFAULT 0,
    opening_balance_type TEXT NOT NULL DEFAULT 'dr' CHECK (opening_balance_type IN ('dr','cr')),
    notes TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_parties_type ON parties(type);
CREATE INDEX IF NOT EXISTS idx_parties_phone ON parties(phone);

CREATE TABLE IF NOT EXISTS doctors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    reg_no TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    clinic TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS purchase_invoices (
    id TEXT PRIMARY KEY,
    supplier_id TEXT NOT NULL REFERENCES parties(id),
    supplier_invoice_no TEXT NOT NULL,
    invoice_date TEXT NOT NULL,
    entry_no TEXT NOT NULL UNIQUE,
    subtotal_paise INTEGER NOT NULL,
    discount_paise INTEGER NOT NULL DEFAULT 0,
    cgst_paise INTEGER NOT NULL DEFAULT 0,
    sgst_paise INTEGER NOT NULL DEFAULT 0,
    igst_paise INTEGER NOT NULL DEFAULT 0,
    round_off_paise INTEGER NOT NULL DEFAULT 0,
    total_paise INTEGER NOT NULL,
    payment_mode TEXT NOT NULL DEFAULT 'credit',
    paid_paise INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','cancelled')),
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_supplier ON purchase_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_date ON purchase_invoices(invoice_date);

CREATE TABLE IF NOT EXISTS purchase_items (
    id TEXT PRIMARY KEY,
    purchase_id TEXT NOT NULL REFERENCES purchase_invoices(id),
    item_id TEXT NOT NULL REFERENCES items(id),
    batch_id TEXT NOT NULL REFERENCES batches(id),
    qty_billed INTEGER NOT NULL,
    qty_free INTEGER NOT NULL DEFAULT 0,
    unit_id TEXT,
    rate_paise INTEGER NOT NULL,
    mrp_paise INTEGER NOT NULL,
    discount_pct_bp INTEGER NOT NULL DEFAULT 0,
    gst_rate_bp INTEGER NOT NULL,
    taxable_paise INTEGER NOT NULL,
    tax_paise INTEGER NOT NULL,
    line_total_paise INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_pid ON purchase_items(purchase_id);

CREATE TABLE IF NOT EXISTS sales_invoices (
    id TEXT PRIMARY KEY,
    invoice_no TEXT NOT NULL UNIQUE,
    invoice_date TEXT NOT NULL,
    customer_id TEXT REFERENCES parties(id),
    doctor_id TEXT REFERENCES doctors(id),
    patient_name TEXT NOT NULL DEFAULT '',
    patient_address TEXT NOT NULL DEFAULT '',
    subtotal_paise INTEGER NOT NULL,
    discount_paise INTEGER NOT NULL DEFAULT 0,
    cgst_paise INTEGER NOT NULL DEFAULT 0,
    sgst_paise INTEGER NOT NULL DEFAULT 0,
    igst_paise INTEGER NOT NULL DEFAULT 0,
    round_off_paise INTEGER NOT NULL DEFAULT 0,
    total_paise INTEGER NOT NULL,
    payment_mode TEXT NOT NULL CHECK (payment_mode IN ('cash','upi','card','credit','split')),
    paid_paise INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','cancelled')),
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales_invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales_invoices(customer_id);

CREATE TABLE IF NOT EXISTS sales_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES sales_invoices(id),
    item_id TEXT NOT NULL REFERENCES items(id),
    batch_id TEXT NOT NULL REFERENCES batches(id),
    qty_base INTEGER NOT NULL,
    unit_id TEXT,
    rate_paise INTEGER NOT NULL,
    mrp_paise INTEGER NOT NULL,
    discount_pct_bp INTEGER NOT NULL DEFAULT 0,
    gst_rate_bp INTEGER NOT NULL,
    taxable_paise INTEGER NOT NULL,
    tax_paise INTEGER NOT NULL,
    line_total_paise INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_items_sid ON sales_items(sale_id);

CREATE TABLE IF NOT EXISTS sales_payments (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES sales_invoices(id),
    mode TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    reference TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sales_payments_sid ON sales_payments(sale_id);

CREATE TABLE IF NOT EXISTS sales_returns (
    id TEXT PRIMARY KEY,
    return_no TEXT NOT NULL UNIQUE,
    return_date TEXT NOT NULL,
    original_sale_id TEXT REFERENCES sales_invoices(id),
    customer_id TEXT REFERENCES parties(id),
    reason TEXT NOT NULL,
    refund_mode TEXT NOT NULL,
    subtotal_paise INTEGER NOT NULL,
    tax_paise INTEGER NOT NULL,
    total_paise INTEGER NOT NULL,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_return_items (
    id TEXT PRIMARY KEY,
    return_id TEXT NOT NULL REFERENCES sales_returns(id),
    item_id TEXT NOT NULL REFERENCES items(id),
    batch_id TEXT NOT NULL REFERENCES batches(id),
    qty_base INTEGER NOT NULL,
    rate_paise INTEGER NOT NULL,
    tax_paise INTEGER NOT NULL,
    line_total_paise INTEGER NOT NULL,
    disposition TEXT NOT NULL DEFAULT 'restock' CHECK (disposition IN ('restock','damage','expiry_writeoff'))
);

CREATE TABLE IF NOT EXISTS purchase_returns (
    id TEXT PRIMARY KEY,
    return_no TEXT NOT NULL UNIQUE,
    return_date TEXT NOT NULL,
    supplier_id TEXT NOT NULL REFERENCES parties(id),
    original_purchase_id TEXT REFERENCES purchase_invoices(id),
    reason TEXT NOT NULL,
    subtotal_paise INTEGER NOT NULL,
    tax_paise INTEGER NOT NULL,
    total_paise INTEGER NOT NULL,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_return_items (
    id TEXT PRIMARY KEY,
    return_id TEXT NOT NULL REFERENCES purchase_returns(id),
    item_id TEXT NOT NULL REFERENCES items(id),
    batch_id TEXT NOT NULL REFERENCES batches(id),
    qty_base INTEGER NOT NULL,
    rate_paise INTEGER NOT NULL,
    tax_paise INTEGER NOT NULL,
    line_total_paise INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY,
    party_id TEXT NOT NULL REFERENCES parties(id),
    date TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    mode TEXT NOT NULL,
    reference TEXT NOT NULL DEFAULT '',
    against_invoice_ids_json TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_receipts_party ON receipts(party_id);

CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    party_id TEXT NOT NULL REFERENCES parties(id),
    date TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    mode TEXT NOT NULL,
    reference TEXT NOT NULL DEFAULT '',
    against_invoice_ids_json TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_payments_party ON payments(party_id);

CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    mode TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    party_id TEXT NOT NULL REFERENCES parties(id),
    date TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    debit_paise INTEGER NOT NULL DEFAULT 0,
    credit_paise INTEGER NOT NULL DEFAULT 0,
    narration TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ledger_party ON ledger_entries(party_id, date);

CREATE TABLE IF NOT EXISTS schedule_register (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES sales_invoices(id),
    sale_item_id TEXT NOT NULL REFERENCES sales_items(id),
    date TEXT NOT NULL,
    patient_name TEXT NOT NULL,
    patient_address TEXT NOT NULL,
    doctor_name TEXT NOT NULL,
    doctor_reg_no TEXT NOT NULL,
    item_name TEXT NOT NULL,
    batch_no TEXT NOT NULL,
    qty INTEGER NOT NULL,
    schedule TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedule_reg_date ON schedule_register(date, schedule);

CREATE TABLE IF NOT EXISTS price_history (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id),
    batch_id TEXT NOT NULL REFERENCES batches(id),
    field TEXT NOT NULL,
    old_value INTEGER NOT NULL,
    new_value INTEGER NOT NULL,
    changed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    old_json TEXT,
    new_json TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    filename TEXT NOT NULL,
    mapping_json TEXT NOT NULL,
    total_rows INTEGER NOT NULL,
    ok_rows INTEGER NOT NULL,
    failed_rows INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_ids_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    user_id TEXT
);

CREATE TABLE IF NOT EXISTS shortbook (
    id TEXT PRIMARY KEY,
    item_id TEXT REFERENCES items(id),
    custom_item_name TEXT NOT NULL DEFAULT '',
    distributor_id TEXT REFERENCES parties(id),
    requested_qty INTEGER NOT NULL DEFAULT 10,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'urgent')),
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ordered', 'received', 'cancelled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shortbook_status ON shortbook(status);

CREATE TABLE IF NOT EXISTS cash_closings (
    id TEXT PRIMARY KEY,
    closing_date TEXT NOT NULL UNIQUE,
    closing_time TEXT NOT NULL,
    cash_system_paise INTEGER NOT NULL DEFAULT 0,
    cash_physical_paise INTEGER NOT NULL DEFAULT 0,
    cash_discrepancy_paise INTEGER NOT NULL DEFAULT 0,
    upi_system_paise INTEGER NOT NULL DEFAULT 0,
    card_system_paise INTEGER NOT NULL DEFAULT 0,
    credit_system_paise INTEGER NOT NULL DEFAULT 0,
    total_sales_paise INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    closed_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cash_closings_date ON cash_closings(closing_date);

CREATE TABLE IF NOT EXISTS number_series (
    doc_type TEXT NOT NULL,
    fy TEXT NOT NULL,
    prefix TEXT NOT NULL,
    next_no INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (doc_type, fy)
);

-- Seed GST slabs and default system roles
INSERT OR IGNORE INTO settings(key, value) VALUES
    ('gst_slabs_bp', '[0, 500, 1200, 1800]'),
    ('nav_pinned', 'false'),
    ('theme', 'light'),
    ('min_expiry_months_purchase', '6'),
    ('margin_basis', 'mrp'),
    ('allow_negative_stock', 'false');

INSERT OR IGNORE INTO roles(id, name, permissions_json) VALUES
    ('role_owner', 'Owner', '{"all":true,"view_cost":true,"max_discount_pct":100,"cancel_bill":true,"stock_adjust":true,"view_reports":true,"view_gst":true,"import_data":true,"backup_restore":true,"delete_masters":true}'),
    ('role_pharmacist', 'Pharmacist', '{"all":false,"view_cost":true,"max_discount_pct":15,"cancel_bill":true,"stock_adjust":true,"view_reports":true,"view_gst":false,"import_data":true,"backup_restore":false,"delete_masters":false}'),
    ('role_billing', 'Billing Staff', '{"all":false,"view_cost":false,"max_discount_pct":10,"cancel_bill":false,"stock_adjust":false,"view_reports":false,"view_gst":false,"import_data":false,"backup_restore":false,"delete_masters":false}'),
    ('role_accountant', 'Accountant', '{"all":false,"view_cost":true,"max_discount_pct":0,"cancel_bill":false,"stock_adjust":false,"view_reports":true,"view_gst":true,"import_data":false,"backup_restore":true,"delete_masters":false}');
`;

/**
 * Initializes the database by executing the full 25-table schema,
 * setting WAL mode, enabling foreign keys, and configuring FTS5 triggers.
 */
export async function initDatabase(clientToUse?: Client): Promise<void> {
  const client = clientToUse || getDb();

  // Apply SQLite PRAGMAs (safely handled for both local SQLite and Turso HTTP)
  try {
    await client.execute('PRAGMA foreign_keys = ON;');
    await client.execute('PRAGMA busy_timeout = 5000;');
    await client.execute('PRAGMA journal_mode = WAL;');
  } catch {
    // Some remote drivers like Turso HTTP might reject or ignore journal_mode
  }

  // Execute full schema
  await client.executeMultiple(SCHEMA_SQL);
}
