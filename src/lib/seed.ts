// src/lib/seed.ts — Production Seeder with Authentic Indian Pharma Data & CDSCO Masters
import { getDb, initDatabase } from './db';
import type { Client } from '@libsql/client';

export interface SeedResult {
  shopName: string;
  manufacturersCount: number;
  itemsCount: number;
  batchesCount: number;
  stockMovementsCount: number;
  chronicPatientsCount: number;
  salesInvoicesCount: number;
}

/**
 * Seeds PharmaPilot with authentic Indian chemist inventory, CDSCO masters,
 * and test data for chronic refill tracking and CDSCO Schedule H1 statutory compliance.
 */
export async function seedDatabase(clientToUse?: Client): Promise<SeedResult> {
  const db = clientToUse || getDb();

  // Ensure full schema is initialized first
  await initDatabase(db);

  const nowIso = new Date().toISOString();
  const todayIso = nowIso.slice(0, 10);

  // 1. Default Shop Profile (Indiranagar, Bengaluru Chemist)
  await db.execute({
    sql: `INSERT OR REPLACE INTO shop_profile (
      id, name, address, phone, email, gstin,
      drug_license_no_1, drug_license_no_2, pharmacist_name, pharmacist_reg_no,
      state_code, fy_start_month, invoice_prefixes_json
    ) VALUES (
      1,
      'PharmaPilot Wellness Pharmacy',
      'Shop 4, Ground Floor, 100 Feet Road, Indiranagar, Bengaluru, Karnataka 560038',
      '+91 98765 43210',
      'contact@pharmapilot.in',
      '29AABCU9603R1ZM',
      'KA-B1-2024-00123',
      'KA-B1-2024-00124',
      'Rahul Sharma, B.Pharm',
      'KSPC/2021/89423',
      '29',
      4,
      '{"sale":"INV","purchase":"PUR","sale_return":"SRN","purchase_return":"PRN","receipt":"RCT","payment":"PMT","po":"PO"}'
    )`,
    args: [],
  });

  // 2. Default Roles (Owner, Pharmacist, Billing Staff, Accountant)
  const roles = [
    {
      id: 'role_owner',
      name: 'Owner',
      permissions: JSON.stringify({
        all: true,
        view_cost: true,
        max_discount_pct: 100,
        cancel_bill: true,
        stock_adjust: true,
        view_reports: true,
        view_gst: true,
        import_data: true,
        backup_restore: true,
        delete_masters: true,
      }),
    },
    {
      id: 'role_pharmacist',
      name: 'Pharmacist',
      permissions: JSON.stringify({
        all: false,
        view_cost: true,
        max_discount_pct: 15,
        cancel_bill: true,
        stock_adjust: true,
        view_reports: true,
        view_gst: false,
        import_data: true,
        backup_restore: false,
        delete_masters: false,
      }),
    },
    {
      id: 'role_billing',
      name: 'Billing Staff',
      permissions: JSON.stringify({
        all: false,
        view_cost: false,
        max_discount_pct: 10,
        cancel_bill: false,
        stock_adjust: false,
        view_reports: false,
        view_gst: false,
        import_data: false,
        backup_restore: false,
        delete_masters: false,
      }),
    },
    {
      id: 'role_accountant',
      name: 'Accountant',
      permissions: JSON.stringify({
        all: false,
        view_cost: true,
        max_discount_pct: 0,
        cancel_bill: false,
        stock_adjust: false,
        view_reports: true,
        view_gst: true,
        import_data: false,
        backup_restore: true,
        delete_masters: false,
      }),
    },
  ];

  for (const r of roles) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO roles (id, name, permissions_json) VALUES (?, ?, ?)`,
      args: [r.id, r.name, r.permissions],
    });
  }

  // 3. Default Admin & Pharmacist Users
  await db.execute({
    sql: `INSERT OR REPLACE INTO users (id, name, username, pin_or_password_hash, role_id, active, created_at)
          VALUES ('user_admin', 'System Administrator', 'admin', 'admin123', 'role_owner', 1, ?)`,
    args: [nowIso],
  });
  await db.execute({
    sql: `INSERT OR REPLACE INTO users (id, name, username, pin_or_password_hash, role_id, active, created_at)
          VALUES ('user_pharmacist', 'Rahul Sharma', 'pharmacist', '1234', 'role_pharmacist', 1, ?)`,
    args: [nowIso],
  });

  // 4. Authentic Indian Pharmaceutical Manufacturers
  const manufacturers = [
    { id: 'mfr_microlabs', name: 'Micro Labs Ltd.' },
    { id: 'mfr_gsk', name: 'GlaxoSmithKline Pharmaceuticals Ltd.' },
    { id: 'mfr_ipca', name: 'Ipca Laboratories Ltd.' },
    { id: 'mfr_torrent', name: 'Torrent Pharmaceuticals Ltd.' },
    { id: 'mfr_alkem', name: 'Alkem Laboratories Ltd.' },
    { id: 'mfr_glenmark', name: 'Glenmark Pharmaceuticals Ltd.' },
    { id: 'mfr_usv', name: 'USV Private Limited' },
    { id: 'mfr_alembic', name: 'Alembic Pharmaceuticals Ltd.' },
    { id: 'mfr_cipla', name: 'Cipla Ltd.' },
    { id: 'mfr_drreddys', name: "Dr. Reddy's Laboratories Ltd." },
    { id: 'mfr_intas', name: 'Intas Pharmaceuticals Ltd.' },
    { id: 'mfr_sunpharma', name: 'Sun Pharmaceutical Industries Ltd.' },
  ];

  for (const m of manufacturers) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO manufacturers (id, name, is_active, created_at) VALUES (?, ?, 1, ?)`,
      args: [m.id, m.name, nowIso],
    });
  }

  // 5. Authentic Indian Medicines Specification
  interface ItemSeed {
    id: string;
    name: string;
    generic_name: string;
    mfr_id: string;
    category: string;
    drug_form: string;
    hsn_code: string;
    gst_rate_bp: number;
    schedule: 'none' | 'H' | 'H1' | 'X' | 'NDPS' | 'OTC';
    base_unit: string;
    rack: string;
    reorder_level: number;
    reorder_qty: number;
    barcode: string;
    pack_name: string;
    pack_qty: number;
    batch_id: string;
    batch_no: string;
    expiry_date: string;
    mrp_paise: number; // per base unit
    ptr_paise: number;
    pts_paise: number;
    purchase_rate_paise: number;
    opening_stock_base: number; // 0 for out-of-stock items
  }

  const itemsSeed: ItemSeed[] = [
    // 1. Dolo 650 (Micro Labs, Paracetamol 650mg)
    {
      id: 'item_dolo_650',
      name: 'Dolo 650 Tablet',
      generic_name: 'Paracetamol 650mg',
      mfr_id: 'mfr_microlabs',
      category: 'Medicine',
      drug_form: 'Tablet',
      hsn_code: '3004',
      gst_rate_bp: 1200,
      schedule: 'none',
      base_unit: 'TAB',
      rack: 'RACK-A1',
      reorder_level: 50,
      reorder_qty: 200,
      barcode: '8901148203012',
      pack_name: 'STRIP',
      pack_qty: 15,
      batch_id: 'batch_dolo_01',
      batch_no: 'DL24K12',
      expiry_date: '2027-08-31',
      mrp_paise: 224, // ₹33.60 per strip of 15
      ptr_paise: 160,
      pts_paise: 150,
      purchase_rate_paise: 150,
      opening_stock_base: 1500, // 100 strips
    },
    // 2. Augmentin 625 Duo (GSK, Amoxicillin 500mg + Clavulanic Acid 125mg)
    {
      id: 'item_augmentin_625',
      name: 'Augmentin 625 Duo Tablet',
      generic_name: 'Amoxicillin 500mg + Clavulanic Acid 125mg',
      mfr_id: 'mfr_gsk',
      category: 'Medicine',
      drug_form: 'Tablet',
      hsn_code: '3004',
      gst_rate_bp: 1200,
      schedule: 'H',
      base_unit: 'TAB',
      rack: 'RACK-A2',
      reorder_level: 30,
      reorder_qty: 100,
      barcode: '8901037001423',
      pack_name: 'STRIP',
      pack_qty: 10,
      batch_id: 'batch_aug_01',
      batch_no: 'AG24H08',
      expiry_date: '2026-11-30',
      mrp_paise: 2017, // ₹201.71 per strip of 10
      ptr_paise: 1440,
      pts_paise: 1350,
      purchase_rate_paise: 1350,
      opening_stock_base: 500, // 50 strips
    },
    // 3. Calpol 650 (GSK, Paracetamol 650mg - OUT OF STOCK to trigger substitute drawer)
    {
      id: 'item_calpol_650',
      name: 'Calpol 650 Tablet',
      generic_name: 'Paracetamol 650mg',
      mfr_id: 'mfr_gsk',
      category: 'Medicine',
      drug_form: 'Tablet',
      hsn_code: '3004',
      gst_rate_bp: 1200,
      schedule: 'none',
      base_unit: 'TAB',
      rack: 'RACK-A1',
      reorder_level: 40,
      reorder_qty: 150,
      barcode: '8901037005124',
      pack_name: 'STRIP',
      pack_qty: 15,
      batch_id: 'batch_calpol_01',
      batch_no: 'CP24G01',
      expiry_date: '2027-05-31',
      mrp_paise: 224, // ₹33.60 per strip of 15
      ptr_paise: 160,
      pts_paise: 150,
      purchase_rate_paise: 150,
      opening_stock_base: 0, // Explicitly 0 to trigger substitute drawer
    },
    // 4. Pacimol 650 (Ipca, Paracetamol 650mg)
    {
      id: 'item_pacimol_650',
      name: 'Pacimol 650 Tablet',
      generic_name: 'Paracetamol 650mg',
      mfr_id: 'mfr_ipca',
      category: 'Medicine',
      drug_form: 'Tablet',
      hsn_code: '3004',
      gst_rate_bp: 1200,
      schedule: 'none',
      base_unit: 'TAB',
      rack: 'RACK-A1',
      reorder_level: 30,
      reorder_qty: 100,
      barcode: '8901090102030',
      pack_name: 'STRIP',
      pack_qty: 15,
      batch_id: 'batch_pacimol_01',
      batch_no: 'PC24L09',
      expiry_date: '2027-09-30',
      mrp_paise: 210, // ₹31.50 per strip of 15
      ptr_paise: 150,
      pts_paise: 140,
      purchase_rate_paise: 140,
      opening_stock_base: 600, // 40 strips
    },
    // 5. Shelcal 500 (Torrent, Calcium 500mg + Vitamin D3)
    {
      id: 'item_shelcal_500',
      name: 'Shelcal 500 Tablet',
      generic_name: 'Calcium 500mg + Vitamin D3',
      mfr_id: 'mfr_torrent',
      category: 'Medicine',
      drug_form: 'Tablet',
      hsn_code: '3004',
      gst_rate_bp: 1200,
      schedule: 'none',
      base_unit: 'TAB',
      rack: 'RACK-B1',
      reorder_level: 40,
      reorder_qty: 120,
      barcode: '8901117210041',
      pack_name: 'STRIP',
      pack_qty: 15,
      batch_id: 'batch_shelcal_01',
      batch_no: 'SH24F11',
      expiry_date: '2026-12-31',
      mrp_paise: 950, // ₹142.50 per strip of 15
      ptr_paise: 680,
      pts_paise: 640,
      purchase_rate_paise: 640,
      opening_stock_base: 750, // 50 strips
    },
    // 6. Pan-D (Alkem, Pantoprazole 40mg + Domperidone 30mg)
    {
      id: 'item_pan_d',
      name: 'Pan-D Capsule',
      generic_name: 'Pantoprazole 40mg + Domperidone 30mg',
      mfr_id: 'mfr_alkem',
      category: 'Medicine',
      drug_form: 'Capsule',
      hsn_code: '3004',
      gst_rate_bp: 1200,
      schedule: 'H',
      base_unit: 'CAP',
      rack: 'RACK-B2',
      reorder_level: 30,
      reorder_qty: 100,
      barcode: '8901123450012',
      pack_name: 'STRIP',
      pack_qty: 15,
      batch_id: 'batch_pand_01',
      batch_no: 'PD24J15',
      expiry_date: '2027-03-31',
      mrp_paise: 1450, // ₹217.50 per strip of 15
      ptr_paise: 1040,
      pts_paise: 975,
      purchase_rate_paise: 975,
      opening_stock_base: 450, // 30 strips
    },
    // 7. Telma 40 (Glenmark, Telmisartan 40mg - Chronic Hypertension)
    {
      id: 'item_telma_40',
      name: 'Telma 40 Tablet',
      generic_name: 'Telmisartan 40mg',
      mfr_id: 'mfr_glenmark',
      category: 'Medicine',
      drug_form: 'Tablet',
      hsn_code: '3004',
      gst_rate_bp: 1200,
      schedule: 'H',
      base_unit: 'TAB',
      rack: 'RACK-C1',
      reorder_level: 40,
      reorder_qty: 150,
      barcode: '8901166304012',
      pack_name: 'STRIP',
      pack_qty: 15,
      batch_id: 'batch_telma_01',
      batch_no: 'TL24D05',
      expiry_date: '2027-04-30',
      mrp_paise: 1620, // ₹243.00 per strip of 15
      ptr_paise: 1160,
      pts_paise: 1090,
      purchase_rate_paise: 1090,
      opening_stock_base: 600, // 40 strips
    },
    // 8. Glycomet 500 (USV, Metformin 500mg - Chronic Diabetes)
    {
      id: 'item_glycomet_500',
      name: 'Glycomet 500 Tablet',
      generic_name: 'Metformin 500mg',
      mfr_id: 'mfr_usv',
      category: 'Medicine',
      drug_form: 'Tablet',
      hsn_code: '3004',
      gst_rate_bp: 1200,
      schedule: 'H',
      base_unit: 'TAB',
      rack: 'RACK-C2',
      reorder_level: 50,
      reorder_qty: 200,
      barcode: '8901188001019',
      pack_name: 'STRIP',
      pack_qty: 10,
      batch_id: 'batch_glycomet_01',
      batch_no: 'GM24E19',
      expiry_date: '2027-01-31',
      mrp_paise: 240, // ₹24.00 per strip of 10
      ptr_paise: 170,
      pts_paise: 160,
      purchase_rate_paise: 160,
      opening_stock_base: 1000, // 100 strips
    },
    // 9. Azithral 500 (Alembic, Azithromycin 500mg)
    {
      id: 'item_azithral_500',
      name: 'Azithral 500 Tablet',
      generic_name: 'Azithromycin 500mg',
      mfr_id: 'mfr_alembic',
      category: 'Medicine',
      drug_form: 'Tablet',
      hsn_code: '3004',
      gst_rate_bp: 1200,
      schedule: 'H',
      base_unit: 'TAB',
      rack: 'RACK-A3',
      reorder_level: 25,
      reorder_qty: 80,
      barcode: '8901235002018',
      pack_name: 'STRIP',
      pack_qty: 5,
      batch_id: 'batch_azithral_01',
      batch_no: 'AZ24A22',
      expiry_date: '2026-10-31',
      mrp_paise: 2680, // ₹134.00 per strip of 5
      ptr_paise: 1920,
      pts_paise: 1800,
      purchase_rate_paise: 1800,
      opening_stock_base: 300, // 60 strips
    },
    // 10. Tugain 5% Solution (Cipla, Minoxidil 5% w/v)
    {
      id: 'item_tugain_5',
      name: 'Tugain 5% Solution (60ml)',
      generic_name: 'Minoxidil 5% w/v',
      mfr_id: 'mfr_cipla',
      category: 'Medicine',
      drug_form: 'Solution',
      hsn_code: '3004',
      gst_rate_bp: 1200,
      schedule: 'none',
      base_unit: 'BOTTLE',
      rack: 'RACK-D1',
      reorder_level: 10,
      reorder_qty: 30,
      barcode: '8901111005012',
      pack_name: 'BOTTLE',
      pack_qty: 1,
      batch_id: 'batch_tugain_01',
      batch_no: 'TG24B02',
      expiry_date: '2027-02-28',
      mrp_paise: 89000, // ₹890.00
      ptr_paise: 63600,
      pts_paise: 60000,
      purchase_rate_paise: 60000,
      opening_stock_base: 35,
    },
    // 11. Mintop 5% Solution (Dr. Reddy's, Minoxidil 5% w/v - OUT OF STOCK for substitute drawer)
    {
      id: 'item_mintop_5',
      name: 'Mintop 5% Solution (60ml)',
      generic_name: 'Minoxidil 5% w/v',
      mfr_id: 'mfr_drreddys',
      category: 'Medicine',
      drug_form: 'Solution',
      hsn_code: '3004',
      gst_rate_bp: 1200,
      schedule: 'none',
      base_unit: 'BOTTLE',
      rack: 'RACK-D1',
      reorder_level: 10,
      reorder_qty: 30,
      barcode: '8901112004018',
      pack_name: 'BOTTLE',
      pack_qty: 1,
      batch_id: 'batch_mintop_01',
      batch_no: 'MT24K09',
      expiry_date: '2026-12-31',
      mrp_paise: 92000, // ₹920.00
      ptr_paise: 65700,
      pts_paise: 62000,
      purchase_rate_paise: 62000,
      opening_stock_base: 0, // OUT OF STOCK
    },
    // 12. Morr 5% Solution (Intas, Minoxidil 5% w/v)
    {
      id: 'item_morr_5',
      name: 'Morr 5% Solution (60ml)',
      generic_name: 'Minoxidil 5% w/v',
      mfr_id: 'mfr_intas',
      category: 'Medicine',
      drug_form: 'Solution',
      hsn_code: '3004',
      gst_rate_bp: 1200,
      schedule: 'none',
      base_unit: 'BOTTLE',
      rack: 'RACK-D2',
      reorder_level: 10,
      reorder_qty: 30,
      barcode: '8901113007019',
      pack_name: 'BOTTLE',
      pack_qty: 1,
      batch_id: 'batch_morr_01',
      batch_no: 'MR24C11',
      expiry_date: '2027-05-31',
      mrp_paise: 84000, // ₹840.00
      ptr_paise: 60000,
      pts_paise: 56500,
      purchase_rate_paise: 56500,
      opening_stock_base: 25,
    },
    // 13. Morr-F 5% Solution (Intas, Minoxidil 5% w/v + Finasteride 0.1% w/v, Schedule H)
    {
      id: 'item_morr_f_5',
      name: 'Morr-F 5% Solution (60ml)',
      generic_name: 'Minoxidil 5% w/v + Finasteride 0.1% w/v',
      mfr_id: 'mfr_intas',
      category: 'Medicine',
      drug_form: 'Solution',
      hsn_code: '3004',
      gst_rate_bp: 1200,
      schedule: 'H',
      base_unit: 'BOTTLE',
      rack: 'RACK-D2',
      reorder_level: 8,
      reorder_qty: 25,
      barcode: '8901113009013',
      pack_name: 'BOTTLE',
      pack_qty: 1,
      batch_id: 'batch_morrf_01',
      batch_no: 'MF24E01',
      expiry_date: '2027-07-31',
      mrp_paise: 99500, // ₹995.00
      ptr_paise: 71000,
      pts_paise: 67000,
      purchase_rate_paise: 67000,
      opening_stock_base: 20,
    },
    // 14. Lonitab 5mg Tablet (Sun Pharma, Minoxidil 5mg, Schedule H)
    {
      id: 'item_lonitab_5',
      name: 'Lonitab 5mg Tablet',
      generic_name: 'Minoxidil 5mg',
      mfr_id: 'mfr_sunpharma',
      category: 'Medicine',
      drug_form: 'Tablet',
      hsn_code: '3004',
      gst_rate_bp: 1200,
      schedule: 'H',
      base_unit: 'TAB',
      rack: 'RACK-C3',
      reorder_level: 20,
      reorder_qty: 60,
      barcode: '8901114006015',
      pack_name: 'STRIP',
      pack_qty: 10,
      batch_id: 'batch_lonitab_01',
      batch_no: 'LT24G14',
      expiry_date: '2027-03-31',
      mrp_paise: 1850, // ₹185.00 per strip of 10
      ptr_paise: 1320,
      pts_paise: 1250,
      purchase_rate_paise: 1250,
      opening_stock_base: 200,
    },
    // 15. Tramadol 50mg (Sun Pharma, Schedule H1 for Statutory Compliance Testing)
    {
      id: 'item_tramadol_50',
      name: 'Tramadol 50mg Capsule',
      generic_name: 'Tramadol Hydrochloride 50mg',
      mfr_id: 'mfr_sunpharma',
      category: 'Medicine',
      drug_form: 'Capsule',
      hsn_code: '3004',
      gst_rate_bp: 1200,
      schedule: 'H1',
      base_unit: 'CAP',
      rack: 'RACK-LOCKER',
      reorder_level: 15,
      reorder_qty: 50,
      barcode: '8901115003011',
      pack_name: 'STRIP',
      pack_qty: 10,
      batch_id: 'batch_tramadol_01',
      batch_no: 'TR24J09',
      expiry_date: '2026-09-30',
      mrp_paise: 1200, // ₹120.00 per strip of 10
      ptr_paise: 860,
      pts_paise: 800,
      purchase_rate_paise: 800,
      opening_stock_base: 100,
    },
    // 16. Alprazolam 0.5mg / Alprax 0.5 (Torrent, Schedule H1 for Statutory Compliance Testing)
    {
      id: 'item_alprazolam_05',
      name: 'Alprax 0.5mg Tablet',
      generic_name: 'Alprazolam 0.5mg',
      mfr_id: 'mfr_torrent',
      category: 'Medicine',
      drug_form: 'Tablet',
      hsn_code: '3004',
      gst_rate_bp: 1200,
      schedule: 'H1',
      base_unit: 'TAB',
      rack: 'RACK-LOCKER',
      reorder_level: 20,
      reorder_qty: 60,
      barcode: '8901115004018',
      pack_name: 'STRIP',
      pack_qty: 15,
      batch_id: 'batch_alprax_01',
      batch_no: 'AP24K18',
      expiry_date: '2026-11-30',
      mrp_paise: 420, // ₹63.00 per strip of 15
      ptr_paise: 300,
      pts_paise: 280,
      purchase_rate_paise: 280,
      opening_stock_base: 150,
    },
  ];

  let stockMovementsCount = 0;

  for (const item of itemsSeed) {
    // Insert item
    await db.execute({
      sql: `INSERT OR REPLACE INTO items (
        id, name, generic_name, manufacturer_id, category, drug_form,
        hsn_code, gst_rate_bp, schedule, base_unit, rack_location,
        reorder_level, reorder_qty, barcode, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      args: [
        item.id,
        item.name,
        item.generic_name,
        item.mfr_id,
        item.category,
        item.drug_form,
        item.hsn_code,
        item.gst_rate_bp,
        item.schedule,
        item.base_unit,
        item.rack,
        item.reorder_level,
        item.reorder_qty,
        item.barcode,
        nowIso,
        nowIso,
      ],
    });

    // Insert Item Base Unit
    await db.execute({
      sql: `INSERT OR REPLACE INTO item_units (id, item_id, unit_name, qty_in_base_unit, is_default_sale, is_default_purchase)
            VALUES (?, ?, ?, 1, 1, 0)`,
      args: [`unit_${item.id}_base`, item.id, item.base_unit],
    });

    // Insert Pack Unit (if different from base unit)
    if (item.pack_qty > 1) {
      await db.execute({
        sql: `INSERT OR REPLACE INTO item_units (id, item_id, unit_name, qty_in_base_unit, is_default_sale, is_default_purchase)
              VALUES (?, ?, ?, ?, 0, 1)`,
        args: [`unit_${item.id}_pack`, item.id, item.pack_name, item.pack_qty],
      });
    }

    // Insert Batch
    await db.execute({
      sql: `INSERT OR REPLACE INTO batches (
        id, item_id, batch_no, expiry_date, mrp_paise, ptr_paise, pts_paise, purchase_rate_paise, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        item.batch_id,
        item.id,
        item.batch_no,
        item.expiry_date,
        item.mrp_paise,
        item.ptr_paise,
        item.pts_paise,
        item.purchase_rate_paise,
        nowIso,
      ],
    });

    // Insert Opening Stock Movement (only if opening stock > 0)
    if (item.opening_stock_base > 0) {
      await db.execute({
        sql: `INSERT OR REPLACE INTO stock_movements (
          id, item_id, batch_id, qty_base_signed, movement_type, ref_doc_type, ref_doc_id, created_at, user_id
        ) VALUES (?, ?, ?, ?, 'opening', 'opening', 'INIT-STOCK', ?, 'user_admin')`,
        args: [
          `sm_open_${item.id}`,
          item.id,
          item.batch_id,
          item.opening_stock_base,
          nowIso,
        ],
      });
      stockMovementsCount++;
    }
  }

  // 6. Registered Medical Practitioners (Doctors for CDSCO compliance)
  const doctors = [
    {
      id: 'doc_dr_sharma',
      name: 'Dr. Ashok Sharma, MBBS MD',
      reg_no: 'KMC/1998/45612',
      phone: '+91 98450 12345',
      clinic: 'Apex Care Clinic, Indiranagar',
    },
    {
      id: 'doc_dr_patel',
      name: 'Dr. Meera Patel, MD (Endocrinology & Cardiology)',
      reg_no: 'KMC/2005/78901',
      phone: '+91 98450 67890',
      clinic: 'Diabetes & Heart Speciality Centre',
    },
  ];

  for (const doc of doctors) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO doctors (id, name, reg_no, phone, clinic, is_active)
            VALUES (?, ?, ?, ?, ?, 1)`,
      args: [doc.id, doc.name, doc.reg_no, doc.phone, doc.clinic],
    });
  }

  // 7. Parties (Chronic Patients & Distributors)
  const parties = [
    {
      id: 'party_dist_medirep',
      type: 'supplier',
      name: 'MediRep Pharma Distributors',
      phone: '+91 98860 11223',
      email: 'orders@medirep.in',
      address: '22, Wholesale Medicine Market, Sultanpet, Bengaluru 560053',
      state_code: '29',
      gstin: '29AAECM1234P1Z3',
      drug_license_no: 'KA-B1-2019-99881',
    },
    {
      id: 'party_patient_ramesh',
      type: 'customer',
      name: 'Ramesh Kumar',
      phone: '+91 98765 11223',
      email: 'ramesh.k@gmail.com',
      address: 'Flat 204, Green Heights, Indiranagar, Bengaluru 560038',
      state_code: '29',
      gstin: '',
      drug_license_no: '',
    },
    {
      id: 'party_patient_sunita',
      type: 'customer',
      name: 'Sunita Verma',
      phone: '+91 98123 45678',
      email: 'sunita.v@outlook.com',
      address: '12, 4th Cross, CMH Road, Indiranagar, Bengaluru 560038',
      state_code: '29',
      gstin: '',
      drug_license_no: '',
    },
    {
      id: 'party_patient_anand',
      type: 'customer',
      name: 'Anand Murthy',
      phone: '+91 97400 99887',
      email: 'anand.m@yahoo.com',
      address: '88, Defense Colony, Indiranagar, Bengaluru 560038',
      state_code: '29',
      gstin: '',
      drug_license_no: '',
    },
  ];

  for (const p of parties) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO parties (
        id, type, name, phone, email, address, state_code, gstin, drug_license_no, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      args: [p.id, p.type, p.name, p.phone, p.email, p.address, p.state_code, p.gstin, p.drug_license_no, nowIso],
    });
  }

  // 8. Chronic Condition Sales History for Refill Automation Testing
  // Calculate historical dates:
  // Patient 1: Ramesh Kumar bought 30 tabs of Glycomet 500 (Diabetes) 28 days ago -> 2 days remaining (DUE)
  // Patient 2: Sunita Verma bought 30 tabs of Telma 40 (Hypertension) 29 days ago -> 1 day remaining (DUE)
  // Patient 3: Anand Murthy bought 30 tabs of Shelcal 500 10 days ago -> 20 days remaining (NOT due)
  const msInDay = 24 * 60 * 60 * 1000;
  const date28DaysAgo = new Date(Date.now() - 28 * msInDay).toISOString().slice(0, 10);
  const date29DaysAgo = new Date(Date.now() - 29 * msInDay).toISOString().slice(0, 10);
  const date10DaysAgo = new Date(Date.now() - 10 * msInDay).toISOString().slice(0, 10);

  const salesSeed = [
    {
      saleId: 'inv_chronic_01',
      invoiceNo: 'INV-2026-0001',
      invoiceDate: date28DaysAgo,
      customerId: 'party_patient_ramesh',
      patientName: 'Ramesh Kumar',
      patientAddress: 'Flat 204, Green Heights, Indiranagar, Bengaluru',
      doctorId: 'doc_dr_patel',
      itemId: 'item_glycomet_500',
      batchId: 'batch_glycomet_01',
      qtyBase: 30, // 30 tablets = 30 days
      ratePaise: 240,
      mrpPaise: 240,
      taxablePaise: 6428,
      taxPaise: 772,
      totalPaise: 7200,
      schedule: 'H',
      itemName: 'Glycomet 500 Tablet',
      batchNo: 'GM24E19',
    },
    {
      saleId: 'inv_chronic_02',
      invoiceNo: 'INV-2026-0002',
      invoiceDate: date29DaysAgo,
      customerId: 'party_patient_sunita',
      patientName: 'Sunita Verma',
      patientAddress: '12, 4th Cross, CMH Road, Indiranagar, Bengaluru',
      doctorId: 'doc_dr_sharma',
      itemId: 'item_telma_40',
      batchId: 'batch_telma_01',
      qtyBase: 30, // 30 tablets = 30 days
      ratePaise: 1620,
      mrpPaise: 1620,
      taxablePaise: 43393,
      taxPaise: 5207,
      totalPaise: 48600,
      schedule: 'H',
      itemName: 'Telma 40 Tablet',
      batchNo: 'TL24D05',
    },
    {
      saleId: 'inv_chronic_03',
      invoiceNo: 'INV-2026-0003',
      invoiceDate: date10DaysAgo,
      customerId: 'party_patient_anand',
      patientName: 'Anand Murthy',
      patientAddress: '88, Defense Colony, Indiranagar, Bengaluru',
      doctorId: 'doc_dr_patel',
      itemId: 'item_shelcal_500',
      batchId: 'batch_shelcal_01',
      qtyBase: 30,
      ratePaise: 950,
      mrpPaise: 950,
      taxablePaise: 25446,
      taxPaise: 3054,
      totalPaise: 28500,
      schedule: 'none',
      itemName: 'Shelcal 500 Tablet',
      batchNo: 'SH24F11',
    },
  ];

  for (const sale of salesSeed) {
    // Insert sales invoice
    await db.execute({
      sql: `INSERT OR REPLACE INTO sales_invoices (
        id, invoice_no, invoice_date, customer_id, doctor_id, patient_name, patient_address,
        subtotal_paise, discount_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise,
        total_paise, payment_mode, paid_paise, status, notes, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, 0, ?, 'upi', ?, 'posted', 'Chronic maintenance refill seed', 'user_pharmacist', ?)`,
      args: [
        sale.saleId,
        sale.invoiceNo,
        sale.invoiceDate,
        sale.customerId,
        sale.doctorId,
        sale.patientName,
        sale.patientAddress,
        sale.taxablePaise,
        Math.floor(sale.taxPaise / 2),
        sale.taxPaise - Math.floor(sale.taxPaise / 2),
        sale.totalPaise,
        sale.totalPaise,
        sale.invoiceDate + 'T10:30:00Z',
      ],
    });

    // Insert sales item
    await db.execute({
      sql: `INSERT OR REPLACE INTO sales_items (
        id, sale_id, item_id, batch_id, qty_base, unit_id, rate_paise, mrp_paise,
        discount_pct_bp, gst_rate_bp, taxable_paise, tax_paise, line_total_paise
      ) VALUES (?, ?, ?, ?, ?, 'unit_${sale.itemId}_base', ?, ?, 0, 1200, ?, ?, ?)`,
      args: [
        `si_${sale.saleId}_1`,
        sale.saleId,
        sale.itemId,
        sale.batchId,
        sale.qtyBase,
        sale.ratePaise,
        sale.mrpPaise,
        sale.taxablePaise,
        sale.taxPaise,
        sale.totalPaise,
      ],
    });

    // Insert corresponding sales stock movement (negative sign)
    await db.execute({
      sql: `INSERT OR REPLACE INTO stock_movements (
        id, item_id, batch_id, qty_base_signed, movement_type, ref_doc_type, ref_doc_id, created_at, user_id
      ) VALUES (?, ?, ?, ?, 'sale', 'sale_invoice', ?, ?, 'user_pharmacist')`,
      args: [
        `sm_sale_${sale.saleId}`,
        sale.itemId,
        sale.batchId,
        -sale.qtyBase,
        sale.saleId,
        sale.invoiceDate + 'T10:30:00Z',
      ],
    });
    stockMovementsCount++;

    // If Schedule H/H1, also record in statutory CDSCO schedule_register
    if (sale.schedule === 'H' || sale.schedule === 'H1') {
      const doc = doctors.find((d) => d.id === sale.doctorId)!;
      await db.execute({
        sql: `INSERT OR REPLACE INTO schedule_register (
          id, sale_id, sale_item_id, date, patient_name, patient_address,
          doctor_name, doctor_reg_no, item_name, batch_no, qty, schedule
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          `sr_${sale.saleId}`,
          sale.saleId,
          `si_${sale.saleId}_1`,
          sale.invoiceDate,
          sale.patientName,
          sale.patientAddress,
          doc.name,
          doc.reg_no,
          sale.itemName,
          sale.batchNo,
          sale.qtyBase,
          sale.schedule,
        ],
      });
    }
  }

  return {
    shopName: 'PharmaPilot Wellness Pharmacy',
    manufacturersCount: manufacturers.length,
    itemsCount: itemsSeed.length,
    batchesCount: itemsSeed.length,
    stockMovementsCount,
    chronicPatientsCount: 3,
    salesInvoicesCount: salesSeed.length,
  };
}
