// tests/database-and-crons.test.ts — Comprehensive Vitest Suite for DB Layer, Seeding & Refill Cron
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { initDatabase, closeDb, getDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import {
  scanChronicRefills,
  detectChronicCondition,
  formatWhatsAppPhone,
  generateWhatsAppRefillMessage,
} from '@/lib/refills';
import { GET, POST } from '@/app/api/cron/refills/route';
import { NextRequest } from 'next/server';
import fs from 'node:fs';

const TEST_DB_FILE = 'pharmapilot_vitest.db';
let testClient: ReturnType<typeof createClient>;

beforeAll(async () => {
  // Clean start
  for (const ext of ['', '-wal', '-shm']) {
    const file = `${TEST_DB_FILE}${ext}`;
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch {}
    }
  }

  process.env.TURSO_DATABASE_URL = `file:${TEST_DB_FILE}`;
  testClient = createClient({ url: `file:${TEST_DB_FILE}` });
  await initDatabase(testClient);
  await seedDatabase(testClient);
});

afterAll(async () => {
  await testClient.close();
  await closeDb();

  for (const ext of ['', '-wal', '-shm']) {
    for (const prefix of [TEST_DB_FILE, 'pharmapilot.db']) {
      const f = `${prefix}${ext}`;
      if (fs.existsSync(f)) {
        try {
          fs.unlinkSync(f);
        } catch {}
      }
    }
  }
});

describe('1. Database Layer (@libsql/client & 25-Table Schema)', () => {
  it('initializes all 25 tables, view, and FTS5 table matching 0001_init.sql', async () => {
    const res = await testClient.execute(
      "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name"
    );
    const names = res.rows.map((r) => r.name);

    // Essential 25 tables matching 0001_init.sql
    const requiredTables = [
      'shop_profile',
      'roles',
      'users',
      'manufacturers',
      'items',
      'items_fts',
      'item_units',
      'batches',
      'stock_movements',
      'parties',
      'doctors',
      'purchase_invoices',
      'purchase_items',
      'sales_invoices',
      'sales_items',
      'sales_payments',
      'sales_returns',
      'sales_return_items',
      'purchase_returns',
      'purchase_return_items',
      'receipts',
      'payments',
      'expenses',
      'ledger_entries',
      'schedule_register',
      'price_history',
      'audit_log',
      'settings',
      'import_jobs',
      'number_series',
    ];

    for (const table of requiredTables) {
      expect(names).toContain(table);
    }

    // View
    expect(names).toContain('v_batch_stock');
  });

  it('runs initDatabase multiple times idempotently without throwing', async () => {
    await expect(initDatabase(testClient)).resolves.not.toThrow();
  });

  it('verifies settings and roles are seeded by default DDL', async () => {
    const roles = await testClient.execute('SELECT id, name FROM roles');
    expect(roles.rows.length).toBeGreaterThanOrEqual(4);
    const roleIds = roles.rows.map((r) => r.id);
    expect(roleIds).toContain('role_owner');
    expect(roleIds).toContain('role_pharmacist');
    expect(roleIds).toContain('role_billing');
    expect(roleIds).toContain('role_accountant');

    const settings = await testClient.execute('SELECT key, value FROM settings');
    const settingsMap = Object.fromEntries(settings.rows.map((r) => [r.key, r.value]));
    expect(settingsMap['gst_slabs_bp']).toBe('[0, 500, 1200, 1800]');
    expect(settingsMap['min_expiry_months_purchase']).toBe('6');
  });
});

describe('2. Authentic Indian Medicines Seeding & Stock Integrity', () => {
  it('seeds shop profile with Indian GSTIN and drug license numbers', async () => {
    const res = await testClient.execute('SELECT * FROM shop_profile WHERE id = 1');
    expect(res.rows.length).toBe(1);
    const profile = res.rows[0];
    expect(profile.name).toBe('PharmaPilot Wellness Pharmacy');
    expect(profile.gstin).toBe('29AABCU9603R1ZM');
    expect(profile.drug_license_no_1).toBe('KA-B1-2024-00123');
    expect(profile.pharmacist_reg_no).toBe('KSPC/2021/89423');
  });

  it('seeds default admin and pharmacist users', async () => {
    const admin = await testClient.execute("SELECT * FROM users WHERE id = 'user_admin'");
    expect(admin.rows.length).toBe(1);
    expect(admin.rows[0].role_id).toBe('role_owner');

    const pharmacist = await testClient.execute("SELECT * FROM users WHERE id = 'user_pharmacist'");
    expect(pharmacist.rows.length).toBe(1);
    expect(pharmacist.rows[0].role_id).toBe('role_pharmacist');
  });

  it('seeds authentic Indian manufacturers', async () => {
    const mfrs = await testClient.execute('SELECT name FROM manufacturers ORDER BY name');
    const names = mfrs.rows.map((r) => r.name);
    expect(names).toContain('Micro Labs Ltd.');
    expect(names).toContain('GlaxoSmithKline Pharmaceuticals Ltd.');
    expect(names).toContain('Ipca Laboratories Ltd.');
    expect(names).toContain('Torrent Pharmaceuticals Ltd.');
    expect(names).toContain('Alkem Laboratories Ltd.');
    expect(names).toContain('Glenmark Pharmaceuticals Ltd.');
    expect(names).toContain('USV Private Limited');
    expect(names).toContain('Cipla Ltd.');
    expect(names).toContain("Dr. Reddy's Laboratories Ltd.");
    expect(names).toContain('Intas Pharmaceuticals Ltd.');
    expect(names).toContain('Sun Pharmaceutical Industries Ltd.');
  });

  it('seeds all authentic Indian formulations with HSN 3004 and batches', async () => {
    const items = await testClient.execute('SELECT id, name, generic_name, hsn_code, schedule FROM items');
    const itemMap = new Map(items.rows.map((r) => [String(r.id), r]));

    // 1. Dolo 650 (Micro Labs, Paracetamol 650mg)
    expect(itemMap.has('item_dolo_650')).toBe(true);
    expect(itemMap.get('item_dolo_650')?.generic_name).toBe('Paracetamol 650mg');
    expect(itemMap.get('item_dolo_650')?.hsn_code).toBe('3004');

    // 2. Augmentin 625 Duo (GSK, Amoxicillin 500mg + Clavulanic Acid 125mg)
    expect(itemMap.has('item_augmentin_625')).toBe(true);
    expect(itemMap.get('item_augmentin_625')?.schedule).toBe('H');

    // 3. Calpol 650 (GSK, Paracetamol 650mg)
    expect(itemMap.has('item_calpol_650')).toBe(true);

    // 4. Pacimol 650 (Ipca, Paracetamol 650mg)
    expect(itemMap.has('item_pacimol_650')).toBe(true);

    // 5. Shelcal 500 (Torrent, Calcium 500mg + Vitamin D3)
    expect(itemMap.has('item_shelcal_500')).toBe(true);

    // 6. Pan-D (Alkem, Pantoprazole 40mg + Domperidone 30mg)
    expect(itemMap.has('item_pan_d')).toBe(true);
    expect(itemMap.get('item_pan_d')?.schedule).toBe('H');

    // 7. Telma 40 (Glenmark, Telmisartan 40mg)
    expect(itemMap.has('item_telma_40')).toBe(true);

    // 8. Glycomet 500 (USV, Metformin 500mg)
    expect(itemMap.has('item_glycomet_500')).toBe(true);

    // 9. Azithral 500 (Alembic, Azithromycin 500mg)
    expect(itemMap.has('item_azithral_500')).toBe(true);

    // 10. Tugain 5% Solution (Cipla, Minoxidil 5% w/v)
    expect(itemMap.has('item_tugain_5')).toBe(true);

    // 11. Mintop 5% Solution (Dr. Reddy's, Minoxidil 5% w/v)
    expect(itemMap.has('item_mintop_5')).toBe(true);

    // 12. Morr 5% Solution (Intas, Minoxidil 5% w/v)
    expect(itemMap.has('item_morr_5')).toBe(true);

    // 13. Morr-F 5% Solution (Intas, Minoxidil 5% w/v + Finasteride 0.1% w/v)
    expect(itemMap.has('item_morr_f_5')).toBe(true);
    expect(itemMap.get('item_morr_f_5')?.schedule).toBe('H');

    // 14. Lonitab 5mg Tablet (Sun Pharma, Minoxidil 5mg)
    expect(itemMap.has('item_lonitab_5')).toBe(true);
    expect(itemMap.get('item_lonitab_5')?.schedule).toBe('H');

    // 15. Tramadol 50mg & Alprazolam 0.5mg (Schedule H1 for statutory compliance)
    expect(itemMap.has('item_tramadol_50')).toBe(true);
    expect(itemMap.get('item_tramadol_50')?.schedule).toBe('H1');

    expect(itemMap.has('item_alprazolam_05')).toBe(true);
    expect(itemMap.get('item_alprazolam_05')?.schedule).toBe('H1');
  });

  it('keeps Calpol 650 and Mintop 5% out of stock in v_batch_stock to trigger substitute drawer', async () => {
    const res = await testClient.execute(`
      SELECT i.id, i.name, v.current_qty_base
      FROM v_batch_stock v
      JOIN items i ON i.id = v.item_id
      WHERE i.id IN ('item_calpol_650', 'item_mintop_5', 'item_dolo_650', 'item_tugain_5')
    `);

    const stockById = Object.fromEntries(res.rows.map((r) => [r.id, Number(r.current_qty_base)]));

    // Calpol 650 must be 0 stock
    expect(stockById['item_calpol_650']).toBe(0);

    // Mintop 5% must be 0 stock
    expect(stockById['item_mintop_5']).toBe(0);

    // Substitutes Dolo 650 and Tugain 5% must have positive stock
    expect(stockById['item_dolo_650']).toBeGreaterThan(0);
    expect(stockById['item_tugain_5']).toBeGreaterThan(0);
  });
});

describe('3. FTS5 Virtual Table & Search Triggers', () => {
  it('indexes medicine names and salts in items_fts', async () => {
    // Search by generic salt "Paracetamol"
    const pcm = await testClient.execute({
      sql: `SELECT item_id, name, generic_name FROM items_fts WHERE items_fts MATCH 'Paracetamol*'`,
      args: [],
    });
    expect(pcm.rows.length).toBeGreaterThanOrEqual(3);
    const pcmNames = pcm.rows.map((r) => r.name);
    expect(pcmNames).toContain('Dolo 650 Tablet');
    expect(pcmNames).toContain('Calpol 650 Tablet');
    expect(pcmNames).toContain('Pacimol 650 Tablet');

    // Search by generic salt "Minoxidil"
    const minox = await testClient.execute({
      sql: `SELECT item_id, name FROM items_fts WHERE items_fts MATCH 'Minoxidil*'`,
      args: [],
    });
    expect(minox.rows.length).toBeGreaterThanOrEqual(4);
  });

  it('syncs inserted medicines automatically to items_fts via trigger', async () => {
    const newItemId = 'item_test_cetirizine';
    const nowIso = new Date().toISOString();

    await testClient.execute({
      sql: `INSERT INTO items (
        id, name, generic_name, manufacturer_id, category, drug_form,
        hsn_code, gst_rate_bp, schedule, base_unit, rack_location,
        reorder_level, reorder_qty, barcode, is_active, created_at, updated_at
      ) VALUES (?, 'Cetzine 10mg Tablet', 'Cetirizine 10mg', 'mfr_gsk', 'Medicine', 'Tablet',
        '3004', 1200, 'none', 'TAB', 'RACK-E1', 10, 50, '8901999999999', 1, ?, ?)`,
      args: [newItemId, nowIso, nowIso],
    });

    // Verify FTS trigger inserted the entry
    const fts = await testClient.execute({
      sql: `SELECT item_id, name FROM items_fts WHERE items_fts MATCH 'Cetirizine*'`,
      args: [],
    });
    expect(fts.rows.length).toBe(1);
    expect(fts.rows[0].item_id).toBe(newItemId);
  });
});

describe('4. Chronic Refill Automation & WhatsApp Alert Generator', () => {
  it('detects chronic therapeutic conditions correctly', () => {
    expect(detectChronicCondition('Glycomet 500', 'Metformin 500mg')).toBe('Diabetes');
    expect(detectChronicCondition('Telma 40', 'Telmisartan 40mg')).toBe('Hypertension');
    expect(detectChronicCondition('Atorva 20', 'Atorvastatin 20mg')).toBe('Cardiac');
    expect(detectChronicCondition('Budecort 200', 'Budesonide 200mcg')).toBe('Asthma');
    expect(detectChronicCondition('Dolo 650', 'Paracetamol 650mg')).toBeNull();
  });

  it('normalizes Indian phone numbers for WhatsApp click-to-chat links', () => {
    expect(formatWhatsAppPhone('+91 98765 43210')).toBe('919876543210');
    expect(formatWhatsAppPhone('9876543210')).toBe('919876543210');
    expect(formatWhatsAppPhone('09876543210')).toBe('919876543210');
    expect(formatWhatsAppPhone('')).toBe('');
  });

  it('generates personalized WhatsApp click-to-chat link and message', () => {
    const res = generateWhatsAppRefillMessage({
      patientName: 'Ramesh Kumar',
      cleanPhone: '919876511223',
      shopName: 'PharmaPilot Wellness Pharmacy',
      shopPhone: '+91 98765 43210',
      itemName: 'Glycomet 500 Tablet',
      condition: 'Diabetes',
      qtyPurchased: 30,
      daysRemaining: 1,
      depletionDateStr: '2026-10-16',
    });

    expect(res.link).toContain('https://wa.me/919876511223?text=');
    expect(res.message).toContain('Namaste Ramesh Kumar ji');
    expect(res.message).toContain('Glycomet 500 Tablet');
    expect(res.message).toContain('runs out tomorrow');
    expect(decodeURIComponent(res.link)).toContain('Glycomet 500 Tablet');
  });

  it('scans database for chronic refills depleting in <= 3 days', async () => {
    const scan = await scanChronicRefills({ db: testClient, daysThreshold: 3 });

    expect(scan.success).toBe(true);
    expect(scan.alerts.length).toBeGreaterThanOrEqual(2);

    // Patients due for refills
    const patientNames = scan.alerts.map((a) => a.patientName);
    expect(patientNames).toContain('Ramesh Kumar');
    expect(patientNames).toContain('Sunita Verma');

    // Anand Murthy bought Shelcal 10 days ago (20 days remaining) so not triggered
    expect(patientNames).not.toContain('Anand Murthy');

    const rameshAlert = scan.alerts.find((a) => a.patientName === 'Ramesh Kumar')!;
    expect(rameshAlert.condition).toBe('Diabetes');
    expect(rameshAlert.daysRemaining).toBeLessThanOrEqual(3);
    expect(rameshAlert.whatsapp.link).toMatch(/^https:\/\/wa\.me\/91/);
  });
});

describe('5. Next.js API Route (/api/cron/refills) & Auth Check', () => {
  it('rejects unauthorized requests with 401 when CRON_SECRET is set', async () => {
    process.env.CRON_SECRET = 'super_secret_cron_token_123';
    (process.env as any).NODE_ENV = 'production';

    const req = new NextRequest('http://localhost:3000/api/cron/refills', {
      method: 'GET',
      headers: {
        authorization: 'Bearer wrong_token',
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('accepts authorized requests via Bearer token and returns refill JSON', async () => {
    process.env.CRON_SECRET = 'super_secret_cron_token_123';

    const req = new NextRequest('http://localhost:3000/api/cron/refills', {
      method: 'GET',
      headers: {
        authorization: 'Bearer super_secret_cron_token_123',
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.alerts.length).toBeGreaterThanOrEqual(2);
    expect(body.pharmacy.name).toBe('PharmaPilot Wellness Pharmacy');
  });

  it('accepts POST requests from GitHub Actions / webhooks', async () => {
    process.env.CRON_SECRET = 'super_secret_cron_token_123';

    const req = new NextRequest('http://localhost:3000/api/cron/refills', {
      method: 'POST',
      headers: {
        'x-cron-secret': 'super_secret_cron_token_123',
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
